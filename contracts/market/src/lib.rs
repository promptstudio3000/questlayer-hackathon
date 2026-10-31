use near_contract_standards::non_fungible_token::core::NonFungibleTokenReceiver;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};
const MAX_LISTINGS: u64 = 128;
const MAX_ACCOUNTS: u32 = 256;
const MAX_ACTIVE_PER_ACCOUNT: u32 = 3;
#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
enum SaleState {
    Active,
    Buying { buyer: AccountId },
    Returning,
}
#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
struct Listing {
    id: u64,
    seller: AccountId,
    price: u128,
    state: SaleState,
}
#[derive(BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct MarketAccount {
    credit: u128,
    withdrawing: u128,
    listed: u32,
    buying: u32,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Offer {
    price: U128,
}
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ListingView {
    pub id: u64,
    pub token_id: String,
    pub seller: AccountId,
    pub price: U128,
    pub state: String,
    pub buyer: Option<AccountId>,
}
#[ext_contract(ext_nft)]
trait Nft {
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
    );
}
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_buy(&mut self, token_id: String, listing_id: u64) -> bool;
    fn on_cancel(&mut self, token_id: String, listing_id: u64) -> bool;
    fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool;
}
#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Market {
    owner: AccountId,
    nft_contract: AccountId,
    listings: UnorderedMap<String, Listing>,
    accounts: LookupMap<AccountId, MarketAccount>,
    account_count: u32,
    next_id: u64,
    paused: bool,
    funded: u128,
    escrow: u128,
    credits: u128,
    withdrawing: u128,
    withdrawn: u128,
}
#[near_bindgen]
impl Market {
    #[init]
    pub fn new(owner_id: AccountId, nft_contract_id: AccountId) -> Self {
        assert!(
            env::current_account_id().as_str().ends_with(".testnet")
                && nft_contract_id.as_str().ends_with(".testnet"),
            "Market is testnet-only"
        );
        Self {
            owner: owner_id,
            nft_contract: nft_contract_id,
            listings: UnorderedMap::new(b"l"),
            accounts: LookupMap::new(b"a"),
            account_count: 0,
            next_id: 1,
            paused: false,
            funded: 0,
            escrow: 0,
            credits: 0,
            withdrawing: 0,
            withdrawn: 0,
        }
    }
    #[payable]
    pub fn buy(&mut self, token_id: String, listing_id: u64) -> Promise {
        assert!(!self.paused, "Market is paused");
        let mut listing = self.listings.get(&token_id).expect("Listing not found");
        assert_eq!(listing.id, listing_id, "Listing changed");
        assert!(
            matches!(listing.state, SaleState::Active),
            "Listing is busy"
        );
        let buyer = env::predecessor_account_id();
        assert_ne!(buyer, listing.seller, "Cannot buy your own Aura");
        let paid = env::attached_deposit().as_yoctonear();
        assert_eq!(paid, listing.price, "Attach the exact listing price");
        self.ensure_account(&buyer);
        let mut a = self.accounts.get(&buyer).unwrap();
        assert!(
            a.buying < MAX_ACTIVE_PER_ACCOUNT,
            "Too many pending purchases"
        );
        a.buying += 1;
        self.accounts.insert(&buyer, &a);
        listing.state = SaleState::Buying {
            buyer: buyer.clone(),
        };
        self.listings.insert(&token_id, &listing);
        self.funded = self.funded.checked_add(paid).expect("Fund overflow");
        self.escrow += paid;
        self.check();
        ext_nft::ext(self.nft_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(35))
            .nft_transfer(
                buyer,
                token_id.clone(),
                None,
                Some("QuestLayer marketplace purchase".into()),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_buy(token_id, listing_id),
            )
    }
    #[private]
    pub fn on_buy(&mut self, token_id: String, listing_id: u64) -> bool {
        self.assert_self();
        let listing = self
            .listings
            .get(&token_id)
            .expect("Pending listing missing");
        assert_eq!(listing.id, listing_id, "Callback listing mismatch");
        let buyer = match listing.state.clone() {
            SaleState::Buying { buyer } => buyer,
            _ => env::panic_str("Purchase callback is not pending"),
        };
        let success = env::promise_result_checked(0, 64).is_ok();
        let mut b = self.accounts.get(&buyer).expect("Buyer missing");
        b.buying -= 1;
        self.accounts.insert(&buyer, &b);
        self.escrow -= listing.price;
        if success {
            self.listings.remove(&token_id);
            let mut seller = self.accounts.get(&listing.seller).unwrap();
            seller.listed -= 1;
            self.accounts.insert(&listing.seller, &seller);
            self.credit(&listing.seller, listing.price);
            self.cleanup(&buyer);
            self.event("sale",near_sdk::serde_json::json!({"listing_id":listing_id,"token_id":token_id,"seller":listing.seller,"buyer":buyer,"price":listing.price.to_string()}));
        } else {
            let mut active = listing;
            active.state = SaleState::Active;
            self.listings.insert(&token_id, &active);
            self.credit(&buyer, active.price);
            self.event("purchase_refund",near_sdk::serde_json::json!({"listing_id":listing_id,"buyer":buyer,"amount":active.price.to_string()}));
        }
        self.check();
        success
    }
    #[payable]
    pub fn cancel(&mut self, token_id: String, listing_id: u64) -> Promise {
        near_sdk::assert_one_yocto();
        let mut listing = self.listings.get(&token_id).expect("Listing not found");
        assert_eq!(listing.id, listing_id, "Listing changed");
        assert_eq!(env::predecessor_account_id(), listing.seller, "Seller only");
        assert!(
            matches!(listing.state, SaleState::Active),
            "Listing is busy"
        );
        listing.state = SaleState::Returning;
        self.listings.insert(&token_id, &listing);
        ext_nft::ext(self.nft_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(35))
            .nft_transfer(
                listing.seller,
                token_id.clone(),
                None,
                Some("QuestLayer listing cancellation".into()),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(25))
                    .on_cancel(token_id, listing_id),
            )
    }
    #[private]
    pub fn on_cancel(&mut self, token_id: String, listing_id: u64) -> bool {
        self.assert_self();
        let mut listing = self
            .listings
            .get(&token_id)
            .expect("Pending listing missing");
        assert_eq!(listing.id, listing_id, "Callback listing mismatch");
        assert!(
            matches!(listing.state, SaleState::Returning),
            "Cancellation is not pending"
        );
        let success = env::promise_result_checked(0, 64).is_ok();
        if success {
            self.listings.remove(&token_id);
            let mut seller = self.accounts.get(&listing.seller).unwrap();
            seller.listed -= 1;
            self.accounts.insert(&listing.seller, &seller);
            self.cleanup(&listing.seller);
            self.event(
                "cancel",
                near_sdk::serde_json::json!({"listing_id":listing_id,"token_id":token_id}),
            );
        } else {
            listing.state = SaleState::Active;
            self.listings.insert(&token_id, &listing);
        }
        self.check();
        success
    }
    #[payable]
    pub fn withdraw(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let mut a = self.accounts.get(&account).expect("No market balance");
        assert_eq!(a.withdrawing, 0, "Withdrawal pending");
        let amount = a.credit;
        assert!(amount > 0, "No market balance");
        a.credit = 0;
        a.withdrawing = amount;
        self.accounts.insert(&account, &a);
        self.credits -= amount;
        self.withdrawing += amount;
        self.check();
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(25))
                    .on_withdraw(account, U128(amount)),
            )
    }
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) -> bool {
        self.assert_self();
        let mut a = self.accounts.get(&account_id).expect("Withdrawer missing");
        assert_eq!(a.withdrawing, amount.0, "Withdrawal callback mismatch");
        a.withdrawing = 0;
        self.withdrawing -= amount.0;
        let success = env::promise_result_checked(0, 64).is_ok();
        if success {
            self.withdrawn += amount.0;
        } else {
            a.credit += amount.0;
            self.credits += amount.0;
        }
        self.accounts.insert(&account_id, &a);
        self.cleanup(&account_id);
        self.check();
        self.event("withdraw",near_sdk::serde_json::json!({"account_id":account_id,"amount":amount.0.to_string(),"success":success}));
        success
    }
    pub fn get_listing(&self, token_id: String) -> Option<ListingView> {
        self.listings
            .get(&token_id)
            .map(|l| Self::listing_view(token_id, l))
    }
    pub fn get_listings(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<ListingView> {
        self.listings
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(24).min(32) as usize)
            .map(|(t, l)| Self::listing_view(t, l))
            .collect()
    }
    pub fn get_account(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let a = self.accounts.get(&account_id).unwrap_or_default();
        near_sdk::serde_json::json!({"credit":a.credit.to_string(),"withdrawing":a.withdrawing.to_string(),"listed":a.listed,"buying":a.buying})
    }
    pub fn get_stats(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"version":1,"network":"testnet","nft_contract":self.nft_contract,"owner":self.owner,"paused":self.paused,"listing_count":self.listings.len(),"participant_count":self.account_count,"funded":self.funded.to_string(),"escrow":self.escrow.to_string(),"credits":self.credits.to_string(),"withdrawing":self.withdrawing.to_string(),"withdrawn":self.withdrawn.to_string(),"storage":"project-sponsored testnet storage","max_listings":MAX_LISTINGS,"max_participants":MAX_ACCOUNTS,"max_active_per_account":MAX_ACTIVE_PER_ACCOUNT})
    }
    pub fn set_paused(&mut self, paused: bool) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
        self.paused = paused;
    }
    fn listing_view(token_id: String, l: Listing) -> ListingView {
        let (state, buyer) = match l.state {
            SaleState::Active => ("active", None),
            SaleState::Buying { buyer } => ("buying", Some(buyer)),
            SaleState::Returning => ("returning", None),
        };
        ListingView {
            id: l.id,
            token_id,
            seller: l.seller,
            price: U128(l.price),
            state: state.into(),
            buyer,
        }
    }
    fn ensure_account(&mut self, id: &AccountId) {
        if self.accounts.get(id).is_none() {
            assert!(
                self.account_count < MAX_ACCOUNTS,
                "Market participant capacity reached"
            );
            self.accounts.insert(id, &MarketAccount::default());
            self.account_count += 1;
        }
    }
    fn cleanup(&mut self, id: &AccountId) {
        if let Some(a) = self.accounts.get(id) {
            if a.credit == 0 && a.withdrawing == 0 && a.listed == 0 && a.buying == 0 {
                self.accounts.remove(id);
                self.account_count -= 1;
            }
        }
    }
    fn credit(&mut self, id: &AccountId, amount: u128) {
        let mut a = self.accounts.get(id).expect("Market participant missing");
        a.credit = a.credit.checked_add(amount).expect("Credit overflow");
        self.accounts.insert(id, &a);
        self.credits += amount;
    }
    fn check(&self) {
        assert_eq!(
            self.funded,
            self.escrow + self.credits + self.withdrawing + self.withdrawn,
            "Market conservation failure"
        );
        assert!(
            self.listings.len() <= MAX_LISTINGS && self.account_count <= MAX_ACCOUNTS,
            "Market storage bound exceeded"
        );
    }
    fn assert_self(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "Private callback"
        );
    }
    fn event(&self, name: &str, data: near_sdk::serde_json::Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({"standard":"questlayer_market","version":"1.0.0","event":name,"data":[data]})
        ));
    }
}
#[near_bindgen]
impl NonFungibleTokenReceiver for Market {
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_eq!(
            env::predecessor_account_id(),
            self.nft_contract,
            "Only QuestLayer collectible NFTs are supported"
        );
        assert!(!self.paused, "Market is paused");
        assert_eq!(
            sender_id, previous_owner_id,
            "Only the NFT owner can list it"
        );
        assert!(
            token_id.len() <= 64 && token_id.starts_with("aura:"),
            "Only Aura NFTs can be listed"
        );
        assert!(msg.len() <= 128, "Offer message too large");
        let offer: Offer =
            near_sdk::serde_json::from_str(&msg).expect("Supply an exact NEAR price");
        assert!(
            offer.price.0 >= 10u128.pow(21) && offer.price.0 <= 1000 * 10u128.pow(24),
            "Price must be between 0.001 and 1000 test NEAR"
        );
        assert!(self.listings.get(&token_id).is_none(), "Already listed");
        assert!(
            self.listings.len() < MAX_LISTINGS,
            "Market listing capacity reached"
        );
        self.ensure_account(&previous_owner_id);
        let mut account = self.accounts.get(&previous_owner_id).unwrap();
        assert!(
            account.listed < MAX_ACTIVE_PER_ACCOUNT,
            "At most three active listings per account"
        );
        account.listed += 1;
        self.accounts.insert(&previous_owner_id, &account);
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).expect("Listing ID overflow");
        self.listings.insert(
            &token_id,
            &Listing {
                id,
                seller: previous_owner_id.clone(),
                price: offer.price.0,
                state: SaleState::Active,
            },
        );
        self.check();
        self.event("list",near_sdk::serde_json::json!({"listing_id":id,"token_id":token_id,"seller":previous_owner_id,"price":offer.price.0.to_string()}));
        PromiseOrValue::Value(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        test_utils::{testing_env_with_promise_results, VMContextBuilder},
        testing_env, PromiseResult,
    };
    const PRICE: u128 = 10_000_000_000_000_000_000_000;
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("market.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    #[allow(deprecated)]
    fn callback(success: bool) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("market.testnet"))
            .predecessor_account_id(a("market.testnet"))
            .account_balance(NearToken::from_near(100));
        testing_env_with_promise_results(
            b.build(),
            if success {
                PromiseResult::Successful(b"null".to_vec())
            } else {
                PromiseResult::Failed
            },
        );
    }
    fn list(c: &mut Market, serial: u32) {
        ctx("nfts.testnet", 0);
        c.nft_on_transfer(
            a("seller.testnet"),
            a("seller.testnet"),
            format!("aura:polar:{}", serial),
            format!("{{\"price\":\"{}\"}}", PRICE),
        );
    }
    fn fresh() -> Market {
        ctx("owner.testnet", 0);
        let mut c = Market::new(a("owner.testnet"), a("nfts.testnet"));
        list(&mut c, 1);
        c
    }
    #[test]
    fn completed_purchase_credits_seller_and_conserves_withdrawal() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE);
        c.buy("aura:polar:1".into(), 1);
        assert_eq!(c.escrow, PRICE);
        callback(true);
        assert!(c.on_buy("aura:polar:1".into(), 1));
        assert!(c.get_listing("aura:polar:1".into()).is_none());
        assert_eq!(c.accounts.get(&a("seller.testnet")).unwrap().credit, PRICE);
        ctx("seller.testnet", 1);
        c.withdraw();
        assert_eq!(c.withdrawing, PRICE);
        callback(true);
        assert!(c.on_withdraw(a("seller.testnet"), U128(PRICE)));
        assert_eq!(c.withdrawn, PRICE);
        assert_eq!(c.account_count, 0);
        c.check();
    }
    #[test]
    fn failed_nft_delivery_refunds_buyer_and_reopens_same_listing() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE);
        c.buy("aura:polar:1".into(), 1);
        callback(false);
        assert!(!c.on_buy("aura:polar:1".into(), 1));
        assert_eq!(
            c.get_listing("aura:polar:1".into()).unwrap().state,
            "active"
        );
        assert_eq!(c.accounts.get(&a("buyer.testnet")).unwrap().credit, PRICE);
        assert_eq!(c.accounts.get(&a("seller.testnet")).unwrap().credit, 0);
        c.check();
    }
    #[test]
    fn failed_withdrawal_restores_credit_without_double_payment() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE);
        c.buy("aura:polar:1".into(), 1);
        callback(true);
        c.on_buy("aura:polar:1".into(), 1);
        ctx("seller.testnet", 1);
        c.withdraw();
        callback(false);
        assert!(!c.on_withdraw(a("seller.testnet"), U128(PRICE)));
        assert_eq!(c.accounts.get(&a("seller.testnet")).unwrap().credit, PRICE);
        assert_eq!(c.withdrawing, 0);
        assert_eq!(c.withdrawn, 0);
        c.check();
    }
    #[test]
    fn cancellation_returns_nft_and_releases_sponsored_participant_state() {
        let mut c = fresh();
        ctx("seller.testnet", 1);
        c.cancel("aura:polar:1".into(), 1);
        callback(true);
        assert!(c.on_cancel("aura:polar:1".into(), 1));
        assert_eq!(c.listings.len(), 0);
        assert_eq!(c.account_count, 0);
        c.check();
    }
    #[test]
    fn failed_cancellation_keeps_listing_recoverable() {
        let mut c = fresh();
        ctx("seller.testnet", 1);
        c.cancel("aura:polar:1".into(), 1);
        callback(false);
        assert!(!c.on_cancel("aura:polar:1".into(), 1));
        assert_eq!(
            c.get_listing("aura:polar:1".into()).unwrap().state,
            "active"
        );
        c.check();
    }
    #[test]
    #[should_panic(expected = "Listing changed")]
    fn stale_listing_identifier_cannot_buy_a_repriced_offer() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE);
        c.buy("aura:polar:1".into(), 99);
    }
    #[test]
    #[should_panic(expected = "exact listing price")]
    fn underpayment_is_rejected() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE - 1);
        c.buy("aura:polar:1".into(), 1);
    }
    #[test]
    #[should_panic(expected = "own Aura")]
    fn seller_cannot_self_trade() {
        let mut c = fresh();
        ctx("seller.testnet", PRICE);
        c.buy("aura:polar:1".into(), 1);
    }
    #[test]
    #[should_panic(expected = "Listing is busy")]
    fn purchase_blocks_concurrent_cancellation() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE);
        c.buy("aura:polar:1".into(), 1);
        ctx("seller.testnet", 1);
        c.cancel("aura:polar:1".into(), 1);
    }
    #[test]
    #[should_panic(expected = "Only QuestLayer")]
    fn another_nft_contract_cannot_publish_an_offer() {
        let mut c = fresh();
        ctx("other-nfts.testnet", 0);
        c.nft_on_transfer(
            a("seller.testnet"),
            a("seller.testnet"),
            "aura:moon:1".into(),
            format!("{{\"price\":\"{}\"}}", PRICE),
        );
    }
    #[test]
    #[should_panic(expected = "owner can list")]
    fn approved_operator_cannot_choose_a_price_for_the_owner() {
        let mut c = fresh();
        ctx("nfts.testnet", 0);
        c.nft_on_transfer(
            a("operator.testnet"),
            a("seller.testnet"),
            "aura:moon:1".into(),
            format!("{{\"price\":\"{}\"}}", PRICE),
        );
    }
    #[test]
    #[should_panic(expected = "three active listings")]
    fn per_account_storage_exposure_is_bounded() {
        let mut c = fresh();
        list(&mut c, 2);
        list(&mut c, 3);
        list(&mut c, 4);
    }
    #[test]
    #[should_panic(expected = "Private callback")]
    fn public_caller_cannot_forge_a_successful_purchase_callback() {
        let mut c = fresh();
        ctx("buyer.testnet", PRICE);
        c.buy("aura:polar:1".into(), 1);
        ctx("attacker.testnet", 0);
        c.on_buy("aura:polar:1".into(), 1);
    }
}
