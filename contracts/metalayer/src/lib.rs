//! MetaLayer: the economy of the shared voxel world, separate from GotchiGO.
//!
//! - **MetaGold** is a NEP-141 coin with its own treasury. The treasury is the
//!   contract's own MetaGold balance. It grows only from real funding: NEAR sent
//!   to `fund` or QGOLD sent with `ft_transfer_call` (one way: QGOLD becomes
//!   MetaGold, never back). Nothing here redeems MetaGold into NEAR or QGOLD.
//! - **Awards** (`award`, recorder only) pay MetaGold out of the treasury and add
//!   soulbound **MetaXP** and **badges** for one world action. Every action id
//!   pays once; a daily cap and the treasury balance bound every payout. An
//!   award that does not fit is skipped, never partly paid.
//! - **Parcels** are NEP-171 NFTs of 16 × 16 blocks, bought with MetaGold that
//!   goes back to the treasury. They transfer freely; the world reads the owner.
//! - Every recorded action emits the `questlayer_metalayer` NEP-297 event
//!   `action_recorded`, so the world can be rebuilt from chain data.
//!
//! City XP and QGOLD are never touched.
use near_contract_standards::fungible_token::{
    core::FungibleTokenCore,
    metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
    receiver::FungibleTokenReceiver,
    resolver::FungibleTokenResolver,
    FungibleToken,
};
use near_contract_standards::non_fungible_token::{
    core::{NonFungibleTokenCore, NonFungibleTokenResolver},
    enumeration::NonFungibleTokenEnumeration,
    events::NftMint,
    metadata::{NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC},
    NonFungibleToken, Token, TokenId,
};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::{
    collections::{LazyOption, LookupMap, LookupSet, UnorderedMap},
    env,
    json_types::{U128, U64},
    near, require, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub const DECIMALS: u8 = 6;
pub const PARCEL_SIZE: i32 = 16;
/// Parcels live inside this square of the world (blocks from the centre).
pub const WORLD_LIMIT: i32 = 4096;
/// The public square around the centre stays shared and is never sold.
pub const PLAZA_HALF: i32 = 64;
pub const MAX_AWARD_BATCH: usize = 40;
pub const MAX_RECORD_BATCH: usize = 100;
pub const MAX_META_XP_PER_AWARD: u32 = 1_000;
const MAX_ID: usize = 80;
const DAY_NS: u64 = 86_400_000_000_000;
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Ft,
    FtMeta,
    Paid,
    Xp,
    Badges,
    Held,
    NftOwner,
    NftMeta,
    NftEnum,
    NftContractMeta,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct BadgeDef {
    pub title: String,
    pub description: String,
}

#[near(serializers = [json])]
pub struct Award {
    pub action_id: String,
    pub account_id: AccountId,
    /// The hashed actor reference of the world action (never the account).
    pub actor: String,
    pub layer_id: String,
    pub evidence_hash: String,
    pub metagold: U128,
    pub meta_xp: u32,
    pub badge: Option<String>,
}

#[near(serializers = [json])]
pub struct Record {
    pub action_id: String,
    pub layer_id: String,
    pub actor: String,
    pub evidence_hash: String,
}

#[near(serializers = [json])]
pub struct Treasury {
    pub metagold_available: U128,
    pub metagold_supply: U128,
    pub near_received: U128,
    pub qgold_received: U128,
    pub day: U64,
    pub paid_today: U128,
    pub daily_cap: U128,
    pub parcel_price: U128,
    pub metagold_per_near: U128,
    pub metagold_per_qgold: U128,
    pub qgold_token: Option<AccountId>,
    pub recorder: AccountId,
    pub owner: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MetaLayer {
    owner: AccountId,
    recorder: AccountId,
    ft: FungibleToken,
    ft_meta: LazyOption<FungibleTokenMetadata>,
    nft: NonFungibleToken,
    nft_meta: LazyOption<NFTContractMetadata>,
    /// MetaGold units minted per whole NEAR sent to `fund` (fixed at init).
    metagold_per_near: u128,
    /// MetaGold units per QGOLD unit (fixed at init). QGOLD never comes back out.
    metagold_per_qgold: u128,
    qgold_token: Option<AccountId>,
    daily_cap: u128,
    parcel_price: u128,
    day: u64,
    paid_today: u128,
    near_received: u128,
    qgold_received: u128,
    paid: LookupSet<String>,
    xp: LookupMap<AccountId, u64>,
    badges: UnorderedMap<String, BadgeDef>,
    held: LookupMap<AccountId, Vec<String>>,
}

fn valid_id(s: &str, what: &str) {
    require!(
        !s.is_empty() && s.len() <= MAX_ID && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b':'),
        format!("{what} is 1-80 characters of a-z, 0-9, - _ :")
    );
}
fn valid_hash(s: &str) {
    require!(s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "Evidence hash is 64 lowercase hex characters");
}
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        serde_json::json!({ "standard": "questlayer_metalayer", "version": "1.0.0", "event": event, "data": [data] })
    ));
}
pub fn parcel_id(x0: i32, z0: i32) -> TokenId {
    format!("parcel:{x0}:{z0}")
}

#[near]
impl MetaLayer {
    #[init]
    pub fn new(
        owner_id: AccountId,
        recorder_id: AccountId,
        qgold_token: Option<AccountId>,
        metagold_per_near: U128,
        metagold_per_qgold: U128,
        daily_cap: U128,
        parcel_price: U128,
    ) -> Self {
        require!(metagold_per_near.0 > 0 && metagold_per_qgold.0 > 0, "Rates must be positive");
        let mut this = Self {
            owner: owner_id.clone(),
            recorder: recorder_id,
            ft: FungibleToken::new(Key::Ft),
            ft_meta: LazyOption::new(Key::FtMeta, Some(&FungibleTokenMetadata {
                spec: FT_METADATA_SPEC.to_string(),
                name: "MetaGold".to_string(),
                symbol: "METAGOLD".to_string(),
                icon: None,
                reference: None,
                reference_hash: None,
                decimals: DECIMALS,
            })),
            nft: NonFungibleToken::new(Key::NftOwner, env::current_account_id(), Some(Key::NftMeta), Some(Key::NftEnum), None::<Key>),
            nft_meta: LazyOption::new(Key::NftContractMeta, None),
            metagold_per_near: metagold_per_near.0,
            metagold_per_qgold: metagold_per_qgold.0,
            qgold_token,
            daily_cap: daily_cap.0,
            parcel_price: parcel_price.0,
            day: 0,
            paid_today: 0,
            near_received: 0,
            qgold_received: 0,
            paid: LookupSet::new(Key::Paid),
            xp: LookupMap::new(Key::Xp),
            badges: UnorderedMap::new(Key::Badges),
            held: LookupMap::new(Key::Held),
        };
        this.nft_meta.set(&NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "MetaLayer parcels".to_string(),
            symbol: "MLPARCEL".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        });
        let me = env::current_account_id();
        this.ft.internal_register_account(&me);
        this
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
    }
    fn ensure_registered(&mut self, account: &AccountId) {
        if !self.ft.accounts.contains_key(account) {
            self.ft.internal_register_account(account);
        }
    }
    fn roll_day(&mut self) {
        let today = env::block_timestamp() / DAY_NS;
        if today != self.day {
            self.day = today;
            self.paid_today = 0;
        }
    }
    fn mint_to(&mut self, account: &AccountId, amount: u128, memo: &str) {
        self.ensure_registered(account);
        self.ft.internal_deposit(account, amount);
        near_contract_standards::fungible_token::events::FtMint { owner_id: account, amount: U128(amount), memo: Some(memo) }.emit();
    }

    // ---------- Funding (one way into the treasury) ----------

    /// Anyone may fund the treasury with NEAR. It mints MetaGold into the
    /// treasury at the fixed rate; the NEAR stays here as backing.
    #[payable]
    pub fn fund(&mut self) -> U128 {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= ONE_NEAR / 100, "Fund at least 0.01 NEAR");
        let minted = deposit
            .checked_mul(self.metagold_per_near)
            .map(|v| v / ONE_NEAR)
            .unwrap_or_else(|| env::panic_str("Amount too large"));
        require!(minted > 0, "Too little to mint MetaGold");
        self.near_received += deposit;
        let me = env::current_account_id();
        self.mint_to(&me, minted, "treasury funding (NEAR)");
        emit("treasury_funded", serde_json::json!({ "from": env::predecessor_account_id(), "near": U128(deposit), "metagold": U128(minted) }));
        U128(minted)
    }

    // ---------- Awards, records, MetaXP, badges ----------

    pub fn define_badge(&mut self, badge_id: String, title: String, description: String) {
        self.only_owner();
        valid_id(&badge_id, "Badge id");
        require!(!title.is_empty() && title.chars().count() <= 48, "Title is 1-48 characters");
        require!(description.chars().count() <= 280, "Description is at most 280 characters");
        self.badges.insert(&badge_id, &BadgeDef { title, description });
    }

    /// Recorder only. Pays each world action at most once. Returns one status per
    /// entry: "paid", "duplicate", "over-daily-cap" or "treasury-empty".
    pub fn award(&mut self, awards: Vec<Award>) -> Vec<String> {
        require!(env::predecessor_account_id() == self.recorder, "Only the MetaLayer recorder");
        require!(!awards.is_empty() && awards.len() <= MAX_AWARD_BATCH, "1-40 awards per batch");
        self.roll_day();
        let me = env::current_account_id();
        let mut out = Vec::with_capacity(awards.len());
        for a in awards {
            valid_id(&a.action_id, "Action id");
            valid_id(&a.layer_id, "Layer id");
            valid_hash(&a.evidence_hash);
            valid_id(&a.actor, "Actor");
            require!(a.meta_xp <= MAX_META_XP_PER_AWARD, "Too much MetaXP for one action");
            require!(a.account_id != me, "The treasury cannot earn awards");
            if let Some(b) = &a.badge {
                require!(self.badges.get(b).is_some(), "Unknown badge");
            }
            if self.paid.contains(&a.action_id) {
                out.push("duplicate".to_string());
                continue;
            }
            let gold = a.metagold.0;
            if gold > 0 && self.paid_today.saturating_add(gold) > self.daily_cap {
                out.push("over-daily-cap".to_string());
                continue;
            }
            if gold > 0 && self.ft.ft_balance_of(me.clone()).0 < gold {
                out.push("treasury-empty".to_string());
                continue;
            }
            self.paid.insert(&a.action_id);
            if gold > 0 {
                self.ensure_registered(&a.account_id);
                self.ft.internal_transfer(&me, &a.account_id, gold, Some(a.action_id.clone()));
                self.paid_today += gold;
            }
            if a.meta_xp > 0 {
                let xp = self.xp.get(&a.account_id).unwrap_or(0) + a.meta_xp as u64;
                self.xp.insert(&a.account_id, &xp);
            }
            let mut badge_new = None;
            if let Some(b) = a.badge {
                let mut list = self.held.get(&a.account_id).unwrap_or_default();
                if !list.contains(&b) {
                    list.push(b.clone());
                    self.held.insert(&a.account_id, &list);
                    badge_new = Some(b);
                }
            }
            emit("action_recorded", serde_json::json!({
                "action_id": a.action_id, "layer_id": a.layer_id, "actor": a.actor, "account": a.account_id,
                "evidence_hash": a.evidence_hash, "metagold": a.metagold, "meta_xp": a.meta_xp, "badge": badge_new,
            }));
            out.push("paid".to_string());
        }
        out
    }

    /// Recorder only: anchors world actions that carry no award (a block edit, a
    /// visit). Emits events only; nothing is stored.
    pub fn record_batch(&mut self, actions: Vec<Record>) -> u32 {
        require!(env::predecessor_account_id() == self.recorder, "Only the MetaLayer recorder");
        require!(!actions.is_empty() && actions.len() <= MAX_RECORD_BATCH, "1-100 actions per batch");
        for r in &actions {
            valid_id(&r.action_id, "Action id");
            valid_id(&r.layer_id, "Layer id");
            valid_id(&r.actor, "Actor");
            valid_hash(&r.evidence_hash);
            emit("action_recorded", serde_json::json!({ "action_id": r.action_id, "layer_id": r.layer_id, "actor": r.actor, "evidence_hash": r.evidence_hash }));
        }
        actions.len() as u32
    }

    // ---------- Parcels ----------

    /// Buy one 16 × 16 parcel at (x0, z0) for `parcel_price` MetaGold, which goes
    /// back to the treasury. Attach NEAR for the token's storage; the rest returns.
    #[payable]
    pub fn buy_parcel(&mut self, x0: i32, z0: i32) -> Token {
        require!(x0 % PARCEL_SIZE == 0 && z0 % PARCEL_SIZE == 0, "Parcel corners are multiples of 16");
        require!(x0.abs() <= WORLD_LIMIT && z0.abs() <= WORLD_LIMIT, "Outside the parcel area");
        let touches_plaza = x0 < PLAZA_HALF && x0 + PARCEL_SIZE > -PLAZA_HALF && z0 < PLAZA_HALF && z0 + PARCEL_SIZE > -PLAZA_HALF;
        require!(!touches_plaza, "The central square stays public");
        let id = parcel_id(x0, z0);
        require!(self.nft.owner_by_id.get(&id).is_none(), "This parcel is taken");
        let buyer = env::predecessor_account_id();
        let me = env::current_account_id();
        require!(buyer != me, "The treasury cannot buy parcels");
        if self.parcel_price > 0 {
            self.ft.internal_transfer(&buyer, &me, self.parcel_price, Some(id.clone()));
        }
        let meta = TokenMetadata {
            title: Some(format!("MetaLayer parcel {x0}, {z0}")),
            description: Some("16 × 16 blocks of MetaLayer land. Its blocks follow the parcel to every new owner.".to_string()),
            media: None, media_hash: None, copies: Some(1), issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None, starts_at: None, updated_at: None,
            extra: Some(serde_json::json!({ "x0": x0, "z0": z0, "size": PARCEL_SIZE }).to_string()),
            reference: None, reference_hash: None,
        };
        let token = self.nft.internal_mint_with_refund(id.clone(), buyer.clone(), Some(meta), Some(buyer.clone()));
        NftMint { owner_id: &buyer, token_ids: &[&id], memo: Some("parcel") }.emit();
        emit("parcel_bought", serde_json::json!({ "token_id": id, "owner": buyer, "price": U128(self.parcel_price) }));
        token
    }

    // ---------- Owner settings (rates stay fixed) ----------

    pub fn set_recorder(&mut self, recorder_id: AccountId) {
        self.only_owner();
        self.recorder = recorder_id;
    }
    pub fn set_daily_cap(&mut self, daily_cap: U128) {
        self.only_owner();
        self.daily_cap = daily_cap.0;
    }
    pub fn set_parcel_price(&mut self, parcel_price: U128) {
        self.only_owner();
        self.parcel_price = parcel_price.0;
    }
    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.only_owner();
        self.owner = owner_id;
    }

    // ---------- Views ----------

    pub fn treasury(&self) -> Treasury {
        let today = env::block_timestamp() / DAY_NS;
        Treasury {
            metagold_available: self.ft.ft_balance_of(env::current_account_id()),
            metagold_supply: U128(self.ft.total_supply),
            near_received: U128(self.near_received),
            qgold_received: U128(self.qgold_received),
            day: U64(today),
            paid_today: U128(if today == self.day { self.paid_today } else { 0 }),
            daily_cap: U128(self.daily_cap),
            parcel_price: U128(self.parcel_price),
            metagold_per_near: U128(self.metagold_per_near),
            metagold_per_qgold: U128(self.metagold_per_qgold),
            qgold_token: self.qgold_token.clone(),
            recorder: self.recorder.clone(),
            owner: self.owner.clone(),
        }
    }
    pub fn meta_xp_of(&self, account_id: AccountId) -> U64 {
        U64(self.xp.get(&account_id).unwrap_or(0))
    }
    pub fn badges_of(&self, account_id: AccountId) -> Vec<String> {
        self.held.get(&account_id).unwrap_or_default()
    }
    pub fn badge(&self, badge_id: String) -> Option<BadgeDef> {
        self.badges.get(&badge_id)
    }
    pub fn badge_list(&self) -> Vec<(String, BadgeDef)> {
        self.badges.to_vec()
    }
    pub fn is_paid(&self, action_id: String) -> bool {
        self.paid.contains(&action_id)
    }
    pub fn parcel(&self, x0: i32, z0: i32) -> Option<Token> {
        self.nft.nft_token(parcel_id(x0, z0))
    }
}

// ---------- NEP-141 MetaGold ----------

#[near]
impl FungibleTokenCore for MetaLayer {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.ft.ft_transfer(receiver_id, amount, memo)
    }
    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.ft.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.ft.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.ft.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MetaLayer {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.ft.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl FungibleTokenMetadataProvider for MetaLayer {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.ft_meta.get().unwrap()
    }
}

/// One-way conversion: QGOLD sent here with `ft_transfer_call` becomes MetaGold
/// for the sender at the fixed rate. The QGOLD stays in this account for good.
#[near]
impl FungibleTokenReceiver for MetaLayer {
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        require!(self.qgold_token.as_ref() == Some(&token), "Only QGOLD converts into MetaGold");
        let _ = msg;
        let minted = amount.0.checked_mul(self.metagold_per_qgold).unwrap_or_else(|| env::panic_str("Amount too large"));
        require!(minted > 0, "Nothing to convert");
        self.qgold_received += amount.0;
        self.mint_to(&sender_id, minted, "QGOLD converted to MetaGold");
        emit("qgold_converted", serde_json::json!({ "account": sender_id, "qgold": amount, "metagold": U128(minted) }));
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl StorageManagement for MetaLayer {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.ft.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.ft.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(force != Some(true), "MetaGold balances cannot be force-burned");
        self.ft.internal_storage_unregister(force).is_some()
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.ft.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.ft.storage_balance_of(account_id)
    }
}

// ---------- NEP-171 parcels ----------

#[near]
impl NonFungibleTokenCore for MetaLayer {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.nft.nft_transfer(receiver_id, token_id, approval_id, memo)
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.nft.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for MetaLayer {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>,
    ) -> bool {
        self.nft.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenEnumeration for MetaLayer {
    fn nft_total_supply(&self) -> U128 {
        self.nft.nft_total_supply()
    }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens(from_index, limit)
    }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.nft.nft_supply_for_owner(account_id)
    }
    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for MetaLayer {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.nft_meta.get().unwrap()
    }
}

#[cfg(test)]
mod tests;
