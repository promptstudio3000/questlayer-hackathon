//! QuestLayer soulbound fungible token (NEP-141 views, no transfers).
//!
//! Deployed as QGOLD next to the QuestLayer ledger (contracts/ledger): the
//! ledger account is the only minter and forwards the GOLD part of every
//! recorded game action here with the same memo. Wallets and explorers show
//! the balance through the NEP-141 views and `ft_mint` events, but the token
//! cannot be sent, sold or burned: `ft_transfer` and `ft_transfer_call` always
//! fail. Storage is paid by this contract's own balance (the game sponsors it),
//! so NEP-145 storage calls are no-ops that refund any deposit.
use near_sdk::{
    collections::LookupMap,
    env,
    json_types::U128,
    near, AccountId, PanicOnDefault, Promise,
};

pub const MAX_BATCH: usize = 25;
pub const MAX_MEMO: usize = 200;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Mint {
    pub account_id: AccountId,
    pub amount: U128,
    pub memo: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub minter_id: AccountId,
    pub transferable: bool,
    pub holders: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SoulboundToken {
    owner: AccountId,
    minter: AccountId,
    metadata: FungibleTokenMetadata,
    balances: LookupMap<AccountId, u128>,
    total_supply: u128,
    holders: u64,
}

#[near]
impl SoulboundToken {
    #[init]
    pub fn new(owner_id: AccountId, minter_id: AccountId, metadata: FungibleTokenMetadata) -> Self {
        assert_eq!(metadata.spec, "ft-1.0.0", "Metadata spec must be ft-1.0.0");
        assert!(!metadata.symbol.is_empty() && metadata.symbol.len() <= 12, "Symbol is 1-12 bytes");
        Self { owner: owner_id, minter: minter_id, metadata, balances: LookupMap::new(b"b".to_vec()), total_supply: 0, holders: 0 }
    }

    // ---------------------------------------------------------------- owner

    #[payable]
    pub fn set_minter(&mut self, minter_id: AccountId) {
        near_sdk::assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
        self.minter = minter_id;
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        near_sdk::assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner, "Owner only");
        self.owner = owner_id;
    }

    // ---------------------------------------------------------------- minting

    /// Mints to several accounts at once. Minter (the ledger account) only.
    pub fn ft_mint_batch(&mut self, mints: Vec<Mint>) -> U128 {
        assert_eq!(env::predecessor_account_id(), self.minter, "Minter only");
        assert!(!mints.is_empty() && mints.len() <= MAX_BATCH, "1-{MAX_BATCH} mints per call");
        let mut events = Vec::with_capacity(mints.len());
        let mut minted: u128 = 0;
        for m in mints {
            assert!(m.amount.0 > 0, "Mint amount must be positive");
            if let Some(memo) = &m.memo {
                assert!(memo.len() <= MAX_MEMO, "Memo is at most {MAX_MEMO} bytes");
            }
            let before = self.balances.get(&m.account_id);
            if before.is_none() {
                self.holders += 1;
            }
            let after = before.unwrap_or(0).checked_add(m.amount.0).expect("Balance overflow");
            self.balances.insert(&m.account_id, &after);
            self.total_supply = self.total_supply.checked_add(m.amount.0).expect("Supply overflow");
            minted += m.amount.0;
            let mut ev = near_sdk::serde_json::json!({ "owner_id": m.account_id, "amount": m.amount });
            if let Some(memo) = m.memo {
                ev["memo"] = near_sdk::serde_json::Value::String(memo);
            }
            events.push(ev);
        }
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_mint", "data": events })
        ));
        U128(minted)
    }

    // ---------------------------------------------------------------- NEP-141

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let _ = (receiver_id, amount, memo);
        env::panic_str(&format!("{} is soulbound and cannot be transferred", self.metadata.symbol));
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> U128 {
        let _ = (receiver_id, amount, memo, msg);
        env::panic_str(&format!("{} is soulbound and cannot be transferred", self.metadata.symbol));
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }

    pub fn get_config(&self) -> Config {
        Config { owner_id: self.owner.clone(), minter_id: self.minter.clone(), transferable: false, holders: self.holders }
    }

    // ---------------------------------------------------------------- NEP-145 (sponsored)

    /// Storage is sponsored by the contract; any deposit is returned.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = registration_only;
        let deposit = env::attached_deposit();
        if !deposit.is_zero() {
            Promise::new(env::predecessor_account_id()).transfer(deposit).detach();
        }
        let _ = account_id;
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: U128(0), max: Some(U128(0)) }
    }

    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        near_sdk::assert_one_yocto();
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, NearToken};

    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("qgold.ledger.testnet"))
            .predecessor_account_id(a(who))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    fn meta() -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: "ft-1.0.0".into(),
            name: "QuestLayer Gold".into(),
            symbol: "QGOLD".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
    fn fresh() -> SoulboundToken {
        ctx("owner.testnet", 0);
        SoulboundToken::new(a("owner.testnet"), a("ledger.testnet"), meta())
    }

    #[test]
    fn minter_mints_in_batches() {
        let mut t = fresh();
        ctx("ledger.testnet", 0);
        let n = t.ft_mint_batch(vec![
            Mint { account_id: a("alice.testnet"), amount: U128(5), memo: Some("ql1 coin".into()) },
            Mint { account_id: a("alice.testnet"), amount: U128(7), memo: None },
            Mint { account_id: a("bob.testnet"), amount: U128(1), memo: None },
        ]);
        assert_eq!(n.0, 13);
        assert_eq!(t.ft_balance_of(a("alice.testnet")).0, 12);
        assert_eq!(t.ft_total_supply().0, 13);
        assert_eq!(t.get_config().holders, 2);
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs[0].starts_with("EVENT_JSON:") && logs[0].contains("\"ft_mint\"") && logs[0].contains("ql1 coin"));
    }

    #[test]
    #[should_panic(expected = "Minter only")]
    fn nobody_else_mints() {
        let mut t = fresh();
        ctx("alice.testnet", 0);
        t.ft_mint_batch(vec![Mint { account_id: a("alice.testnet"), amount: U128(5), memo: None }]);
    }

    #[test]
    #[should_panic(expected = "QGOLD is soulbound")]
    fn cannot_transfer() {
        let mut t = fresh();
        ctx("alice.testnet", 1);
        t.ft_transfer(a("bob.testnet"), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "QGOLD is soulbound")]
    fn cannot_transfer_call() {
        let mut t = fresh();
        ctx("alice.testnet", 1);
        t.ft_transfer_call(a("bob.testnet"), U128(1), None, String::new());
    }

    #[test]
    fn storage_is_sponsored() {
        let mut t = fresh();
        ctx("alice.testnet", 1250000000000000000000);
        assert_eq!(t.storage_deposit(None, None).total.0, 0);
        assert!(t.storage_balance_of(a("x.testnet")).is_some());
    }
}
