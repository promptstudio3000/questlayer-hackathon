use near_contract_standards::non_fungible_token::core::NonFungibleTokenReceiver;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, ext_contract, near_bindgen, AccountId, CurveType, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue, PublicKey,
};
const MAX_LISTINGS: u64 = 128;
const MAX_ACCOUNTS: u32 = 256;
const MAX_ACTIVE_PER_ACCOUNT: u32 = 3;
/// Signed-order bounds (version 2).
const MAX_SIGNERS: u32 = 256;
const MAX_KEYS_PER_SIGNER: usize = 4;
const MAX_NONCES: u64 = 1024;
const MAX_ORDER_MESSAGE: usize = 1024;
const MAX_ORDER_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const MIN_PRICE: u128 = 1_000_000_000_000_000_000_000; // 0.001 NEAR
const MAX_PRICE: u128 = 1000 * 1_000_000_000_000_000_000_000_000; // 1000 NEAR
/// NEP-413 tag: 2^31 + 413.
const NEP413_TAG: u32 = 2_147_484_061;
pub const ORDER_STANDARD: &str = "questlayer_aura_order";

#[derive(BorshSerialize, BorshDeserialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
enum SaleState {
    /// Version 1 fixed-price listing, bought with `buy`.
    Active,
    Buying {
        buyer: AccountId,
    },
    Returning,
    /// Version 2: escrowed NFT tradable only through signed orders.
    /// New variants are appended so version 1 state stays readable.
    Deposited,
    Filling {
        buyer: AccountId,
        price: u128,
    },
    ReturningDeposit,
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
/// Keys an account registered for off-chain order signing, plus a
/// cancel-all counter. A record is kept once its epoch is non-zero so a
/// bulk cancellation can never be undone by deleting and re-creating it.
#[derive(BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct Signer {
    keys: Vec<PublicKey>,
    epoch: u32,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Offer {
    price: U128,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct DepositMsg {
    deposit: bool,
}
/// The exact terms a maker signs. Serialized as the NEP-413 `message`.
#[derive(Deserialize, Serialize, Clone)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct OrderTerms {
    pub standard: String,
    pub version: u8,
    pub kind: String,
    pub network: String,
    pub market: AccountId,
    pub nft_contract: AccountId,
    pub maker: AccountId,
    pub token_id: String,
    pub price: U128,
    pub deadline_ms: U64,
    pub epoch: u32,
}
/// A NEP-413 `signMessage` result plus the signed payload fields.
#[derive(Deserialize, Serialize, Clone)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct SignedOrder {
    pub message: String,
    pub nonce: Base64VecU8,
    pub recipient: String,
    pub callback_url: Option<String>,
    pub public_key: PublicKey,
    pub signature: Base64VecU8,
}
#[derive(BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Nep413Payload {
    message: String,
    nonce: [u8; 32],
    recipient: String,
    callback_url: Option<String>,
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
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct OrderCheck {
    pub valid: bool,
    pub reason: Option<String>,
    pub maker: Option<AccountId>,
    pub kind: Option<String>,
    pub token_id: Option<String>,
    pub price: Option<U128>,
    pub fillable: bool,
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
    fn on_fill(&mut self, token_id: String, listing_id: u64) -> bool;
}
/// Version 1 storage layout, read once by `migrate`.
#[derive(BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
struct MarketV1 {
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
    signers: LookupMap<AccountId, Signer>,
    signer_count: u32,
    /// sha256(maker | 0 | nonce) -> order deadline (ms). Used or cancelled.
    nonces: UnorderedMap<Vec<u8>, u64>,
    filled_orders: u64,
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
            signers: LookupMap::new(b"s"),
            signer_count: 0,
            nonces: UnorderedMap::new(b"n"),
            filled_orders: 0,
        }
    }
    /// Upgrade version 1 state in place. Only the contract account itself
    /// (the deploy transaction) can call it, and it refuses to run twice
    /// because version 2 state has trailing fields version 1 cannot read.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: MarketV1 = env::state_read().expect("No version 1 market state");
        let m = Self {
            owner: old.owner,
            nft_contract: old.nft_contract,
            listings: old.listings,
            accounts: old.accounts,
            account_count: old.account_count,
            next_id: old.next_id,
            paused: old.paused,
            funded: old.funded,
            escrow: old.escrow,
            credits: old.credits,
            withdrawing: old.withdrawing,
            withdrawn: old.withdrawn,
            signers: LookupMap::new(b"s"),
            signer_count: 0,
            nonces: UnorderedMap::new(b"n"),
            filled_orders: 0,
        };
        m.check();
        m.event("migrate", near_sdk::serde_json::json!({"from":1,"to":2}));
        m
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
        self.deliver(buyer, token_id.clone(), "QuestLayer marketplace purchase")
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
        listing.state = match listing.state {
            SaleState::Active => SaleState::Returning,
            SaleState::Deposited => SaleState::ReturningDeposit,
            _ => env::panic_str("Listing is busy"),
        };
        self.listings.insert(&token_id, &listing);
        self.deliver(
            listing.seller,
            token_id.clone(),
            "QuestLayer listing cancellation",
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
        let restore = match listing.state {
            SaleState::Returning => SaleState::Active,
            SaleState::ReturningDeposit => SaleState::Deposited,
            _ => env::panic_str("Cancellation is not pending"),
        };
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
            listing.state = restore;
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

    // ---- Version 2: NEP-413 signed orders ----

    /// Register an ed25519 key for off-chain order signing. One yoctoNEAR
    /// forces a full-access key: an app's function-call key cannot add one.
    #[payable]
    pub fn add_signing_key(&mut self, public_key: PublicKey) {
        near_sdk::assert_one_yocto();
        assert!(
            public_key.curve_type() == CurveType::ED25519,
            "Only ed25519 signing keys are supported"
        );
        let id = env::predecessor_account_id();
        let mut s = match self.signers.get(&id) {
            Some(s) => s,
            None => {
                assert!(
                    self.signer_count < MAX_SIGNERS,
                    "Signer capacity reached"
                );
                self.signer_count += 1;
                Signer::default()
            }
        };
        assert!(!s.keys.contains(&public_key), "Key already registered");
        assert!(
            s.keys.len() < MAX_KEYS_PER_SIGNER,
            "At most four signing keys"
        );
        s.keys.push(public_key.clone());
        self.signers.insert(&id, &s);
        self.event(
            "signing_key_add",
            near_sdk::serde_json::json!({"account_id":id,"public_key":public_key}),
        );
    }
    /// Remove a signing key. Every order it signed stops verifying, and the
    /// epoch advances so re-adding the key cannot revive old orders.
    #[payable]
    pub fn remove_signing_key(&mut self, public_key: PublicKey) {
        near_sdk::assert_one_yocto();
        let id = env::predecessor_account_id();
        let mut s = self.signers.get(&id).expect("No signing keys");
        let before = s.keys.len();
        s.keys.retain(|k| k != &public_key);
        assert!(s.keys.len() < before, "Key not registered");
        s.epoch = s.epoch.checked_add(1).expect("Epoch overflow");
        self.signers.insert(&id, &s);
        self.event("signing_key_remove",near_sdk::serde_json::json!({"account_id":id,"public_key":public_key,"epoch":s.epoch}));
    }
    /// Invalidate every outstanding order the caller signed.
    #[payable]
    pub fn cancel_all_orders(&mut self) -> u32 {
        near_sdk::assert_one_yocto();
        let id = env::predecessor_account_id();
        let mut s = self.signers.get(&id).expect("No signing keys");
        s.epoch = s.epoch.checked_add(1).expect("Epoch overflow");
        self.signers.insert(&id, &s);
        self.event(
            "orders_cancel_all",
            near_sdk::serde_json::json!({"account_id":id,"epoch":s.epoch}),
        );
        s.epoch
    }
    /// Invalidate one signed order on chain by consuming its nonce.
    #[payable]
    pub fn cancel_order(&mut self, order: SignedOrder) {
        near_sdk::assert_one_yocto();
        let (terms, nonce_key) = self.verify(&order, false).unwrap_or_else(|e| env::panic_str(e));
        assert_eq!(env::predecessor_account_id(), terms.maker, "Maker only");
        self.consume_nonce(nonce_key, terms.deadline_ms.0);
        self.event("order_cancel",near_sdk::serde_json::json!({"maker":terms.maker,"nonce":order.nonce,"token_id":terms.token_id}));
    }
    /// Escrow NEAR for buy offers. Withdraw unused credit with `withdraw`.
    #[payable]
    pub fn deposit_near(&mut self) -> U128 {
        assert!(!self.paused, "Market is paused");
        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount >= MIN_PRICE, "Deposit at least 0.001 test NEAR");
        let id = env::predecessor_account_id();
        self.ensure_account(&id);
        self.funded = self.funded.checked_add(amount).expect("Fund overflow");
        self.credit(&id, amount);
        self.check();
        let credit = self.accounts.get(&id).unwrap().credit;
        self.event(
            "near_deposit",
            near_sdk::serde_json::json!({"account_id":id,"amount":amount.to_string()}),
        );
        U128(credit)
    }
    /// Buy an escrowed Aura with the seller's signed sell order. Attach the
    /// exact signed price.
    #[payable]
    pub fn fill_sell_order(&mut self, order: SignedOrder) -> Promise {
        assert!(!self.paused, "Market is paused");
        let (terms, nonce_key) = self.verify(&order, true).unwrap_or_else(|e| env::panic_str(e));
        assert_eq!(terms.kind, "sell", "Not a sell order");
        let buyer = env::predecessor_account_id();
        assert_ne!(buyer, terms.maker, "Cannot fill your own order");
        let price = terms.price.0;
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            price,
            "Attach the exact signed price"
        );
        let mut listing = self
            .listings
            .get(&terms.token_id)
            .expect("Aura is not in market escrow");
        assert!(
            matches!(listing.state, SaleState::Deposited) && listing.seller == terms.maker,
            "Aura is not available from this maker"
        );
        self.ensure_account(&buyer);
        let mut b = self.accounts.get(&buyer).unwrap();
        assert!(b.buying < MAX_ACTIVE_PER_ACCOUNT, "Too many pending purchases");
        b.buying += 1;
        self.accounts.insert(&buyer, &b);
        self.consume_nonce(nonce_key, terms.deadline_ms.0);
        self.funded = self.funded.checked_add(price).expect("Fund overflow");
        self.escrow += price;
        listing.state = SaleState::Filling {
            buyer: buyer.clone(),
            price,
        };
        self.listings.insert(&terms.token_id, &listing);
        self.check();
        self.event("order_match",near_sdk::serde_json::json!({"kind":"sell","listing_id":listing.id,"token_id":terms.token_id,"maker":terms.maker,"taker":buyer,"price":price.to_string(),"nonce":order.nonce}));
        self.settle(buyer, terms.token_id, listing.id)
    }
    /// Sell your escrowed Aura into a buyer's signed offer. The buyer's
    /// deposited credit pays the exact signed price.
    #[payable]
    pub fn fill_buy_order(&mut self, order: SignedOrder) -> Promise {
        near_sdk::assert_one_yocto();
        assert!(!self.paused, "Market is paused");
        let (terms, nonce_key) = self.verify(&order, true).unwrap_or_else(|e| env::panic_str(e));
        assert_eq!(terms.kind, "buy", "Not a buy order");
        let seller = env::predecessor_account_id();
        let buyer = terms.maker.clone();
        assert_ne!(seller, buyer, "Cannot fill your own order");
        let price = terms.price.0;
        let mut listing = self
            .listings
            .get(&terms.token_id)
            .expect("Deposit the Aura into market escrow first");
        assert!(
            matches!(listing.state, SaleState::Deposited) && listing.seller == seller,
            "Only the escrowed Aura's owner can accept this offer"
        );
        let mut b = self.accounts.get(&buyer).expect("Buyer has no market credit");
        assert!(b.credit >= price, "Buyer's market credit is too low");
        assert!(b.buying < MAX_ACTIVE_PER_ACCOUNT, "Too many pending purchases");
        b.credit -= price;
        b.buying += 1;
        self.accounts.insert(&buyer, &b);
        self.credits -= price;
        self.escrow += price;
        self.consume_nonce(nonce_key, terms.deadline_ms.0);
        listing.state = SaleState::Filling {
            buyer: buyer.clone(),
            price,
        };
        self.listings.insert(&terms.token_id, &listing);
        self.check();
        self.event("order_match",near_sdk::serde_json::json!({"kind":"buy","listing_id":listing.id,"token_id":terms.token_id,"maker":buyer,"taker":seller,"price":price.to_string(),"nonce":order.nonce}));
        self.settle(buyer, terms.token_id, listing.id)
    }
    #[private]
    pub fn on_fill(&mut self, token_id: String, listing_id: u64) -> bool {
        self.assert_self();
        let mut listing = self
            .listings
            .get(&token_id)
            .expect("Pending order missing");
        assert_eq!(listing.id, listing_id, "Callback listing mismatch");
        let (buyer, price) = match listing.state.clone() {
            SaleState::Filling { buyer, price } => (buyer, price),
            _ => env::panic_str("Order fill is not pending"),
        };
        let success = env::promise_result_checked(0, 64).is_ok();
        let mut b = self.accounts.get(&buyer).expect("Buyer missing");
        b.buying -= 1;
        self.accounts.insert(&buyer, &b);
        self.escrow -= price;
        if success {
            self.listings.remove(&token_id);
            let mut s = self.accounts.get(&listing.seller).unwrap();
            s.listed -= 1;
            self.accounts.insert(&listing.seller, &s);
            self.credit(&listing.seller, price);
            self.filled_orders += 1;
            self.cleanup(&buyer);
            self.event("order_fill",near_sdk::serde_json::json!({"listing_id":listing_id,"token_id":token_id,"seller":listing.seller,"buyer":buyer,"price":price.to_string()}));
        } else {
            // The NFT stays escrowed for its owner; the buyer's NEAR becomes
            // withdrawable credit. The consumed order nonce is not revived.
            listing.state = SaleState::Deposited;
            self.listings.insert(&token_id, &listing);
            self.credit(&buyer, price);
            self.event("order_fill_refund",near_sdk::serde_json::json!({"listing_id":listing_id,"token_id":token_id,"buyer":buyer,"amount":price.to_string()}));
        }
        self.check();
        success
    }
    /// Remove expired nonce records. Expired orders can never verify, so
    /// forgetting their nonces cannot re-enable a replay.
    pub fn prune_nonces(&mut self, limit: Option<u32>) -> u32 {
        self.prune(limit.unwrap_or(32).min(128))
    }
    /// Read-only verification for clients and the order relay.
    pub fn check_order(&self, order: SignedOrder) -> OrderCheck {
        match self.verify(&order, true) {
            Ok((t, _)) => {
                let fillable = self
                    .listings
                    .get(&t.token_id)
                    .map(|l| {
                        matches!(l.state, SaleState::Deposited)
                            && (t.kind == "buy" || l.seller == t.maker)
                    })
                    .unwrap_or(false)
                    && (t.kind == "sell"
                        || self
                            .accounts
                            .get(&t.maker)
                            .map(|a| a.credit >= t.price.0)
                            .unwrap_or(false));
                OrderCheck {
                    valid: true,
                    reason: None,
                    maker: Some(t.maker),
                    kind: Some(t.kind),
                    token_id: Some(t.token_id),
                    price: Some(t.price),
                    fillable,
                }
            }
            Err(e) => OrderCheck {
                valid: false,
                reason: Some(e.into()),
                maker: None,
                kind: None,
                token_id: None,
                price: None,
                fillable: false,
            },
        }
    }
    pub fn get_signer(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let s = self.signers.get(&account_id).unwrap_or_default();
        near_sdk::serde_json::json!({"keys":s.keys,"epoch":s.epoch})
    }
    pub fn is_nonce_used(&self, account_id: AccountId, nonce: Base64VecU8) -> bool {
        self.nonces.get(&Self::nonce_key(&account_id, &nonce.0)).is_some()
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
        near_sdk::serde_json::json!({"version":2,"network":"testnet","nft_contract":self.nft_contract,"owner":self.owner,"paused":self.paused,"listing_count":self.listings.len(),"participant_count":self.account_count,"funded":self.funded.to_string(),"escrow":self.escrow.to_string(),"credits":self.credits.to_string(),"withdrawing":self.withdrawing.to_string(),"withdrawn":self.withdrawn.to_string(),"storage":"project-sponsored testnet storage","max_listings":MAX_LISTINGS,"max_participants":MAX_ACCOUNTS,"max_active_per_account":MAX_ACTIVE_PER_ACCOUNT,"signed_orders":{"standard":ORDER_STANDARD,"version":1,"signature":"NEP-413 ed25519","signer_count":self.signer_count,"nonce_count":self.nonces.len(),"filled":self.filled_orders,"max_signers":MAX_SIGNERS,"max_keys_per_signer":MAX_KEYS_PER_SIGNER,"max_nonces":MAX_NONCES,"max_ttl_ms":MAX_ORDER_TTL_MS}})
    }
    pub fn set_paused(&mut self, paused: bool) {
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
        self.paused = paused;
    }
    fn listing_view(token_id: String, l: Listing) -> ListingView {
        let (state, buyer, price) = match l.state {
            SaleState::Active => ("active", None, l.price),
            SaleState::Buying { buyer } => ("buying", Some(buyer), l.price),
            SaleState::Returning => ("returning", None, l.price),
            SaleState::Deposited => ("deposited", None, 0),
            SaleState::Filling { buyer, price } => ("filling", Some(buyer), price),
            SaleState::ReturningDeposit => ("returning", None, 0),
        };
        ListingView {
            id: l.id,
            token_id,
            seller: l.seller,
            price: U128(price),
            state: state.into(),
            buyer,
        }
    }
    fn deliver(&self, to: AccountId, token_id: String, memo: &str) -> Promise {
        ext_nft::ext(self.nft_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(35))
            .nft_transfer(to, token_id, None, Some(memo.into()))
    }
    fn settle(&self, buyer: AccountId, token_id: String, listing_id: u64) -> Promise {
        self.deliver(buyer, token_id.clone(), "QuestLayer signed order fill")
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_fill(token_id, listing_id),
            )
    }
    fn nonce_key(maker: &AccountId, nonce: &[u8]) -> Vec<u8> {
        let mut b = maker.as_bytes().to_vec();
        b.push(0);
        b.extend_from_slice(nonce);
        env::sha256(&b)
    }
    fn consume_nonce(&mut self, key: Vec<u8>, deadline_ms: u64) {
        assert!(self.nonces.get(&key).is_none(), "Order nonce already used");
        if self.nonces.len() >= MAX_NONCES {
            self.prune(16);
        }
        assert!(self.nonces.len() < MAX_NONCES, "Order nonce capacity reached");
        self.nonces.insert(&key, &deadline_ms);
    }
    fn prune(&mut self, limit: u32) -> u32 {
        let now = env::block_timestamp_ms();
        let expired: Vec<Vec<u8>> = self
            .nonces
            .iter()
            .filter(|(_, d)| *d <= now)
            .take(limit as usize)
            .map(|(k, _)| k)
            .collect();
        for k in &expired {
            self.nonces.remove(k);
        }
        expired.len() as u32
    }
    /// NEP-413 digest: sha256(borsh(u32 tag) ++ borsh(payload)).
    pub(crate) fn nep413_digest(order: &SignedOrder, nonce: [u8; 32]) -> Vec<u8> {
        let mut bytes = near_sdk::borsh::to_vec(&NEP413_TAG).unwrap();
        bytes.extend(
            near_sdk::borsh::to_vec(&Nep413Payload {
                message: order.message.clone(),
                nonce,
                recipient: order.recipient.clone(),
                callback_url: order.callback_url.clone(),
            })
            .unwrap(),
        );
        env::sha256(&bytes)
    }
    fn verify(
        &self,
        order: &SignedOrder,
        require_live: bool,
    ) -> Result<(OrderTerms, Vec<u8>), &'static str> {
        if order.message.len() > MAX_ORDER_MESSAGE {
            return Err("Order message too large");
        }
        if order.recipient != env::current_account_id().as_str() {
            return Err("Order was signed for another recipient");
        }
        let nonce: [u8; 32] = order
            .nonce
            .0
            .clone()
            .try_into()
            .map_err(|_| "Nonce must be 32 bytes")?;
        let sig: [u8; 64] = order
            .signature
            .0
            .clone()
            .try_into()
            .map_err(|_| "Signature must be 64 bytes")?;
        if order.public_key.curve_type() != CurveType::ED25519 {
            return Err("Only ed25519 signatures are supported");
        }
        let key: [u8; 32] = order.public_key.as_bytes()[1..]
            .try_into()
            .map_err(|_| "Bad public key")?;
        let terms: OrderTerms =
            near_sdk::serde_json::from_str(&order.message).map_err(|_| "Malformed order terms")?;
        if terms.standard != ORDER_STANDARD || terms.version != 1 {
            return Err("Unsupported order standard");
        }
        if terms.network != "testnet" {
            return Err("Order is for another network");
        }
        if terms.market != env::current_account_id() {
            return Err("Order names another market");
        }
        if terms.nft_contract != self.nft_contract {
            return Err("Order names another NFT contract");
        }
        if terms.kind != "sell" && terms.kind != "buy" {
            return Err("Order kind must be sell or buy");
        }
        if terms.token_id.len() > 64 || !terms.token_id.starts_with("aura:") {
            return Err("Only Aura NFTs can be traded");
        }
        if terms.price.0 < MIN_PRICE || terms.price.0 > MAX_PRICE {
            return Err("Price must be between 0.001 and 1000 test NEAR");
        }
        let now = env::block_timestamp_ms();
        if require_live && terms.deadline_ms.0 <= now {
            return Err("Order expired");
        }
        if terms.deadline_ms.0 > now.saturating_add(MAX_ORDER_TTL_MS) {
            return Err("Order deadline is more than 30 days away");
        }
        let signer = self.signers.get(&terms.maker).ok_or("Maker has no signing key")?;
        if !signer.keys.contains(&order.public_key) {
            return Err("Key is not registered by the maker");
        }
        if terms.epoch != signer.epoch {
            return Err("Order was cancelled by the maker");
        }
        if !env::ed25519_verify(&sig, Self::nep413_digest(order, nonce), &key) {
            return Err("Invalid signature");
        }
        let nonce_key = Self::nonce_key(&terms.maker, &nonce);
        if self.nonces.get(&nonce_key).is_some() {
            return Err("Order nonce already used");
        }
        Ok((terms, nonce_key))
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
            self.listings.len() <= MAX_LISTINGS
                && self.account_count <= MAX_ACCOUNTS
                && self.signer_count <= MAX_SIGNERS
                && self.nonces.len() <= MAX_NONCES,
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
            near_sdk::serde_json::json!({"standard":"questlayer_market","version":"2.0.0","event":name,"data":[data]})
        ));
    }
}
#[near_bindgen]
impl NonFungibleTokenReceiver for Market {
    /// `{"price":"<yocto>"}` creates a version 1 fixed-price listing.
    /// `{"deposit":true}` escrows the Aura for signed orders only.
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
        let (price, state) = if let Ok(d) = near_sdk::serde_json::from_str::<DepositMsg>(&msg) {
            assert!(d.deposit, "Supply an exact NEAR price or a deposit");
            (0, SaleState::Deposited)
        } else {
            let offer: Offer =
                near_sdk::serde_json::from_str(&msg).expect("Supply an exact NEAR price");
            assert!(
                offer.price.0 >= MIN_PRICE && offer.price.0 <= MAX_PRICE,
                "Price must be between 0.001 and 1000 test NEAR"
            );
            (offer.price.0, SaleState::Active)
        };
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
        let deposited = matches!(state, SaleState::Deposited);
        self.listings.insert(
            &token_id,
            &Listing {
                id,
                seller: previous_owner_id.clone(),
                price,
                state,
            },
        );
        self.check();
        if deposited {
            self.event("nft_deposit",near_sdk::serde_json::json!({"listing_id":id,"token_id":token_id,"owner":previous_owner_id}));
        } else {
            self.event("list",near_sdk::serde_json::json!({"listing_id":id,"token_id":token_id,"seller":previous_owner_id,"price":price.to_string()}));
        }
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

#[cfg(test)]
mod signed_order_tests {
    use super::*;
    use ed25519_dalek::{Signer as _, SigningKey};
    use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};
    const PRICE: u128 = 10_000_000_000_000_000_000_000_000; // 10 NEAR
    const NOW_MS: u64 = 1_793_000_000_000;
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("market.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .block_timestamp(NOW_MS * 1_000_000)
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    fn ctx_at(who: &str, deposit: u128, now_ms: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("market.testnet"))
            .predecessor_account_id(a(who))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    #[allow(deprecated)]
    fn callback(success: bool) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("market.testnet"))
            .predecessor_account_id(a("market.testnet"))
            .block_timestamp(NOW_MS * 1_000_000)
            .account_balance(NearToken::from_near(100));
        near_sdk::test_utils::testing_env_with_promise_results(
            b.build(),
            if success {
                PromiseResult::Successful(b"null".to_vec())
            } else {
                PromiseResult::Failed
            },
        );
    }
    fn key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }
    fn pk(k: &SigningKey) -> PublicKey {
        PublicKey::from_parts(CurveType::ED25519, k.verifying_key().to_bytes().to_vec()).unwrap()
    }
    struct O<'a> {
        kind: &'a str,
        maker: &'a str,
        token: &'a str,
        price: u128,
        deadline: u64,
        epoch: u32,
        nonce: u8,
    }
    fn o<'a>(kind: &'a str, maker: &'a str) -> O<'a> {
        O {
            kind,
            maker,
            token: "aura:polar:1",
            price: PRICE,
            deadline: NOW_MS + 3_600_000,
            epoch: 0,
            nonce: 7,
        }
    }
    fn sign(k: &SigningKey, o: &O) -> SignedOrder {
        let message = near_sdk::serde_json::json!({
            "standard": ORDER_STANDARD, "version": 1, "kind": o.kind, "network": "testnet",
            "market": "market.testnet", "nft_contract": "nfts.testnet", "maker": o.maker,
            "token_id": o.token, "price": o.price.to_string(),
            "deadline_ms": o.deadline.to_string(), "epoch": o.epoch
        })
        .to_string();
        let mut order = SignedOrder {
            message,
            nonce: Base64VecU8(vec![o.nonce; 32]),
            recipient: "market.testnet".into(),
            callback_url: None,
            public_key: pk(k),
            signature: Base64VecU8(vec![]),
        };
        let digest = Market::nep413_digest(&order, [o.nonce; 32]);
        order.signature = Base64VecU8(k.sign(&digest).to_bytes().to_vec());
        order
    }
    fn deposit_nft(c: &mut Market, owner: &str, token: &str) {
        ctx("nfts.testnet", 0);
        let _ = c.nft_on_transfer(a(owner), a(owner), token.into(), "{\"deposit\":true}".into());
    }
    fn register(c: &mut Market, who: &str, k: &SigningKey) {
        ctx(who, 1);
        c.add_signing_key(pk(k));
    }
    /// Seller has Aura 1 in escrow and a registered key (seed 1);
    /// buyer has a registered key (seed 2).
    fn setup() -> Market {
        ctx("owner.testnet", 0);
        let mut c = Market::new(a("owner.testnet"), a("nfts.testnet"));
        deposit_nft(&mut c, "seller.testnet", "aura:polar:1");
        register(&mut c, "seller.testnet", &key(1));
        register(&mut c, "buyer.testnet", &key(2));
        c
    }
    fn credit(c: &Market, who: &str) -> u128 {
        c.accounts.get(&a(who)).map(|x| x.credit).unwrap_or(0)
    }

    #[test]
    fn signed_sell_order_settles_exact_price_through_escrow() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("buyer.testnet", PRICE);
        assert!(c.check_order(order.clone()).fillable);
        let _ = c.fill_sell_order(order.clone());
        assert_eq!(c.escrow, PRICE);
        assert_eq!(c.get_listing("aura:polar:1".into()).unwrap().state, "filling");
        callback(true);
        assert!(c.on_fill("aura:polar:1".into(), 1));
        assert!(c.get_listing("aura:polar:1".into()).is_none());
        assert_eq!(credit(&c, "seller.testnet"), PRICE);
        assert_eq!(c.filled_orders, 1);
        assert!(c.is_nonce_used(a("seller.testnet"), Base64VecU8(vec![7; 32])));
        c.check();
    }
    #[test]
    fn signed_buy_offer_settles_from_deposited_credit() {
        let mut c = setup();
        ctx("buyer.testnet", PRICE + 5);
        c.deposit_near();
        let offer = sign(&key(2), &o("buy", "buyer.testnet"));
        ctx("seller.testnet", 1);
        let _ = c.fill_buy_order(offer);
        assert_eq!(credit(&c, "buyer.testnet"), 5);
        assert_eq!(c.escrow, PRICE);
        callback(true);
        assert!(c.on_fill("aura:polar:1".into(), 1));
        assert_eq!(credit(&c, "seller.testnet"), PRICE);
        assert_eq!(credit(&c, "buyer.testnet"), 5);
        c.check();
    }
    #[test]
    #[should_panic(expected = "nonce already used")]
    fn a_filled_order_cannot_be_replayed() {
        let mut c = setup();
        deposit_nft(&mut c, "seller.testnet", "aura:polar:2");
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(order.clone());
        callback(true);
        c.on_fill("aura:polar:1".into(), 1);
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    #[should_panic(expected = "nonce already used")]
    fn same_nonce_cannot_authorize_a_second_token() {
        let mut c = setup();
        deposit_nft(&mut c, "seller.testnet", "aura:polar:2");
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(sign(&key(1), &o("sell", "seller.testnet")));
        let mut second = o("sell", "seller.testnet");
        second.token = "aura:polar:2";
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(sign(&key(1), &second));
    }
    #[test]
    fn failed_delivery_refunds_buyer_keeps_nft_escrowed_and_burns_nonce() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(order.clone());
        callback(false);
        assert!(!c.on_fill("aura:polar:1".into(), 1));
        assert_eq!(c.get_listing("aura:polar:1".into()).unwrap().state, "deposited");
        assert_eq!(credit(&c, "buyer.testnet"), PRICE);
        assert_eq!(credit(&c, "seller.testnet"), 0);
        ctx("buyer.testnet", 0);
        assert_eq!(c.check_order(order).reason.as_deref(), Some("Order nonce already used"));
        // Buyer recovers the refund through the normal withdrawal path.
        ctx("buyer.testnet", 1);
        let _ = c.withdraw();
        callback(false);
        assert!(!c.on_withdraw(a("buyer.testnet"), U128(PRICE)));
        assert_eq!(credit(&c, "buyer.testnet"), PRICE);
        ctx("buyer.testnet", 1);
        let _ = c.withdraw();
        callback(true);
        assert!(c.on_withdraw(a("buyer.testnet"), U128(PRICE)));
        assert_eq!(c.withdrawn, PRICE);
        c.check();
    }
    #[test]
    #[should_panic(expected = "nonce already used")]
    fn cancelled_order_cannot_be_filled() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("seller.testnet", 1);
        c.cancel_order(order.clone());
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    #[should_panic(expected = "Maker only")]
    fn only_the_maker_can_cancel_an_order() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("buyer.testnet", 1);
        c.cancel_order(order);
    }
    #[test]
    #[should_panic(expected = "cancelled by the maker")]
    fn cancel_all_invalidates_outstanding_orders() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("seller.testnet", 1);
        assert_eq!(c.cancel_all_orders(), 1);
        ctx("buyer.testnet", PRICE);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    fn removing_a_key_invalidates_orders_even_if_re_added() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("seller.testnet", 1);
        c.remove_signing_key(pk(&key(1)));
        assert_eq!(c.check_order(order.clone()).reason.as_deref(), Some("Key is not registered by the maker"));
        register(&mut c, "seller.testnet", &key(1));
        assert_eq!(c.check_order(order).reason.as_deref(), Some("Order was cancelled by the maker"));
    }
    #[test]
    #[should_panic(expected = "Order expired")]
    fn expired_order_is_rejected() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx_at("buyer.testnet", PRICE, NOW_MS + 3_600_000);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    fn long_dated_orders_and_foreign_terms_are_rejected() {
        let c = setup();
        let mut far = o("sell", "seller.testnet");
        far.deadline = NOW_MS + MAX_ORDER_TTL_MS + 1;
        ctx("buyer.testnet", 0);
        assert_eq!(c.check_order(sign(&key(1), &far)).reason.as_deref(), Some("Order deadline is more than 30 days away"));
        let mut other = sign(&key(1), &o("sell", "seller.testnet"));
        other.recipient = "intents.near".into();
        assert_eq!(c.check_order(other).reason.as_deref(), Some("Order was signed for another recipient"));
        let mut cheap = o("sell", "seller.testnet");
        cheap.price = 1;
        assert!(c.check_order(sign(&key(1), &cheap)).reason.unwrap().starts_with("Price must"));
    }
    #[test]
    #[should_panic(expected = "Invalid signature")]
    fn tampered_price_breaks_the_signature() {
        let mut c = setup();
        let mut order = sign(&key(1), &o("sell", "seller.testnet"));
        order.message = order.message.replace(&PRICE.to_string(), &(PRICE / 10).to_string());
        ctx("buyer.testnet", PRICE / 10);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    #[should_panic(expected = "not registered by the maker")]
    fn a_key_registered_by_someone_else_cannot_sign_for_the_maker() {
        let mut c = setup();
        // Buyer's own key signs an order claiming the seller as maker.
        let order = sign(&key(2), &o("sell", "seller.testnet"));
        ctx("attacker.testnet", PRICE);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    #[should_panic(expected = "exact signed price")]
    fn sell_order_requires_exact_payment() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("buyer.testnet", PRICE - 1);
        let _ = c.fill_sell_order(order);
    }
    #[test]
    #[should_panic(expected = "credit is too low")]
    fn unfunded_offer_cannot_be_filled() {
        let mut c = setup();
        let offer = sign(&key(2), &o("buy", "buyer.testnet"));
        ctx("buyer.testnet", PRICE - 1);
        c.deposit_near();
        ctx("seller.testnet", 1);
        let _ = c.fill_buy_order(offer);
    }
    #[test]
    #[should_panic(expected = "owner can accept this offer")]
    fn only_the_escrowed_owner_can_accept_an_offer() {
        let mut c = setup();
        ctx("buyer.testnet", PRICE);
        c.deposit_near();
        let offer = sign(&key(2), &o("buy", "buyer.testnet"));
        ctx("thief.testnet", 1);
        let _ = c.fill_buy_order(offer);
    }
    #[test]
    #[should_panic(expected = "not available from this maker")]
    fn fill_race_second_taker_loses() {
        let mut c = setup();
        ctx("buyer.testnet", PRICE);
        c.deposit_near();
        // Seller signs a sell order and accepts a buy offer at the same time.
        let sell = sign(&key(1), &o("sell", "seller.testnet"));
        let mut offer_terms = o("buy", "buyer.testnet");
        offer_terms.nonce = 9;
        let offer = sign(&key(2), &offer_terms);
        ctx("seller.testnet", 1);
        let _ = c.fill_buy_order(offer);
        ctx("other.testnet", PRICE);
        let _ = c.fill_sell_order(sell);
    }
    #[test]
    fn escrowed_nft_withdrawal_recovers_after_a_failed_transfer() {
        let mut c = setup();
        ctx("seller.testnet", 1);
        let _ = c.cancel("aura:polar:1".into(), 1);
        callback(false);
        assert!(!c.on_cancel("aura:polar:1".into(), 1));
        assert_eq!(c.get_listing("aura:polar:1".into()).unwrap().state, "deposited");
        ctx("seller.testnet", 1);
        let _ = c.cancel("aura:polar:1".into(), 1);
        callback(true);
        assert!(c.on_cancel("aura:polar:1".into(), 1));
        assert!(c.get_listing("aura:polar:1".into()).is_none());
    }
    #[test]
    #[should_panic(expected = "Listing is busy")]
    fn deposited_aura_cannot_be_bought_through_the_fixed_price_path() {
        let mut c = setup();
        ctx("buyer.testnet", 0);
        let _ = c.buy("aura:polar:1".into(), 1);
    }
    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn function_call_keys_cannot_register_signing_keys() {
        let mut c = setup();
        ctx("buyer.testnet", 0);
        c.add_signing_key(pk(&key(3)));
    }
    #[test]
    fn expired_nonces_are_pruned_without_reviving_live_orders() {
        let mut c = setup();
        let order = sign(&key(1), &o("sell", "seller.testnet"));
        ctx("seller.testnet", 1);
        c.cancel_order(order.clone());
        ctx("anyone.testnet", 0);
        assert_eq!(c.prune_nonces(None), 0);
        ctx_at("anyone.testnet", 0, NOW_MS + 3_600_000);
        assert_eq!(c.prune_nonces(None), 1);
        assert_eq!(c.check_order(order).reason.as_deref(), Some("Order expired"));
    }
    #[test]
    fn node_signed_fixture_verifies_and_matches_rust_signature_bytes() {
        let c = setup();
        let fixture: SignedOrder = near_sdk::serde_json::from_str(include_str!(
            "../../../tests/fixtures/signed-aura-order.json"
        ))
        .unwrap();
        ctx("buyer.testnet", 0);
        let check = c.check_order(fixture.clone());
        assert!(check.valid, "{:?}", check.reason);
        assert!(check.fillable);
        // ed25519 is deterministic: identical digests give identical bytes.
        let ours = sign(&key(1), &o("sell", "seller.testnet"));
        assert_eq!(ours.message, fixture.message);
        assert_eq!(ours.public_key, fixture.public_key);
        assert_eq!(ours.signature.0, fixture.signature.0);
    }
    #[test]
    fn version_one_state_migrates_with_balances_and_listings() {
        ctx("owner.testnet", 0);
        let mut c = Market::new(a("owner.testnet"), a("nfts.testnet"));
        ctx("nfts.testnet", 0);
        let _ = c.nft_on_transfer(a("seller.testnet"), a("seller.testnet"), "aura:moon:3".into(), format!("{{\"price\":\"{}\"}}", PRICE));
        // Write the state with the version 1 layout only.
        #[derive(BorshSerialize)]
        #[borsh(crate = "near_sdk::borsh")]
        struct V1Out<'a> {
            owner: &'a AccountId,
            nft_contract: &'a AccountId,
            listings: &'a UnorderedMap<String, Listing>,
            accounts: &'a LookupMap<AccountId, MarketAccount>,
            account_count: u32,
            next_id: u64,
            paused: bool,
            funded: u128,
            escrow: u128,
            credits: u128,
            withdrawing: u128,
            withdrawn: u128,
        }
        env::state_write(&V1Out {
            owner: &c.owner,
            nft_contract: &c.nft_contract,
            listings: &c.listings,
            accounts: &c.accounts,
            account_count: c.account_count,
            next_id: c.next_id,
            paused: false,
            funded: 0,
            escrow: 0,
            credits: 0,
            withdrawing: 0,
            withdrawn: 0,
        });
        ctx("market.testnet", 0);
        let m = Market::migrate();
        assert_eq!(m.get_listing("aura:moon:3".into()).unwrap().state, "active");
        assert_eq!(m.next_id, 2);
        assert_eq!(m.get_stats()["version"], 2);
    }
}
