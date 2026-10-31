use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    collections::{LookupMap, UnorderedMap},
    env, ext_contract,
    json_types::{U128, U64},
    near_bindgen,
    serde::Serialize,
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
// Rebuild the vault artifact first. The factory deploys this exact reviewed code,
// with no account access keys and no upgrade or arbitrary-transfer method.
const VAULT: &[u8] =
    include_bytes!("../../target/wasm32-unknown-unknown/release/questlayer_vault.wasm");
const RESERVE: u128 = 3_500_000_000_000_000_000_000_000;
const FACTORY_STORAGE: u128 = 20_000_000_000_000_000_000_000;
const MAX_POSITIONS: u64 = 32;
#[derive(BorshDeserialize, BorshSerialize, Serialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Position {
    pub id: U64,
    pub account_id: AccountId,
    pub beneficiary: AccountId,
    pub pool: AccountId,
    pub contribution_bps: u16,
    pub state: String,
}
#[derive(BorshDeserialize, BorshSerialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct Refund {
    available: u128,
    pending: u128,
}
#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    rewards: AccountId,
    next: u64,
    positions: UnorderedMap<u64, Position>,
    refunds: LookupMap<AccountId, Refund>,
}
#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks {
    fn on_create(&mut self, id: U64) -> PromiseOrValue<bool>;
    fn on_register(&mut self, id: U64) -> bool;
    fn on_refund(&mut self, account_id: AccountId, amount: U128) -> bool;
}
#[near_bindgen]
impl Factory {
    #[init]
    pub fn new(rewards_id: AccountId) -> Self {
        assert_eq!(
            env::current_account_id().as_str(),
            "questlayer-vaults-20261031.testnet",
            "Pinned testnet factory only"
        );
        assert_eq!(
            rewards_id.as_str(),
            "questlayer-rewards-20261031.testnet",
            "Pinned reward contract only"
        );
        Self {
            rewards: rewards_id,
            next: 0,
            positions: UnorderedMap::new(b"v"),
            refunds: LookupMap::new(b"r"),
        }
    }
    #[payable]
    pub fn create_position(&mut self, pool_id: AccountId, contribution_bps: u16) -> Promise {
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            RESERVE + FACTORY_STORAGE,
            "Exact disclosed setup reserve required"
        );
        assert!(self.next < MAX_POSITIONS, "Testnet pilot capacity reached");
        assert!(contribution_bps <= 10000, "Invalid contribution");
        assert!(
            [
                "aurora.pool.f863973.m0",
                "stakely_v2.pool.f863973.m0",
                "ts.pool.f863973.m0"
            ]
            .contains(&pool_id.as_str()),
            "Pool not allowlisted"
        );
        let owner = env::predecessor_account_id();
        assert!(
            self.positions
                .values()
                .filter(|p| p.beneficiary == owner && p.state != "failed")
                .count()
                < 4,
            "Four positions per wallet in this pilot"
        );
        // The compiled bytes must fit the advertised reserve with operating headroom.
        assert!(
            (VAULT.len() as u128 + 20000) * env::storage_byte_cost().as_yoctonear() < RESERVE,
            "Vault storage exceeds reserve"
        );
        let id = self.next;
        self.next += 1;
        let account_id: AccountId = format!("v{id}.{}", env::current_account_id())
            .parse()
            .unwrap();
        self.positions.insert(
            &id,
            &Position {
                id: U64(id),
                account_id: account_id.clone(),
                beneficiary: owner.clone(),
                pool: pool_id.clone(),
                contribution_bps,
                state: "creating".into(),
            },
        );
        Promise::new(account_id).create_account().transfer(NearToken::from_yoctonear(RESERVE)).deploy_contract(VAULT.to_vec()).function_call("new",near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({"beneficiary_id":owner,"pool_id":pool_id,"rewards_id":self.rewards,"contribution_bps":contribution_bps})).unwrap(),NearToken::from_yoctonear(0),Gas::from_tgas(25)).then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(75)).on_create(U64(id)))
    }
    #[private]
    pub fn on_create(&mut self, id: U64) -> PromiseOrValue<bool> {
        let mut p = self.positions.get(&id.0).expect("Unknown position");
        assert_eq!(p.state, "creating", "Unexpected create callback");
        if env::promise_result_checked(0, 1024).is_err() {
            p.state = "failed".into();
            let mut refund = self.refunds.get(&p.beneficiary).unwrap_or_default();
            refund.available += RESERVE;
            self.refunds.insert(&p.beneficiary, &refund);
            self.positions.insert(&id.0, &p);
            return PromiseOrValue::Value(false);
        }
        p.state = "created".into();
        self.positions.insert(&id.0, &p);
        self.register_position(id).into()
    }
    /// Registration can be retried without redeploying, funding or changing owner.
    pub fn register_position(&mut self, id: U64) -> Promise {
        let mut p = self.positions.get(&id.0).expect("Unknown position");
        assert_eq!(p.state, "created", "Position not ready for registration");
        p.state = "registering".into();
        self.positions.insert(&id.0, &p);
        Promise::new(self.rewards.clone())
            .function_call(
                "register_factory_vault",
                near_sdk::serde_json::to_vec(
                    &near_sdk::serde_json::json!({"account_id":p.account_id}),
                )
                .unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(20),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_register(id),
            )
    }
    #[private]
    pub fn on_register(&mut self, id: U64) -> bool {
        let mut p = self.positions.get(&id.0).expect("Unknown position");
        assert_eq!(p.state, "registering", "Unexpected registration callback");
        let ok = env::promise_result_checked(0, 1024).is_ok();
        p.state = if ok { "ready" } else { "created" }.into();
        self.positions.insert(&id.0, &p);
        ok
    }
    #[payable]
    pub fn withdraw_refund(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        let owner = env::predecessor_account_id();
        let mut r = self.refunds.get(&owner).unwrap_or_default();
        assert!(
            r.available > 0 && r.pending == 0,
            "No refund or payout pending"
        );
        let amount = r.available;
        r.available = 0;
        r.pending = amount;
        self.refunds.insert(&owner, &r);
        Promise::new(owner.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_refund(owner, U128(amount)),
            )
    }
    #[private]
    pub fn on_refund(&mut self, account_id: AccountId, amount: U128) -> bool {
        let mut r = self.refunds.get(&account_id).unwrap();
        assert_eq!(r.pending, amount.0, "Refund callback mismatch");
        r.pending = 0;
        let ok = env::promise_result_checked(0, 0).is_ok();
        if !ok {
            r.available += amount.0;
        }
        self.refunds.insert(&account_id, &r);
        ok
    }
    pub fn get_position(&self, id: U64) -> Option<Position> {
        self.positions.get(&id.0)
    }
    pub fn get_positions(&self, beneficiary: Option<AccountId>) -> Vec<Position> {
        self.positions
            .values()
            .filter(|p| beneficiary.as_ref().map_or(true, |a| a == &p.beneficiary))
            .collect()
    }
    pub fn get_refund(&self, account_id: AccountId) -> near_sdk::serde_json::Value {
        let r = self.refunds.get(&account_id).unwrap_or_default();
        near_sdk::serde_json::json!({"available":r.available.to_string(),"pending":r.pending.to_string()})
    }
    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"network":"testnet","version":1,"rewards":self.rewards,"setup_deposit":(RESERVE+FACTORY_STORAGE).to_string(),"vault_reserve":RESERVE.to_string(),"factory_storage":FACTORY_STORAGE.to_string(),"vault_sha256":env::sha256(VAULT).iter().map(|b|format!("{b:02x}")).collect::<String>(),"capacity":MAX_POSITIONS,"created":self.next,"keys_added_to_vault":false})
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(who: &str, deposit: u128, result: Option<PromiseResult>) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("questlayer-vaults-20261031.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(100));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            std::collections::HashMap::default(),
            result.into_iter().collect()
        );
    }
    fn factory() -> Factory {
        ctx("alice.testnet", 0, None);
        Factory::new(a("questlayer-rewards-20261031.testnet"))
    }
    #[test]
    fn create_binds_predecessor_and_does_not_add_access_keys() {
        let mut f = factory();
        ctx("alice.testnet", RESERVE + FACTORY_STORAGE, None);
        let _ = f.create_position(a("aurora.pool.f863973.m0"), 5000);
        let p = f.get_position(U64(0)).unwrap();
        assert_eq!(p.beneficiary, a("alice.testnet"));
        assert_eq!(p.state, "creating");
        let receipts = near_sdk::test_utils::get_created_receipts();
        assert!(!format!("{receipts:?}").contains("AddKey"));
    }
    #[test]
    fn failed_creation_retains_owner_refund_and_registration_retries() {
        let mut f = factory();
        ctx("alice.testnet", RESERVE + FACTORY_STORAGE, None);
        let _ = f.create_position(a("aurora.pool.f863973.m0"), 0);
        ctx(
            "questlayer-vaults-20261031.testnet",
            0,
            Some(PromiseResult::Failed),
        );
        let _ = f.on_create(U64(0));
        assert_eq!(f.get_position(U64(0)).unwrap().state, "failed");
        assert_eq!(
            f.get_refund(a("alice.testnet"))["available"],
            RESERVE.to_string()
        );
    }
    #[test]
    fn successful_child_registration_cannot_redeploy_or_change_owner() {
        let mut f = factory();
        ctx("alice.testnet", RESERVE + FACTORY_STORAGE, None);
        let _ = f.create_position(a("aurora.pool.f863973.m0"), 10000);
        ctx(
            "questlayer-vaults-20261031.testnet",
            0,
            Some(PromiseResult::Successful(vec![])),
        );
        let _ = f.on_create(U64(0));
        ctx(
            "questlayer-vaults-20261031.testnet",
            0,
            Some(PromiseResult::Failed),
        );
        assert!(!f.on_register(U64(0)));
        assert_eq!(f.get_position(U64(0)).unwrap().state, "created");
        ctx("bob.testnet", 0, None);
        let _ = f.register_position(U64(0));
        ctx(
            "questlayer-vaults-20261031.testnet",
            0,
            Some(PromiseResult::Successful(vec![])),
        );
        assert!(f.on_register(U64(0)));
        assert_eq!(
            f.get_position(U64(0)).unwrap().beneficiary,
            a("alice.testnet")
        );
    }
    #[test]
    #[should_panic(expected = "Pool not allowlisted")]
    fn arbitrary_pool_rejected() {
        let mut f = factory();
        ctx("alice.testnet", RESERVE + FACTORY_STORAGE, None);
        let _ = f.create_position(a("attacker.testnet"), 5000);
    }
    #[test]
    #[should_panic(expected = "Exact disclosed setup reserve required")]
    fn missing_setup_funding_rejected() {
        let mut f = factory();
        ctx("alice.testnet", 1, None);
        let _ = f.create_position(a("aurora.pool.f863973.m0"), 5000);
    }
}
