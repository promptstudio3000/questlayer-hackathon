use near_contract_standards::non_fungible_token::{NonFungibleToken,Token,TokenId,core::{NonFungibleTokenCore,NonFungibleTokenResolver},metadata::{NFTContractMetadata,NonFungibleTokenMetadataProvider,TokenMetadata,NFT_METADATA_SPEC}};
use near_sdk::{collections::{LazyOption,LookupMap},env,json_types::U128,near_bindgen,AccountId,PanicOnDefault,Promise,PromiseOrValue};

#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Collectibles { tokens:NonFungibleToken,metadata:LazyOption<NFTContractMetadata>,oracle:AccountId,minted:LookupMap<String,u32>,equipped:LookupMap<AccountId,TokenId> }
#[near_bindgen]
impl Collectibles{
 #[init]pub fn new(owner_id:AccountId,oracle_id:AccountId)->Self{Self{tokens:NonFungibleToken::new(b"t".to_vec(),owner_id,Some(b"m".to_vec()),Some(b"e".to_vec()),Some(b"a".to_vec())),metadata:LazyOption::new(b"c".to_vec(),Some(&NFTContractMetadata{spec:NFT_METADATA_SPEC.into(),name:"QuestLayer Collectibles".into(),symbol:"AURA".into(),icon:None,base_uri:None,reference:None,reference_hash:None})),oracle:oracle_id,minted:LookupMap::new(b"s"),equipped:LookupMap::new(b"w")}}
 #[payable]pub fn mint_aura(&mut self,edition:String,receiver_id:AccountId,metadata:TokenMetadata)->Token{
  assert_eq!(env::predecessor_account_id(),self.oracle,"Oracle only");assert!(["polar","moon","gold"].contains(&edition.as_str()),"Unknown edition");let n=self.minted.get(&edition).unwrap_or(0);assert!(n<256,"Edition exhausted");self.minted.insert(&edition,&(n+1));self.tokens.internal_mint(format!("aura:{}:{}",edition,n+1),receiver_id,Some(metadata))
 }
 pub fn equip_aura(&mut self,token_id:TokenId){let a=env::predecessor_account_id();assert_eq!(self.tokens.owner_by_id.get(&token_id),Some(a.clone()),"Not owner");assert!(token_id.starts_with("aura:"),"Not an Aura");self.equipped.insert(&a,&token_id);}
 pub fn get_equipped(&self,account_id:AccountId)->Option<TokenId>{let t=self.equipped.get(&account_id)?;if self.tokens.owner_by_id.get(&t)==Some(account_id){Some(t)}else{None}}
 fn clear_equipped(&mut self,token_id:&TokenId){if let Some(owner)=self.tokens.owner_by_id.get(token_id){if self.equipped.get(&owner).as_ref()==Some(token_id){self.equipped.remove(&owner);}}}
}
#[near_bindgen]impl NonFungibleTokenCore for Collectibles{
 #[payable]fn nft_transfer(&mut self,receiver_id:AccountId,token_id:TokenId,approval_id:Option<u64>,memo:Option<String>){self.clear_equipped(&token_id);self.tokens.nft_transfer(receiver_id,token_id,approval_id,memo);}
 #[payable]fn nft_transfer_call(&mut self,receiver_id:AccountId,token_id:TokenId,approval_id:Option<u64>,memo:Option<String>,msg:String)->PromiseOrValue<bool>{self.clear_equipped(&token_id);self.tokens.nft_transfer_call(receiver_id,token_id,approval_id,memo,msg)}
 fn nft_token(&self,token_id:TokenId)->Option<Token>{self.tokens.nft_token(token_id)}
}
#[near_bindgen]impl NonFungibleTokenResolver for Collectibles{
 #[private]fn nft_resolve_transfer(&mut self,previous_owner_id:AccountId,receiver_id:AccountId,token_id:TokenId,approved_account_ids:Option<std::collections::HashMap<AccountId,u64>>)->bool{self.tokens.nft_resolve_transfer(previous_owner_id,receiver_id,token_id,approved_account_ids)}
}
#[near_bindgen]impl near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval for Collectibles{
 #[payable]fn nft_approve(&mut self,token_id:TokenId,account_id:AccountId,msg:Option<String>)->Option<Promise>{self.tokens.nft_approve(token_id,account_id,msg)}
 #[payable]fn nft_revoke(&mut self,token_id:TokenId,account_id:AccountId){self.tokens.nft_revoke(token_id,account_id)}
 #[payable]fn nft_revoke_all(&mut self,token_id:TokenId){self.tokens.nft_revoke_all(token_id)}
 fn nft_is_approved(&self,token_id:TokenId,approved_account_id:AccountId,approval_id:Option<u64>)->bool{self.tokens.nft_is_approved(token_id,approved_account_id,approval_id)}
}
#[near_bindgen]impl near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration for Collectibles{
 fn nft_total_supply(&self)->U128{self.tokens.nft_total_supply()}
 fn nft_tokens(&self,from_index:Option<U128>,limit:Option<u64>)->Vec<Token>{self.tokens.nft_tokens(from_index,limit)}
 fn nft_supply_for_owner(&self,account_id:AccountId)->U128{self.tokens.nft_supply_for_owner(account_id)}
 fn nft_tokens_for_owner(&self,account_id:AccountId,from_index:Option<U128>,limit:Option<u64>)->Vec<Token>{self.tokens.nft_tokens_for_owner(account_id,from_index,limit)}
}
#[near_bindgen]impl NonFungibleTokenMetadataProvider for Collectibles{fn nft_metadata(&self)->NFTContractMetadata{self.metadata.get().unwrap()}}

#[cfg(test)]mod tests{
 use super::*;use near_sdk::{test_utils::VMContextBuilder,testing_env,NearToken};
 fn a(s:&str)->AccountId{s.parse().unwrap()}
 fn context(who:&str,deposit:NearToken){let mut b=VMContextBuilder::new();b.current_account_id(a("nfts.testnet")).predecessor_account_id(a(who)).signer_account_id(a(who)).account_balance(NearToken::from_near(100)).attached_deposit(deposit);testing_env!(b.build());}
 #[test]fn transfer_removes_old_equipment_and_changes_owner(){context("oracle.testnet",NearToken::from_near(1));let mut c=Collectibles::new(a("owner.testnet"),a("oracle.testnet"));let t=c.mint_aura("polar".into(),a("alice.testnet"),TokenMetadata{title:Some("Polar Aura".into()),..Default::default()});context("alice.testnet",NearToken::from_yoctonear(1));c.equip_aura(t.token_id.clone());assert_eq!(c.get_equipped(a("alice.testnet")),Some(t.token_id.clone()));c.nft_transfer(a("bob.testnet"),t.token_id.clone(),None,None);assert_eq!(c.get_equipped(a("alice.testnet")),None);assert_eq!(c.nft_token(t.token_id.clone()).unwrap().owner_id,a("bob.testnet"));context("bob.testnet",NearToken::from_yoctonear(0));c.equip_aura(t.token_id.clone());assert_eq!(c.get_equipped(a("bob.testnet")),Some(t.token_id));}
 #[test]#[should_panic(expected="Oracle only")]fn public_mint_rejected(){context("attacker.testnet",NearToken::from_near(1));let mut c=Collectibles::new(a("owner.testnet"),a("oracle.testnet"));c.mint_aura("polar".into(),a("attacker.testnet"),TokenMetadata::default());}
}
