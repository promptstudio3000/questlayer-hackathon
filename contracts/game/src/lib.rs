use near_sdk::{borsh::{BorshDeserialize,BorshSerialize}, collections::{LookupMap,UnorderedSet}, env,ext_contract,json_types::{U128,U64},near_bindgen,serde::{Deserialize,Serialize},AccountId,Gas,NearToken,PanicOnDefault,Promise};

#[derive(BorshDeserialize,BorshSerialize,Default)]
#[borsh(crate="near_sdk::borsh")]
pub struct Bucket { available:u128,reserved:u128,paid:u128 }
#[derive(BorshDeserialize,BorshSerialize)]
#[borsh(crate="near_sdk::borsh")]
pub struct CoinBatch { unit:u128,count:u16,claimed:Vec<u8>,remaining:u128,expires:u64,closed:bool,manifest_hash:String }
#[derive(Serialize,Deserialize)]
#[serde(crate="near_sdk::serde")]
pub struct CoinClaim { pub index:u16,pub account_id:AccountId,pub received_at:U64,pub evidence_hash:String }
#[derive(BorshDeserialize,BorshSerialize)]
#[borsh(crate="near_sdk::borsh")]
pub struct Quest { reward:u128,xp:u64,opens:u64,closes:u64,winner:Option<AccountId>,manifest_hash:String }
#[derive(BorshDeserialize,BorshSerialize,Serialize,Deserialize,Default)]
#[borsh(crate="near_sdk::borsh")]
#[serde(crate="near_sdk::serde")]
pub struct Profile { pub nickname:String,pub xp:u64 }

#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Game {
 owner:AccountId,oracle:AccountId,paused:bool,coins:Bucket,zones:Bucket,
 funded:u128,owed_total:u128,pending_total:u128,paid_total:u128,
 batches:LookupMap<String,CoinBatch>,quests:LookupMap<String,Quest>,
 completed:UnorderedSet<String>,balances:LookupMap<AccountId,u128>,pending:LookupMap<AccountId,u128>,profiles:LookupMap<AccountId,Profile>,
}
#[allow(dead_code)]
#[ext_contract(ext_self)]
trait Callbacks { fn on_withdraw(&mut self,account_id:AccountId,amount:U128)->bool; }

#[near_bindgen]
impl Game {
 #[init]
 pub fn new(owner_id:AccountId,oracle_id:AccountId)->Self{
  Self{owner:owner_id,oracle:oracle_id,paused:false,coins:Bucket::default(),zones:Bucket::default(),funded:0,owed_total:0,pending_total:0,paid_total:0,batches:LookupMap::new(b"b"),quests:LookupMap::new(b"q"),completed:UnorderedSet::new(b"c"),balances:LookupMap::new(b"r"),pending:LookupMap::new(b"w"),profiles:LookupMap::new(b"p")}
 }
 /// Explicit liquid funding. A transfer of stake principal is never classified as yield here.
 #[payable]
 pub fn fund_rewards(&mut self,source:String){
  assert!(source=="sponsor"||source=="realized_yield","Invalid source");
  if source=="realized_yield"{self.assert_oracle();}
  let total=env::attached_deposit().as_yoctonear();assert!(total>0,"Empty funding");
  let coins=total/2;self.coins.available+=coins;self.zones.available+=total-coins;self.funded+=total;
  self.event("funding",near_sdk::serde_json::json!({"source":source,"coins":coins.to_string(),"zones":(total-coins).to_string()}));self.check();
 }
 pub fn register_profile(&mut self,nickname:String){assert!((2..=24).contains(&nickname.chars().count()),"Nickname length");let a=env::predecessor_account_id();let mut p=self.profiles.get(&a).unwrap_or_default();p.nickname=nickname;self.profiles.insert(&a,&p);}
 pub fn create_coin_batch(&mut self,batch_id:String,count:u16,unit_reward:U128,expires_at:U64,manifest_hash:String){
  self.assert_running();self.assert_oracle();assert!(batch_id.len()<=160&&manifest_hash.len()==64,"Invalid manifest");assert!(self.batches.get(&batch_id).is_none(),"Batch exists");assert!(count>0&&count<=1024&&unit_reward.0>0,"Invalid batch");assert!(expires_at.0>env::block_timestamp()&&expires_at.0<=env::block_timestamp()+48*3_600_000_000_000,"Invalid expiry");
  let backing=unit_reward.0.checked_mul(count as u128).expect("Overflow");assert!(backing<=self.coins.available,"Unfunded coins");self.coins.available-=backing;self.coins.reserved+=backing;
  self.batches.insert(&batch_id,&CoinBatch{unit:unit_reward.0,count,claimed:vec![0;(count as usize+7)/8],remaining:backing,expires:expires_at.0,closed:false,manifest_hash});self.check();
 }
 /// The oracle is a disclosed location validator. No raw location is stored on chain.
 pub fn settle_coin_claims(&mut self,batch_id:String,claims:Vec<CoinClaim>){
  self.assert_running();self.assert_oracle();assert!(claims.len()<=20,"Batch too large");let mut batch=self.batches.get(&batch_id).expect("Unknown batch");assert!(!batch.closed,"Batch closed");
  for c in claims {assert!(c.index<batch.count&&c.received_at.0<=batch.expires&&c.received_at.0<=env::block_timestamp()&&c.evidence_hash.len()==64,"Invalid receipt");let byte=c.index as usize/8;let mask=1u8<<(c.index%8);if batch.claimed[byte]&mask!=0{continue;}
   batch.claimed[byte]|=mask;batch.remaining-=batch.unit;self.coins.reserved-=batch.unit;self.coins.paid+=batch.unit;self.credit(&c.account_id,batch.unit,2);
   self.event("coin_claim",near_sdk::serde_json::json!({"batch_id":batch_id,"index":c.index,"account_id":c.account_id,"amount":batch.unit.to_string(),"evidence_hash":c.evidence_hash}));
  }
  self.batches.insert(&batch_id,&batch);self.check();
 }
 /// Close only after the validator has finalized all timely durable receipts.
 pub fn close_coin_batch(&mut self,batch_id:String){self.assert_oracle();let mut b=self.batches.get(&batch_id).expect("Unknown batch");if b.closed{return;}assert!(env::block_timestamp()>b.expires,"Not expired");self.coins.available+=b.remaining;self.coins.reserved-=b.remaining;b.remaining=0;b.closed=true;self.batches.insert(&batch_id,&b);self.check();}
 pub fn publish_quest(&mut self,quest_id:String,reward:U128,xp:u64,opens_at:U64,closes_at:U64,manifest_hash:String){
  self.assert_running();self.assert_oracle();assert!(quest_id.len()<=160&&manifest_hash.len()==64,"Invalid manifest");assert!(self.quests.get(&quest_id).is_none(),"Quest exists");assert!(xp<=2000&&closes_at.0>opens_at.0&&closes_at.0>env::block_timestamp(),"Invalid quest");assert!(reward.0<=self.zones.available,"Unfunded quest");self.zones.available-=reward.0;self.zones.reserved+=reward.0;
  self.quests.insert(&quest_id,&Quest{reward:reward.0,xp,opens:opens_at.0,closes:closes_at.0,winner:None,manifest_hash});self.check();
 }
 pub fn complete_quest(&mut self,quest_id:String,account_id:AccountId,received_at:U64,evidence_hash:String){
  self.assert_running();self.assert_oracle();let mut q=self.quests.get(&quest_id).expect("Unknown quest");assert!(received_at.0>=q.opens&&received_at.0<q.closes&&received_at.0<=env::block_timestamp()&&evidence_hash.len()==64,"Invalid receipt");let key=format!("{}:{}",quest_id,account_id);if self.completed.contains(&key){return;}self.completed.insert(&key);
  let reward=if q.winner.is_none(){q.winner=Some(account_id.clone());self.zones.reserved-=q.reward;self.zones.paid+=q.reward;q.reward}else{0};self.credit(&account_id,reward,q.xp);self.quests.insert(&quest_id,&q);
  self.event("quest_complete",near_sdk::serde_json::json!({"quest_id":quest_id,"account_id":account_id,"amount":reward.to_string(),"xp":q.xp,"evidence_hash":evidence_hash}));self.check();
 }
 pub fn close_quest(&mut self,quest_id:String){self.assert_oracle();let mut q=self.quests.get(&quest_id).expect("Unknown quest");assert!(env::block_timestamp()>=q.closes,"Not expired");if q.winner.is_none(){self.zones.available+=q.reward;self.zones.reserved-=q.reward;q.reward=0;self.quests.insert(&quest_id,&q);}self.check();}
 #[payable]
 pub fn withdraw_reward(&mut self)->Promise{
  near_sdk::assert_one_yocto();let account=env::predecessor_account_id();assert!(self.pending.get(&account).unwrap_or(0)==0,"Withdrawal pending");let value=self.balances.get(&account).unwrap_or(0);assert!(value>0,"No reward");self.balances.insert(&account,&0);self.pending.insert(&account,&value);self.owed_total-=value;self.pending_total+=value;
  Promise::new(account.clone()).transfer(NearToken::from_yoctonear(value)).then(ext_self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_withdraw(account,U128(value)))
 }
 #[private]
 pub fn on_withdraw(&mut self,account_id:AccountId,amount:U128)->bool{
  assert_eq!(self.pending.get(&account_id),Some(amount.0),"Callback mismatch");self.pending.remove(&account_id);self.pending_total-=amount.0;
  let success=env::promise_result_checked(0,0).is_ok();if success{self.paid_total+=amount.0;}else{let old=self.balances.get(&account_id).unwrap_or(0);self.balances.insert(&account_id,&(old+amount.0));self.owed_total+=amount.0;}self.check();success
 }
 pub fn get_balance(&self,account_id:AccountId)->U128{U128(self.balances.get(&account_id).unwrap_or(0))}
 pub fn get_profile(&self,account_id:AccountId)->Option<Profile>{self.profiles.get(&account_id)}
 pub fn get_treasury(&self)->near_sdk::serde_json::Value{near_sdk::serde_json::json!({"coins":{"available":self.coins.available.to_string(),"reserved":self.coins.reserved.to_string(),"awarded":self.coins.paid.to_string()},"zones":{"available":self.zones.available.to_string(),"reserved":self.zones.reserved.to_string(),"awarded":self.zones.paid.to_string()},"funded":self.funded.to_string(),"owed":self.owed_total.to_string(),"pending":self.pending_total.to_string(),"paid":self.paid_total.to_string(),"oracle":self.oracle,"paused":self.paused})}
 pub fn set_paused(&mut self,paused:bool){assert_eq!(env::predecessor_account_id(),self.owner,"Owner only");self.paused=paused;}
 fn assert_oracle(&self){assert_eq!(env::predecessor_account_id(),self.oracle,"Oracle only");}
 fn assert_running(&self){assert!(!self.paused,"Publication paused");}
 fn credit(&mut self,a:&AccountId,value:u128,xp:u64){let old=self.balances.get(a).unwrap_or(0);self.balances.insert(a,&(old+value));self.owed_total+=value;let mut p=self.profiles.get(a).unwrap_or_default();p.xp=p.xp.checked_add(xp).expect("XP overflow");self.profiles.insert(a,&p);}
 fn check(&self){assert_eq!(self.coins.available+self.coins.reserved+self.zones.available+self.zones.reserved+self.owed_total+self.pending_total+self.paid_total,self.funded,"Conservation failure");}
 fn event(&self,name:&str,data:near_sdk::serde_json::Value){env::log_str(&format!("EVENT_JSON:{}",near_sdk::serde_json::json!({"standard":"auratrail","version":"1.0.0","event":name,"data":[data]})));}
}

#[cfg(test)]mod tests{
 use super::*;use near_sdk::{test_utils::VMContextBuilder,testing_env};
 fn a(s:&str)->AccountId{s.parse().unwrap()}
 fn context(who:&str,time:u64,deposit:u128){let mut b=VMContextBuilder::new();b.current_account_id(a("game.testnet")).predecessor_account_id(a(who)).signer_account_id(a(who)).account_balance(NearToken::from_near(100)).block_timestamp(time).attached_deposit(NearToken::from_yoctonear(deposit));testing_env!(b.build());}
 fn game()->Game{context("oracle.testnet",1,0);Game::new(a("owner.testnet"),a("oracle.testnet"))}
 #[test]fn odd_yield_is_conserved(){let mut g=game();context("sponsor.testnet",1,101);g.fund_rewards("sponsor".into());assert_eq!(g.coins.available,50);assert_eq!(g.zones.available,51);g.check();}
 #[test]fn coin_cannot_pay_twice(){let mut g=game();context("oracle.testnet",1,1000);g.fund_rewards("sponsor".into());g.create_coin_batch("b".into(),5,U128(10),U64(100),"a".repeat(64));context("oracle.testnet",2,0);for account in["alice.testnet","bob.testnet"]{g.settle_coin_claims("b".into(),vec![CoinClaim{index:0,account_id:a(account),received_at:U64(2),evidence_hash:"b".repeat(64)}]);}assert_eq!(g.get_balance(a("alice.testnet")).0,10);assert_eq!(g.get_balance(a("bob.testnet")).0,0);g.check();}
 #[test]fn solo_quest_and_personal_xp(){let mut g=game();context("oracle.testnet",1,1000);g.fund_rewards("sponsor".into());g.publish_quest("q".into(),U128(100),50,U64(1),U64(100),"c".repeat(64));context("oracle.testnet",2,0);for account in["alice.testnet","alice.testnet","bob.testnet"]{g.complete_quest("q".into(),a(account),U64(2),"d".repeat(64));}assert_eq!(g.get_balance(a("alice.testnet")).0,100);assert_eq!(g.get_balance(a("bob.testnet")).0,0);assert_eq!(g.get_profile(a("alice.testnet")).unwrap().xp,50);assert_eq!(g.get_profile(a("bob.testnet")).unwrap().xp,50);g.check();}
 #[test]fn expiration_rolls_same_money_once(){let mut g=game();context("oracle.testnet",1,1000);g.fund_rewards("sponsor".into());g.create_coin_batch("b".into(),5,U128(10),U64(100),"e".repeat(64));context("oracle.testnet",101,0);g.close_coin_batch("b".into());g.close_coin_batch("b".into());assert_eq!(g.coins.available,500);assert_eq!(g.coins.reserved,0);g.check();}
 #[test]#[should_panic(expected="Oracle only")]fn forged_oracle_rejected(){let mut g=game();context("attacker.testnet",1,0);g.create_coin_batch("b".into(),1,U128(1),U64(100),"f".repeat(64));}
 #[test]#[should_panic(expected="Unfunded coins")]fn unfunded_rewards_rejected(){let mut g=game();g.create_coin_batch("b".into(),1,U128(1),U64(100),"f".repeat(64));}
}
