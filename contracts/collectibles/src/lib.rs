use near_contract_standards::non_fungible_token::{
    core::{NonFungibleTokenCore, NonFungibleTokenResolver},
    events::NftMint,
    metadata::{
        NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
    },
    refund_deposit_to_account, NonFungibleToken, Token, TokenId,
};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    collections::{LazyOption, LookupMap},
    env,
    json_types::{Base64VecU8, U128},
    near_bindgen, AccountId, PanicOnDefault, Promise, PromiseOrValue,
};
const EXPLORER_MEDIA: &str = include_str!("../assets/explorer-uri.txt");
/// Aura editions this contract can mint: (edition id, title, cover media).
/// Mirrors the `native` entries of server/data/aura-catalog.json (a Node test
/// keeps them equal). Code-only: adding an edition needs no state migration,
/// and token ids stay `aura:<edition>:<serial>` with a 256 cap per edition.
const AURA_EDITIONS: [(&str, &str, &str); 21] = [
    ("polar", "Northern Lights", include_str!("../assets/aura-polar-uri.txt")),
    ("moon", "Moonwake Aura", include_str!("../assets/aura-moon-uri.txt")),
    ("gold", "Sunlit Aura", include_str!("../assets/aura-gold-uri.txt")),
    ("ember", "Ember Wisp", include_str!("../assets/aura-ember-uri.txt")),
    ("dew", "Dewfall Ring", include_str!("../assets/aura-dew-uri.txt")),
    ("bloom", "Meadow Bloom", include_str!("../assets/aura-bloom-uri.txt")),
    ("storm", "Stormcrown", include_str!("../assets/aura-storm-uri.txt")),
    ("comet", "Comet Trail", include_str!("../assets/aura-comet-uri.txt")),
    ("nova", "Nova Bloom", include_str!("../assets/aura-nova-uri.txt")),
    ("pilgrim", "Pilgrim's Path", include_str!("../assets/aura-pilgrim-uri.txt")),
    ("chronicle", "Chronicle Crown", include_str!("../assets/aura-chronicle-uri.txt")),
    ("ledger", "Merchant's Ledger", include_str!("../assets/aura-ledger-uri.txt")),
    ("wardbreaker", "Wardbreaker Horns", include_str!("../assets/aura-wardbreaker-uri.txt")),
    ("wisp", "Will-o'-Wisp Halo", include_str!("../assets/aura-wisp-uri.txt")),
    ("bossbane", "Bossbane Fangring", include_str!("../assets/aura-bossbane-uri.txt")),
    ("stride", "Silver Stride", include_str!("../assets/aura-stride-uri.txt")),
    ("kindle", "Altar Kindle", include_str!("../assets/aura-kindle-uri.txt")),
    ("compass", "Wayfarer's Compass", include_str!("../assets/aura-compass-uri.txt")),
    ("quill", "Storyteller's Quill", include_str!("../assets/aura-quill-uri.txt")),
    ("laurel", "Pathfinder Laurel", include_str!("../assets/aura-laurel-uri.txt")),
    ("summit", "Summit Crown", include_str!("../assets/aura-summit-uri.txt")),
];
/// NPC-, monster- and level-only editions: (edition id, required claim id prefix,
/// token description). They are minted only through a claim whose id carries
/// the prefix (signed award claims via `redeem_aura`, or the oracle's
/// `mint_aura_once`), never by the claim-less oracle `mint_aura`. Anyone can
/// audit where every such token came from with `get_claim`. Mirrors the
/// `source` field of server/data/aura-catalog.json (a Node test keeps them equal).
const CLAIM_ONLY_EDITIONS: [(&str, &str, &str); 12] = [
    ("pilgrim", "earned:npc:", "Earned from a QuestLayer NPC."),
    ("chronicle", "earned:npc:", "Earned from a QuestLayer NPC."),
    ("ledger", "earned:npc:", "Earned from a QuestLayer NPC."),
    ("wisp", "earned:npc:", "Earned from a QuestLayer NPC."),
    ("wardbreaker", "earned:monster:", "Earned by beating a QuestLayer monster."),
    ("bossbane", "earned:monster:", "Earned by beating a QuestLayer monster."),
    ("stride", "earned:level:", "Earned by reaching QuestLayer level 5."),
    ("kindle", "earned:level:", "Earned by reaching QuestLayer level 6."),
    ("compass", "earned:level:", "Earned by reaching QuestLayer level 7."),
    ("quill", "earned:level:", "Earned by reaching QuestLayer level 8."),
    ("laurel", "earned:level:", "Earned by reaching QuestLayer level 9."),
    ("summit", "earned:level:", "Earned by reaching QuestLayer level 10."),
];
fn claim_only(edition: &str) -> Option<(&'static str, &'static str)> {
    CLAIM_ONLY_EDITIONS
        .iter()
        .find(|(id, _, _)| *id == edition)
        .map(|(_, prefix, description)| (*prefix, *description))
}
fn aura_edition(edition: &str) -> Option<(&'static str, &'static str)> {
    AURA_EDITIONS
        .iter()
        .find(|(id, _, _)| *id == edition)
        .map(|(_, name, media)| (*name, *media))
}

/// The chain this deployment lives on, from its own account suffix. A voucher
/// signed for one network can never verify on the other, and only `.testnet`
/// deployments label their tokens as testnet collectibles.
fn network() -> &'static str {
    if env::current_account_id().as_str().ends_with(".testnet") {
        "testnet"
    } else {
        "mainnet"
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum AuraSlot {
    Above,
    Below,
}
impl AuraSlot {
    fn key(self, account: &AccountId) -> String {
        format!(
            "{}:{}",
            account,
            match self {
                Self::Above => "above",
                Self::Below => "below",
            }
        )
    }
}
#[derive(Serialize, Deserialize, Default, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Equipment {
    pub above: Option<TokenId>,
    pub below: Option<TokenId>,
}
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct MintClaim {
    token_id: TokenId,
    receiver_id: AccountId,
    edition: String,
}
// The exact deployed V1 field order is retained for an owner-authorized upgrade.
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct LegacyCollectibles {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    oracle: AccountId,
    minted: LookupMap<String, u32>,
    equipped: LookupMap<AccountId, TokenId>,
}
#[derive(BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct CollectiblesV2 {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    oracle: AccountId,
    minted: LookupMap<String, u32>,
    legacy_equipped: LookupMap<AccountId, TokenId>,
    equipment: LookupMap<String, TokenId>,
    claims: LookupMap<String, MintClaim>,
    schema_version: u32,
}
#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Collectibles {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    oracle: AccountId,
    minted: LookupMap<String, u32>,
    legacy_equipped: LookupMap<AccountId, TokenId>,
    equipment: LookupMap<String, TokenId>,
    claims: LookupMap<String, MintClaim>,
    schema_version: u32,
    award_signer: Option<[u8; 32]>,
}
#[near_bindgen]
impl Collectibles {
    #[init]
    pub fn new(owner_id: AccountId, oracle_id: AccountId) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                b"t".to_vec(),
                owner_id,
                Some(b"m".to_vec()),
                Some(b"e".to_vec()),
                Some(b"a".to_vec()),
            ),
            metadata: LazyOption::new(
                b"c".to_vec(),
                Some(&NFTContractMetadata {
                    spec: NFT_METADATA_SPEC.into(),
                    name: "QuestLayer Collectibles".into(),
                    symbol: "AURA".into(),
                    icon: Some(EXPLORER_MEDIA.trim().into()),
                    base_uri: None,
                    reference: None,
                    reference_hash: None,
                }),
            ),
            oracle: oracle_id,
            minted: LookupMap::new(b"s"),
            legacy_equipped: LookupMap::new(b"w"),
            equipment: LookupMap::new(b"w2".to_vec()),
            claims: LookupMap::new(b"q2".to_vec()),
            schema_version: 3,
            award_signer: None,
        }
    }
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: LegacyCollectibles = env::state_read().expect("V1 state is required");
        assert!(
            env::predecessor_account_id() == old.tokens.owner_id
                || env::predecessor_account_id() == env::current_account_id(),
            "Owner only"
        );
        let mut metadata = old.metadata;
        let mut details = metadata.get().expect("Collection metadata missing");
        details.name = "QuestLayer Collectibles".into();
        details.icon = Some(EXPLORER_MEDIA.trim().into());
        metadata.set(&details);
        Self {
            tokens: old.tokens,
            metadata,
            oracle: old.oracle,
            minted: old.minted,
            legacy_equipped: old.equipped,
            equipment: LookupMap::new(b"w2".to_vec()),
            claims: LookupMap::new(b"q2".to_vec()),
            schema_version: 3,
            award_signer: None,
        }
    }
    #[init(ignore_state)]
    pub fn migrate_v3() -> Self {
        let old: CollectiblesV2 = env::state_read().expect("V2 state is required");
        assert!(
            env::predecessor_account_id() == old.tokens.owner_id
                || env::predecessor_account_id() == env::current_account_id(),
            "Owner only"
        );
        assert_eq!(old.schema_version, 2, "Expected V2 state");
        Self {
            tokens: old.tokens,
            metadata: old.metadata,
            oracle: old.oracle,
            minted: old.minted,
            legacy_equipped: old.legacy_equipped,
            equipment: old.equipment,
            claims: old.claims,
            schema_version: 3,
            award_signer: None,
        }
    }
    #[payable]
    pub fn set_award_signer(&mut self, public_key: Base64VecU8) {
        near_sdk::assert_one_yocto();
        assert_eq!(
            env::predecessor_account_id(),
            self.tokens.owner_id,
            "Owner only"
        );
        self.award_signer = Some(
            public_key
                .0
                .try_into()
                .expect("An Ed25519 public key has 32 bytes"),
        );
    }
    /// Emergency stop for earned claims (for example a leaked voucher key).
    /// Already redeemed claims keep their tokens; `set_award_signer` re-enables.
    #[payable]
    pub fn clear_award_signer(&mut self) {
        near_sdk::assert_one_yocto();
        assert_eq!(
            env::predecessor_account_id(),
            self.tokens.owner_id,
            "Owner only"
        );
        self.award_signer = None;
    }
    pub fn get_award_signer(&self) -> Option<Base64VecU8> {
        self.award_signer.map(|key| Base64VecU8(key.to_vec()))
    }
    pub fn award_message(
        &self,
        claim_id: String,
        edition: String,
        receiver_id: AccountId,
        expires_at_ms: u64,
    ) -> String {
        format!("QuestLayer Aura claim v1\nContract: {}\nNetwork: {}\nClaim: {}\nReceiver: {}\nEdition: {}\nExpires: {}",env::current_account_id(),network(),claim_id,receiver_id,edition,expires_at_ms)
    }
    #[payable]
    pub fn redeem_aura(
        &mut self,
        claim_id: String,
        edition: String,
        receiver_id: AccountId,
        expires_at_ms: u64,
        signature: Base64VecU8,
    ) -> Token {
        assert_eq!(
            env::predecessor_account_id(),
            receiver_id,
            "Claim belongs to a different wallet"
        );
        assert!(
            claim_id.starts_with("earned:")
                && claim_id.len() <= 160
                && claim_id.bytes().all(|b| b.is_ascii_graphic()),
            "Invalid earned claim"
        );
        let key = self.award_signer.expect("Earned claims are not enabled");
        let bytes: [u8; 64] = signature
            .0
            .try_into()
            .expect("An Ed25519 signature has 64 bytes");
        let message = self.award_message(
            claim_id.clone(),
            edition.clone(),
            receiver_id.clone(),
            expires_at_ms,
        );
        assert!(
            env::ed25519_verify(&bytes, message.as_bytes(), &key),
            "Invalid award signature"
        );
        if self.claims.get(&claim_id).is_none() {
            assert!(
                env::block_timestamp_ms() <= expires_at_ms,
                "Award claim expired"
            );
        }
        let (name, media) =
            aura_edition(&edition).unwrap_or_else(|| env::panic_str("Unknown edition"));
        let description = claim_only(&edition)
            .map(|(_, d)| d)
            .unwrap_or("Earned through a QuestLayer adventure.");
        self.mint_claim(
            claim_id,
            edition,
            receiver_id,
            TokenMetadata {
                title: Some(name.into()),
                description: Some(if network() == "testnet" {
                    format!("{description} Testnet collectible.")
                } else {
                    description.into()
                }),
                media: Some(media.trim().into()),
                copies: Some(256),
                ..Default::default()
            },
        )
    }
    pub fn get_version(&self) -> u32 {
        self.schema_version
    }
    #[payable]
    pub fn mint_avatar(&mut self) -> Token {
        let owner = env::predecessor_account_id();
        let token_id = format!("avatar:{}", owner);
        assert!(
            self.tokens.owner_by_id.get(&token_id).is_none(),
            "Starter avatar already minted"
        );
        let initial = env::storage_usage();
        self.finish_mint(
            token_id,
            owner,
            TokenMetadata {
                title: Some("QuestLayer Explorer".into()),
                description: Some("An independent QuestLayer starter explorer.".into()),
                media: Some(EXPLORER_MEDIA.trim().into()),
                copies: Some(1),
                ..Default::default()
            },
            initial,
        )
    }
    #[payable]
    pub fn mint_aura(
        &mut self,
        edition: String,
        receiver_id: AccountId,
        metadata: TokenMetadata,
    ) -> Token {
        self.assert_oracle();
        assert!(
            claim_only(&edition).is_none(),
            "This Aura is only earned from NPCs, monsters or levels"
        );
        let initial = env::storage_usage();
        let token_id = self.next_aura(&edition);
        self.finish_mint(token_id, receiver_id, metadata, initial)
    }
    #[payable]
    pub fn mint_aura_once(
        &mut self,
        claim_id: String,
        edition: String,
        receiver_id: AccountId,
        metadata: TokenMetadata,
    ) -> Token {
        self.assert_oracle();
        self.mint_claim(claim_id, edition, receiver_id, metadata)
    }
    fn mint_claim(
        &mut self,
        claim_id: String,
        edition: String,
        receiver_id: AccountId,
        metadata: TokenMetadata,
    ) -> Token {
        assert!(
            !claim_id.is_empty() && claim_id.len() <= 160,
            "Invalid claim ID"
        );
        if let Some((prefix, _)) = claim_only(&edition) {
            assert!(
                claim_id.starts_with(prefix),
                "This Aura is only earned from NPCs, monsters or levels"
            );
        }
        if let Some(old) = self.claims.get(&claim_id) {
            assert!(
                old.receiver_id == receiver_id && old.edition == edition,
                "Claim parameters changed"
            );
            refund_deposit_to_account(0, env::predecessor_account_id());
            return self
                .tokens
                .nft_token(old.token_id)
                .expect("Minted token missing");
        };
        let initial = env::storage_usage();
        let token_id = self.next_aura(&edition);
        self.claims.insert(
            &claim_id,
            &MintClaim {
                token_id: token_id.clone(),
                receiver_id: receiver_id.clone(),
                edition,
            },
        );
        self.finish_mint(token_id, receiver_id, metadata, initial)
    }
    pub fn get_claim(&self, claim_id: String) -> Option<near_sdk::serde_json::Value> {
        self.claims.get(&claim_id).map(|claim|near_sdk::serde_json::json!({"token_id":claim.token_id,"receiver_id":claim.receiver_id,"edition":claim.edition}))
    }
    pub fn get_claim_token(&self, claim_id: String) -> Option<TokenId> {
        self.claims.get(&claim_id).map(|c| c.token_id)
    }
    /// Edition ids this deployment can mint, in catalog order.
    pub fn supported_editions(&self) -> Vec<String> {
        AURA_EDITIONS.iter().map(|(id, _, _)| id.to_string()).collect()
    }
    /// NPC- and monster-only editions and the claim id prefix each requires.
    pub fn claim_only_editions(&self) -> Vec<(String, String)> {
        CLAIM_ONLY_EDITIONS
            .iter()
            .map(|(id, prefix, _)| (id.to_string(), prefix.to_string()))
            .collect()
    }
    pub fn edition_minted(&self, edition: String) -> u32 {
        self.minted.get(&edition).unwrap_or(0)
    }
    pub fn equip_aura(&mut self, token_id: TokenId, slot: Option<AuraSlot>) {
        let owner = env::predecessor_account_id();
        assert_eq!(
            self.tokens.owner_by_id.get(&token_id),
            Some(owner.clone()),
            "Not owner"
        );
        assert!(token_id.starts_with("aura:"), "Not an Aura");
        self.migrate_equipment(&owner);
        self.clear_equipped(&token_id);
        self.equipment
            .insert(&slot.unwrap_or(AuraSlot::Above).key(&owner), &token_id);
    }
    pub fn unequip_aura(&mut self, slot: AuraSlot) {
        let owner = env::predecessor_account_id();
        self.migrate_equipment(&owner);
        self.equipment.remove(&slot.key(&owner));
    }
    pub fn get_equipment(&self, account_id: AccountId) -> Equipment {
        let below = self.owned_slot(&account_id, AuraSlot::Below);
        let above = self.owned_slot(&account_id, AuraSlot::Above).or_else(|| {
            self.legacy_equipped.get(&account_id).filter(|t| {
                self.tokens.owner_by_id.get(t) == Some(account_id.clone())
                    && below.as_ref() != Some(t)
            })
        });
        Equipment { above, below }
    }
    // Kept for existing V1 clients; the new view returns both independent positions.
    pub fn get_equipped(&self, account_id: AccountId) -> Option<TokenId> {
        let e = self.get_equipment(account_id);
        e.above.or(e.below)
    }
    fn assert_oracle(&self) {
        assert_eq!(env::predecessor_account_id(), self.oracle, "Oracle only");
    }
    fn next_aura(&mut self, edition: &String) -> TokenId {
        assert!(aura_edition(edition).is_some(), "Unknown edition");
        let n = self.minted.get(edition).unwrap_or(0);
        assert!(n < 256, "Edition exhausted");
        self.minted.insert(edition, &(n + 1));
        format!("aura:{}:{}", edition, n + 1)
    }
    fn finish_mint(
        &mut self,
        token_id: TokenId,
        owner: AccountId,
        metadata: TokenMetadata,
        initial: u64,
    ) -> Token {
        let token = self
            .tokens
            .internal_mint_with_refund(token_id, owner, Some(metadata), None);
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: None,
        }
        .emit();
        refund_deposit_to_account(
            env::storage_usage() - initial,
            env::predecessor_account_id(),
        );
        token
    }
    fn owned_slot(&self, owner: &AccountId, slot: AuraSlot) -> Option<TokenId> {
        self.equipment
            .get(&slot.key(owner))
            .filter(|t| self.tokens.owner_by_id.get(t) == Some(owner.clone()))
    }
    fn migrate_equipment(&mut self, owner: &AccountId) {
        if let Some(token) = self.legacy_equipped.remove(owner) {
            if self.tokens.owner_by_id.get(&token) == Some(owner.clone())
                && self.equipment.get(&AuraSlot::Above.key(owner)).is_none()
            {
                self.equipment.insert(&AuraSlot::Above.key(owner), &token);
            }
        }
    }
    fn clear_owner_equipment(&mut self, owner: &AccountId, token_id: &TokenId) {
        if self.legacy_equipped.get(owner).as_ref() == Some(token_id) {
            self.legacy_equipped.remove(owner);
        }
        for slot in [AuraSlot::Above, AuraSlot::Below] {
            let key = slot.key(owner);
            if self.equipment.get(&key).as_ref() == Some(token_id) {
                self.equipment.remove(&key);
            }
        }
    }
    fn clear_equipped(&mut self, token_id: &TokenId) {
        if let Some(owner) = self.tokens.owner_by_id.get(token_id) {
            self.clear_owner_equipment(&owner, token_id);
        }
    }
}
#[near_bindgen]
impl NonFungibleTokenCore for Collectibles {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.clear_equipped(&token_id);
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo);
    }
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.clear_equipped(&token_id);
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }
    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}
#[near_bindgen]
impl NonFungibleTokenResolver for Collectibles {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>,
    ) -> bool {
        let receiver = receiver_id.clone();
        let token = token_id.clone();
        let kept = self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        );
        if self.tokens.owner_by_id.get(&token) != Some(receiver.clone()) {
            self.clear_owner_equipment(&receiver, &token);
        }
        kept
    }
}
#[near_bindgen]
impl near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval
    for Collectibles
{
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }
    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }
    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }
    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}
#[near_bindgen]
impl near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration
    for Collectibles
{
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }
    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}
#[near_bindgen]
impl NonFungibleTokenMetadataProvider for Collectibles {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, NearToken};
    fn a(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn context(who: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("nfts.testnet"))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(deposit);
        testing_env!(b.build());
    }
    fn fresh() -> Collectibles {
        context("oracle.testnet", NearToken::from_near(1));
        Collectibles::new(a("owner.testnet"), a("oracle.testnet"))
    }
    fn mint(c: &mut Collectibles, edition: &str) -> Token {
        context("oracle.testnet", NearToken::from_near(1));
        c.mint_aura(
            edition.into(),
            a("alice.testnet"),
            TokenMetadata {
                title: Some(format!("{} Aura", edition)),
                ..Default::default()
            },
        )
    }
    #[test]
    fn transfer_removes_old_equipment_and_changes_owner() {
        let mut c = fresh();
        let t = mint(&mut c, "polar");
        context("alice.testnet", NearToken::from_yoctonear(0));
        c.equip_aura(t.token_id.clone(), None);
        assert_eq!(c.get_equipped(a("alice.testnet")), Some(t.token_id.clone()));
        context("alice.testnet", NearToken::from_yoctonear(1));
        c.nft_transfer(a("bob.testnet"), t.token_id.clone(), None, None);
        assert_eq!(c.get_equipped(a("alice.testnet")), None);
        assert_eq!(
            c.nft_token(t.token_id.clone()).unwrap().owner_id,
            a("bob.testnet")
        );
        context("bob.testnet", NearToken::from_yoctonear(0));
        c.equip_aura(t.token_id.clone(), Some(AuraSlot::Below));
        assert_eq!(c.get_equipment(a("bob.testnet")).below, Some(t.token_id));
    }
    #[test]
    fn independent_slots_and_moving_one_item() {
        let mut c = fresh();
        let p = mint(&mut c, "polar");
        let m = mint(&mut c, "moon");
        context("alice.testnet", NearToken::from_yoctonear(0));
        c.equip_aura(p.token_id.clone(), Some(AuraSlot::Above));
        c.equip_aura(m.token_id.clone(), Some(AuraSlot::Below));
        assert_eq!(
            c.get_equipment(a("alice.testnet")),
            Equipment {
                above: Some(p.token_id.clone()),
                below: Some(m.token_id)
            }
        );
        c.equip_aura(p.token_id.clone(), Some(AuraSlot::Below));
        assert_eq!(
            c.get_equipment(a("alice.testnet")),
            Equipment {
                above: None,
                below: Some(p.token_id)
            }
        );
        c.unequip_aura(AuraSlot::Below);
        assert_eq!(c.get_equipment(a("alice.testnet")), Equipment::default());
    }
    #[test]
    fn once_only_mint_preserves_the_claim_after_transfer() {
        let mut c = fresh();
        let t = c.mint_aura_once(
            "claim:1".into(),
            "polar".into(),
            a("alice.testnet"),
            TokenMetadata::default(),
        );
        context("alice.testnet", NearToken::from_yoctonear(1));
        c.nft_transfer(a("bob.testnet"), t.token_id.clone(), None, None);
        context("oracle.testnet", NearToken::from_near(1));
        let retried = c.mint_aura_once(
            "claim:1".into(),
            "polar".into(),
            a("alice.testnet"),
            TokenMetadata::default(),
        );
        assert_eq!(retried.token_id, t.token_id);
        assert_eq!(retried.owner_id, a("bob.testnet"));
        assert_eq!(c.edition_minted("polar".into()), 1);
    }
    #[test]
    #[allow(deprecated)]
    fn returned_transfer_removes_receiver_equipment_storage() {
        let mut c = fresh();
        let token = mint(&mut c, "polar");
        context("alice.testnet", NearToken::from_yoctonear(1));
        let _ = c.nft_transfer_call(
            a("bob.testnet"),
            token.token_id.clone(),
            None,
            None,
            "test".into(),
        );
        context("bob.testnet", NearToken::from_yoctonear(0));
        c.equip_aura(token.token_id.clone(), Some(AuraSlot::Below));
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("nfts.testnet"))
            .predecessor_account_id(a("nfts.testnet"))
            .signer_account_id(a("alice.testnet"))
            .account_balance(NearToken::from_near(100));
        near_sdk::test_utils::testing_env_with_promise_results(
            b.build(),
            near_sdk::PromiseResult::Successful(b"true".to_vec()),
        );
        c.nft_resolve_transfer(
            a("alice.testnet"),
            a("bob.testnet"),
            token.token_id.clone(),
            None,
        );
        assert_eq!(
            c.nft_token(token.token_id).unwrap().owner_id,
            a("alice.testnet")
        );
        assert_eq!(c.get_equipment(a("bob.testnet")), Equipment::default());
        assert!(c
            .equipment
            .get(&AuraSlot::Below.key(&a("bob.testnet")))
            .is_none());
    }
    #[test]
    fn starter_avatar_is_owned_by_its_minter() {
        let mut c = fresh();
        context("alice.testnet", NearToken::from_near(1));
        let t = c.mint_avatar();
        assert_eq!(t.token_id, "avatar:alice.testnet");
        assert_eq!(t.owner_id, a("alice.testnet"));
        assert!(t
            .metadata
            .unwrap()
            .media
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
    }
    #[test]
    fn migration_preserves_tokens_counters_and_legacy_equipment() {
        let mut c = fresh();
        let t = mint(&mut c, "polar");
        c.legacy_equipped.insert(&a("alice.testnet"), &t.token_id);
        let old = LegacyCollectibles {
            tokens: c.tokens,
            metadata: c.metadata,
            oracle: c.oracle,
            minted: c.minted,
            equipped: c.legacy_equipped,
        };
        env::state_write(&old);
        context("owner.testnet", NearToken::from_yoctonear(0));
        let mut migrated = Collectibles::migrate();
        assert_eq!(migrated.get_version(), 3);
        assert_eq!(migrated.edition_minted("polar".into()), 1);
        assert_eq!(
            migrated.get_equipment(a("alice.testnet")).above,
            Some(t.token_id.clone())
        );
        context("alice.testnet", NearToken::from_yoctonear(0));
        migrated.equip_aura(t.token_id.clone(), Some(AuraSlot::Below));
        assert_eq!(
            migrated.get_equipment(a("alice.testnet")),
            Equipment {
                above: None,
                below: Some(t.token_id)
            }
        );
    }
    #[test]
    fn deployment_account_can_migrate_atomically() {
        let c = fresh();
        env::state_write(&LegacyCollectibles {
            tokens: c.tokens,
            metadata: c.metadata,
            oracle: c.oracle,
            minted: c.minted,
            equipped: c.legacy_equipped,
        });
        context("nfts.testnet", NearToken::from_yoctonear(0));
        assert_eq!(Collectibles::migrate().get_version(), 3);
    }
    #[test]
    #[should_panic(expected = "Owner only")]
    fn stranger_cannot_migrate() {
        let c = fresh();
        env::state_write(&LegacyCollectibles {
            tokens: c.tokens,
            metadata: c.metadata,
            oracle: c.oracle,
            minted: c.minted,
            equipped: c.legacy_equipped,
        });
        context("attacker.testnet", NearToken::from_yoctonear(0));
        Collectibles::migrate();
    }
    #[test]
    #[should_panic(expected = "Not owner")]
    fn stranger_cannot_equip() {
        let mut c = fresh();
        let t = mint(&mut c, "polar");
        context("attacker.testnet", NearToken::from_yoctonear(0));
        c.equip_aura(t.token_id, None);
    }
    #[test]
    #[should_panic(expected = "Edition exhausted")]
    fn edition_cap_is_enforced() {
        let mut c = fresh();
        c.minted.insert(&"polar".into(), &255);
        mint(&mut c, "polar");
        assert_eq!(c.edition_minted("polar".into()), 256);
        mint(&mut c, "polar");
    }
    #[test]
    #[should_panic(expected = "Oracle only")]
    fn public_mint_rejected() {
        let mut c = fresh();
        context("attacker.testnet", NearToken::from_near(1));
        c.mint_aura(
            "polar".into(),
            a("attacker.testnet"),
            TokenMetadata::default(),
        );
    }
    #[test]
    #[should_panic(expected = "Starter avatar already minted")]
    fn starter_cannot_be_minted_twice() {
        let mut c = fresh();
        context("alice.testnet", NearToken::from_near(1));
        c.mint_avatar();
        context("alice.testnet", NearToken::from_near(1));
        c.mint_avatar();
    }
    #[test]
    #[should_panic(expected = "Claim parameters changed")]
    fn claim_cannot_redirect_a_retried_mint() {
        let mut c = fresh();
        c.mint_aura_once(
            "claim:1".into(),
            "polar".into(),
            a("alice.testnet"),
            TokenMetadata::default(),
        );
        context("oracle.testnet", NearToken::from_near(1));
        c.mint_aura_once(
            "claim:1".into(),
            "polar".into(),
            a("bob.testnet"),
            TokenMetadata::default(),
        );
    }
    fn award_key(c: &mut Collectibles) -> ed25519_dalek::SigningKey {
        let key = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
        context("owner.testnet", NearToken::from_yoctonear(1));
        c.set_award_signer(Base64VecU8(key.verifying_key().to_bytes().to_vec()));
        key
    }
    fn award_signature(
        c: &Collectibles,
        key: &ed25519_dalek::SigningKey,
        claim: &str,
        edition: &str,
        receiver: &str,
        expiry: u64,
    ) -> Base64VecU8 {
        use ed25519_dalek::Signer;
        Base64VecU8(
            key.sign(
                c.award_message(claim.into(), edition.into(), a(receiver), expiry)
                    .as_bytes(),
            )
            .to_bytes()
            .to_vec(),
        )
    }
    #[test]
    fn signed_award_redeems_once_and_survives_transfer() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:1", "polar", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        let token = c.redeem_aura(
            "earned:1".into(),
            "polar".into(),
            a("alice.testnet"),
            1000,
            signature.clone(),
        );
        assert_eq!(token.token_id, "aura:polar:1");
        assert!(token
            .metadata
            .unwrap()
            .media
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
        context("alice.testnet", NearToken::from_yoctonear(1));
        c.nft_transfer(a("bob.testnet"), token.token_id.clone(), None, None);
        context("alice.testnet", NearToken::from_near(1));
        let replay = c.redeem_aura(
            "earned:1".into(),
            "polar".into(),
            a("alice.testnet"),
            1000,
            signature,
        );
        assert_eq!(replay.owner_id, a("bob.testnet"));
        assert_eq!(c.edition_minted("polar".into()), 1);
    }
    #[test]
    fn catalog_editions_redeem_with_their_own_title_and_media() {
        let mut c = fresh();
        let key = award_key(&mut c);
        assert_eq!(
            c.supported_editions(),
            [
                "polar", "moon", "gold", "ember", "dew", "bloom", "storm", "comet", "nova",
                "pilgrim", "chronicle", "ledger", "wardbreaker", "wisp", "bossbane",
                "stride", "kindle", "compass", "quill", "laurel", "summit"
            ]
        );
        let mut covers = std::collections::HashSet::new();
        for (i, (edition, title)) in [
            ("ember", "Ember Wisp"),
            ("dew", "Dewfall Ring"),
            ("bloom", "Meadow Bloom"),
            ("storm", "Stormcrown"),
            ("comet", "Comet Trail"),
            ("nova", "Nova Bloom"),
        ]
        .into_iter()
        .enumerate()
        {
            let claim = format!("earned:new{i}");
            let signature =
                award_signature(&c, &key, &claim, edition, "alice.testnet", 1000);
            context("alice.testnet", NearToken::from_near(1));
            let token = c.redeem_aura(
                claim,
                edition.into(),
                a("alice.testnet"),
                1000,
                signature,
            );
            assert_eq!(token.token_id, format!("aura:{edition}:1"));
            let meta = token.metadata.unwrap();
            assert_eq!(meta.title.as_deref(), Some(title));
            let media = meta.media.unwrap();
            assert!(media.starts_with("data:image/svg+xml;base64,"));
            assert!(covers.insert(media));
            assert_eq!(c.edition_minted(edition.into()), 1);
        }
        // Existing editions keep their own counters.
        assert_eq!(c.edition_minted("polar".into()), 0);
    }
    #[test]
    fn npc_and_monster_editions_redeem_only_with_their_claim_prefix() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let mut covers = std::collections::HashSet::new();
        for (i, (edition, title, prefix, description)) in [
            ("pilgrim", "Pilgrim's Path", "earned:npc:", "Earned from a QuestLayer NPC. Testnet collectible."),
            ("chronicle", "Chronicle Crown", "earned:npc:", "Earned from a QuestLayer NPC. Testnet collectible."),
            ("ledger", "Merchant's Ledger", "earned:npc:", "Earned from a QuestLayer NPC. Testnet collectible."),
            ("wisp", "Will-o'-Wisp Halo", "earned:npc:", "Earned from a QuestLayer NPC. Testnet collectible."),
            ("wardbreaker", "Wardbreaker Horns", "earned:monster:", "Earned by beating a QuestLayer monster. Testnet collectible."),
            ("bossbane", "Bossbane Fangring", "earned:monster:", "Earned by beating a QuestLayer monster. Testnet collectible."),
            ("stride", "Silver Stride", "earned:level:", "Earned by reaching QuestLayer level 5. Testnet collectible."),
            ("kindle", "Altar Kindle", "earned:level:", "Earned by reaching QuestLayer level 6. Testnet collectible."),
            ("compass", "Wayfarer's Compass", "earned:level:", "Earned by reaching QuestLayer level 7. Testnet collectible."),
            ("quill", "Storyteller's Quill", "earned:level:", "Earned by reaching QuestLayer level 8. Testnet collectible."),
            ("laurel", "Pathfinder Laurel", "earned:level:", "Earned by reaching QuestLayer level 9. Testnet collectible."),
            ("summit", "Summit Crown", "earned:level:", "Earned by reaching QuestLayer level 10. Testnet collectible."),
        ]
        .into_iter()
        .enumerate()
        {
            let claim = format!("{prefix}plzen:x{i}");
            let signature = award_signature(&c, &key, &claim, edition, "alice.testnet", 1000);
            context("alice.testnet", NearToken::from_near(1));
            let token = c.redeem_aura(
                claim.clone(),
                edition.into(),
                a("alice.testnet"),
                1000,
                signature.clone(),
            );
            assert_eq!(token.token_id, format!("aura:{edition}:1"));
            let meta = token.metadata.unwrap();
            assert_eq!(meta.title.as_deref(), Some(title));
            assert_eq!(meta.description.as_deref(), Some(description));
            assert!(covers.insert(meta.media.unwrap()));
            // Replays return the same token.
            context("alice.testnet", NearToken::from_near(1));
            let again = c.redeem_aura(claim, edition.into(), a("alice.testnet"), 1000, signature);
            assert_eq!(again.token_id, token.token_id);
            assert_eq!(c.edition_minted(edition.into()), 1);
        }
        assert_eq!(c.claim_only_editions().len(), 12);
        assert!(c
            .claim_only_editions()
            .iter()
            .all(|(id, _)| c.supported_editions().contains(id)));
        // Chest editions keep their plain description.
        let signature = award_signature(&c, &key, "earned:chest1", "ember", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        let ember = c.redeem_aura("earned:chest1".into(), "ember".into(), a("alice.testnet"), 1000, signature);
        assert_eq!(
            ember.metadata.unwrap().description.as_deref(),
            Some("Earned through a QuestLayer adventure. Testnet collectible.")
        );
    }
    #[test]
    #[should_panic(expected = "This Aura is only earned from NPCs, monsters or levels")]
    fn npc_edition_rejects_a_plain_earned_claim() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:chest9", "wisp", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura("earned:chest9".into(), "wisp".into(), a("alice.testnet"), 1000, signature);
    }
    #[test]
    #[should_panic(expected = "This Aura is only earned from NPCs, monsters or levels")]
    fn level_edition_rejects_an_npc_claim() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature =
            award_signature(&c, &key, "earned:npc:plzen:2", "summit", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura("earned:npc:plzen:2".into(), "summit".into(), a("alice.testnet"), 1000, signature);
    }
    #[test]
    #[should_panic(expected = "This Aura is only earned from NPCs, monsters or levels")]
    fn oracle_cannot_mint_level_editions_without_a_claim() {
        let mut c = fresh();
        mint(&mut c, "laurel");
    }
    #[test]
    #[should_panic(expected = "This Aura is only earned from NPCs, monsters or levels")]
    fn monster_edition_rejects_an_npc_claim() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature =
            award_signature(&c, &key, "earned:npc:plzen:1", "bossbane", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura("earned:npc:plzen:1".into(), "bossbane".into(), a("alice.testnet"), 1000, signature);
    }
    #[test]
    #[should_panic(expected = "This Aura is only earned from NPCs, monsters or levels")]
    fn oracle_cannot_mint_npc_editions_without_a_claim() {
        let mut c = fresh();
        mint(&mut c, "wardbreaker");
    }
    #[test]
    #[should_panic(expected = "This Aura is only earned from NPCs, monsters or levels")]
    fn oracle_claim_mint_needs_the_prefix_too() {
        let mut c = fresh();
        context("oracle.testnet", NearToken::from_near(1));
        c.mint_aura_once(
            "chest:1".into(),
            "ledger".into(),
            a("alice.testnet"),
            TokenMetadata::default(),
        );
    }
    #[test]
    fn oracle_claim_mint_with_the_prefix_works() {
        let mut c = fresh();
        context("oracle.testnet", NearToken::from_near(1));
        let t = c.mint_aura_once(
            "earned:npc:trader:1".into(),
            "ledger".into(),
            a("alice.testnet"),
            TokenMetadata::default(),
        );
        assert_eq!(t.token_id, "aura:ledger:1");
    }
    #[test]
    #[should_panic(expected = "Unknown edition")]
    fn unknown_edition_is_still_rejected() {
        let mut c = fresh();
        mint(&mut c, "festival");
    }
    #[test]
    #[should_panic(expected = "Invalid award signature")]
    fn award_signature_cannot_change_edition() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:2", "polar", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura(
            "earned:2".into(),
            "moon".into(),
            a("alice.testnet"),
            1000,
            signature,
        );
    }
    #[test]
    #[should_panic(expected = "Invalid award signature")]
    fn award_signature_is_bound_to_contract() {
        use ed25519_dalek::Signer;
        let mut c = fresh();
        let key = award_key(&mut c);
        let message = c
            .award_message("earned:3".into(), "polar".into(), a("alice.testnet"), 1000)
            .replace("nfts.testnet", "other.testnet");
        let signature = Base64VecU8(key.sign(message.as_bytes()).to_bytes().to_vec());
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura(
            "earned:3".into(),
            "polar".into(),
            a("alice.testnet"),
            1000,
            signature,
        );
    }
    #[test]
    #[should_panic(expected = "different wallet")]
    fn another_wallet_cannot_redeem_a_signed_award() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:4", "polar", "alice.testnet", 1000);
        context("mallory.testnet", NearToken::from_near(1));
        c.redeem_aura(
            "earned:4".into(),
            "polar".into(),
            a("alice.testnet"),
            1000,
            signature,
        );
    }
    #[test]
    #[should_panic(expected = "Award claim expired")]
    fn unredeemed_award_expires_on_chain() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:5", "polar", "alice.testnet", 1);
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("nfts.testnet"))
            .predecessor_account_id(a("alice.testnet"))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(2_000_000);
        testing_env!(b.build());
        c.redeem_aura(
            "earned:5".into(),
            "polar".into(),
            a("alice.testnet"),
            1,
            signature,
        );
    }
    #[test]
    fn v2_migration_preserves_claims_and_both_equipment_slots() {
        let mut c = fresh();
        context("oracle.testnet", NearToken::from_near(1));
        let token = c.mint_aura_once(
            "old:1".into(),
            "polar".into(),
            a("alice.testnet"),
            TokenMetadata::default(),
        );
        context("alice.testnet", NearToken::from_near(1));
        c.equip_aura(token.token_id.clone(), Some(AuraSlot::Below));
        let old = CollectiblesV2 {
            tokens: c.tokens,
            metadata: c.metadata,
            oracle: c.oracle,
            minted: c.minted,
            legacy_equipped: c.legacy_equipped,
            equipment: c.equipment,
            claims: c.claims,
            schema_version: 2,
        };
        env::state_write(&old);
        context("owner.testnet", NearToken::from_near(0));
        let migrated = Collectibles::migrate_v3();
        assert_eq!(migrated.get_version(), 3);
        assert_eq!(
            migrated.get_claim_token("old:1".into()),
            Some(token.token_id.clone())
        );
        assert_eq!(
            migrated.get_equipment(a("alice.testnet")).below,
            Some(token.token_id)
        );
        assert!(migrated.get_award_signer().is_none());
    }
    // Mainnet review (docs/COLLECTIBLES-REVIEW.md): the same code must work on a
    // `.near` deployment, and a voucher must never cross networks.
    fn on(contract: &str, who: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a(contract))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(deposit);
        testing_env!(b.build());
    }
    fn mainnet() -> (Collectibles, ed25519_dalek::SigningKey) {
        on("nfts.questlayer.near", "owner.near", NearToken::from_near(0));
        let mut c = Collectibles::new(a("owner.near"), a("owner.near"));
        let key = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
        on("nfts.questlayer.near", "owner.near", NearToken::from_yoctonear(1));
        c.set_award_signer(Base64VecU8(key.verifying_key().to_bytes().to_vec()));
        (c, key)
    }
    #[test]
    fn mainnet_deployment_redeems_with_a_mainnet_voucher() {
        let (mut c, key) = mainnet();
        let message = c.award_message("earned:m1".into(), "gold".into(), a("bob.near"), 1000);
        assert!(message.contains("\nNetwork: mainnet\n"), "{message}");
        let signature = award_signature(&c, &key, "earned:m1", "gold", "bob.near", 1000);
        on("nfts.questlayer.near", "bob.near", NearToken::from_millinear(50));
        let token = c.redeem_aura(
            "earned:m1".into(),
            "gold".into(),
            a("bob.near"),
            1000,
            signature,
        );
        assert_eq!(token.owner_id, a("bob.near"));
        let description = token.metadata.unwrap().description.unwrap();
        assert!(!description.contains("Testnet"), "{description}");
    }
    #[test]
    #[should_panic(expected = "Invalid award signature")]
    fn testnet_voucher_cannot_redeem_on_mainnet() {
        use ed25519_dalek::Signer;
        let (mut c, key) = mainnet();
        let message = c
            .award_message("earned:m2".into(), "gold".into(), a("bob.near"), 1000)
            .replace("Network: mainnet", "Network: testnet");
        let signature = Base64VecU8(key.sign(message.as_bytes()).to_bytes().to_vec());
        on("nfts.questlayer.near", "bob.near", NearToken::from_near(1));
        c.redeem_aura("earned:m2".into(), "gold".into(), a("bob.near"), 1000, signature);
    }
    #[test]
    fn testnet_message_and_description_are_unchanged() {
        let mut c = fresh();
        let key = award_key(&mut c);
        assert_eq!(
            c.award_message("earned:t".into(), "moon".into(), a("alice.testnet"), 7),
            "QuestLayer Aura claim v1\nContract: nfts.testnet\nNetwork: testnet\nClaim: earned:t\nReceiver: alice.testnet\nEdition: moon\nExpires: 7"
        );
        let signature = award_signature(&c, &key, "earned:t", "moon", "alice.testnet", 7);
        context("alice.testnet", NearToken::from_near(1));
        let token = c.redeem_aura("earned:t".into(), "moon".into(), a("alice.testnet"), 7, signature);
        assert_eq!(
            token.metadata.unwrap().description.as_deref(),
            Some("Earned through a QuestLayer adventure. Testnet collectible.")
        );
    }
    #[test]
    #[should_panic(expected = "Invalid earned claim")]
    fn claim_id_cannot_carry_line_breaks() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let claim = "earned:x\nReceiver: mallory.testnet";
        let signature = award_signature(&c, &key, claim, "polar", "alice.testnet", 1000);
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura(claim.into(), "polar".into(), a("alice.testnet"), 1000, signature);
    }
    #[test]
    #[should_panic(expected = "Earned claims are not enabled")]
    fn cleared_award_signer_stops_new_claims() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:9", "polar", "alice.testnet", 1000);
        context("owner.testnet", NearToken::from_yoctonear(1));
        c.clear_award_signer();
        assert!(c.get_award_signer().is_none());
        context("alice.testnet", NearToken::from_near(1));
        c.redeem_aura("earned:9".into(), "polar".into(), a("alice.testnet"), 1000, signature);
    }
    #[test]
    #[should_panic(expected = "Owner only")]
    fn stranger_cannot_clear_award_signer() {
        let mut c = fresh();
        award_key(&mut c);
        context("oracle.testnet", NearToken::from_yoctonear(1));
        c.clear_award_signer();
    }
    #[test]
    #[should_panic(expected = "Owner only")]
    fn oracle_cannot_replace_award_signer() {
        let mut c = fresh();
        context("oracle.testnet", NearToken::from_yoctonear(1));
        c.set_award_signer(Base64VecU8(vec![1u8; 32]));
    }
    #[test]
    #[should_panic(expected = "Must attach")]
    fn mint_without_storage_deposit_is_rejected() {
        let mut c = fresh();
        context("alice.testnet", NearToken::from_yoctonear(0));
        c.mint_avatar();
    }
    #[test]
    fn retried_redeem_after_expiry_returns_the_same_token() {
        let mut c = fresh();
        let key = award_key(&mut c);
        let signature = award_signature(&c, &key, "earned:r", "gold", "alice.testnet", 1);
        context("alice.testnet", NearToken::from_near(1));
        let first = c.redeem_aura("earned:r".into(), "gold".into(), a("alice.testnet"), 1, signature.clone());
        let mut b = VMContextBuilder::new();
        b.current_account_id(a("nfts.testnet"))
            .predecessor_account_id(a("alice.testnet"))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(2_000_000_000);
        testing_env!(b.build());
        let again = c.redeem_aura("earned:r".into(), "gold".into(), a("alice.testnet"), 1, signature);
        assert_eq!(first.token_id, again.token_id);
        assert_eq!(c.edition_minted("gold".into()), 1);
    }
}
