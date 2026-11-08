//! Fixed UTC world-day reservations. Moving earned backing to a payout never
//! charges the date cap twice. Earned dust survives closing the playable day.
use crate::*;

#[derive(BorshDeserialize,BorshSerialize)]
#[borsh(crate="near_sdk::borsh")]
struct WorldDay {
    root:String, starts:u64, ends:u64,
    coins:u128, zones:u128, earned_coins:u128, earned_zones:u128,
    moved_coins:u128, moved_zones:u128, closed:bool,
}
#[derive(BorshDeserialize,BorshSerialize,Serialize,Deserialize,Clone,PartialEq)]
#[borsh(crate="near_sdk::borsh")]
#[serde(crate="near_sdk::serde")]
pub struct WorldContribution { pub world_day_id:String, pub coins_yocto:U128, pub zones_yocto:U128 }
fn days()->LookupMap<String,WorldDay>{LookupMap::new(b"global-world-days".to_vec())}
fn payout_sources()->LookupMap<String,Vec<WorldContribution>>{LookupMap::new(b"global-world-payout-sources".to_vec())}
pub(crate) fn is_world_payout(day_id:&String)->bool{payout_sources().get(day_id).is_some()}

// Gregorian UTC date from a Unix day, including leap-century rules. There is
// one world identity per actual UTC day, independent of local time or shards.
fn utc_date(starts:u64)->String {
    let z=(starts/DAY_MS) as i64+719468;
    let era=z/146097;let doe=z-era*146097;
    let yoe=(doe-doe/1460+doe/36524-doe/146096)/365;
    let y=yoe+era*400;let doy=doe-(365*yoe+yoe/4-yoe/100);
    let mp=(5*doy+2)/153;let d=doy-(153*mp+2)/5+1;
    let m=mp+if mp<10{3}else{-9};let y=y+if m<=2{1}else{0};
    format!("{y:04}-{m:02}-{d:02}")
}
fn earned(day:&mut WorldDay,coins:u128,zones:u128){
    assert!(coins>=day.earned_coins&&zones>=day.earned_zones,"Earned rights cannot decrease");
    assert!(coins<=day.coins&&zones<=day.zones,"Earned exceeds world reservation");
    assert!(!day.closed||(coins==day.earned_coins&&zones==day.earned_zones),"World day closed");
    day.earned_coins=coins;day.earned_zones=zones;
}

#[near_bindgen]
impl Rewards {
    pub fn get_world_budget(&self)->near_sdk::serde_json::Value {
        let slots=storage_slots().get(&"__total".to_string()).unwrap_or(0);
        let operating=(env::storage_usage()+slots*CLAIM_STORAGE+8192) as u128*env::storage_byte_cost().as_yoctonear()+NEAR/2;
        let prior=self.coins.reserved+self.zones.reserved+self.owed+self.pending;
        let liquid=env::account_balance().as_yoctonear().saturating_sub(operating).saturating_sub(prior);
        near_sdk::serde_json::json!({"version":1,"network":"testnet","liquid_backing":liquid.to_string(),"operating_and_storage":operating.to_string(),"exact_qgold_carry_required":true})
    }
    pub fn get_world_day(&self,day_id:String)->Option<near_sdk::serde_json::Value>{
        days().get(&day_id).map(|d|near_sdk::serde_json::json!({
            "manifest_hash":d.root,"starts_at":d.starts.to_string(),"ends_at":d.ends.to_string(),
            "coins_reserved":d.coins.to_string(),"zones_reserved":d.zones.to_string(),
            "coins_earned":d.earned_coins.to_string(),"zones_earned":d.earned_zones.to_string(),
            "coins_moved":d.moved_coins.to_string(),"zones_moved":d.moved_zones.to_string(),"closed":d.closed
        }))
    }
    pub fn reserve_world_day(&mut self,day_id:String,manifest_hash:String,starts_at:U64,ends_at:U64,coins_yocto:U128,zones_yocto:U128)->near_sdk::serde_json::Value {
        self.publisher();valid_hash(&manifest_hash);
        assert_eq!(day_id,format!("world-{}-v1",utc_date(starts_at.0)),"Canonical UTC world day required");
        assert!(starts_at.0%DAY_MS==0&&ends_at.0==starts_at.0.checked_add(DAY_MS).expect("Time overflow"),"World interval must be one UTC day");
        if let Some(d)=days().get(&day_id){
            assert!(d.root==manifest_hash&&d.starts==starts_at.0&&d.ends==ends_at.0&&d.coins==coins_yocto.0&&d.zones==zones_yocto.0,"World reservation differs");
            return self.get_world_day(day_id).unwrap();
        }
        assert!(!self.paused,"Publication paused");
        assert!(now_ms()<=starts_at.0,"Reserve world before opening");
        let(coins,zones)=(coins_yocto.0,zones_yocto.0);
        assert!(coins<=self.coins.available&&zones<=self.zones.available,"Insufficient liquid funding");
        self.add_to_date_total(&day_id,coins,zones);
        self.coins.available-=coins;self.coins.reserved+=coins;
        self.zones.available-=zones;self.zones.reserved+=zones;
        days().insert(&day_id,&WorldDay{root:manifest_hash.clone(),starts:starts_at.0,ends:ends_at.0,coins,zones,earned_coins:0,earned_zones:0,moved_coins:0,moved_zones:0,closed:false});
        let bytes=env::storage_usage()+storage_slots().get(&"__total".to_string()).unwrap_or(0)*CLAIM_STORAGE+8192;
        assert!(env::account_balance().as_yoctonear()>=bytes as u128*env::storage_byte_cost().as_yoctonear()+(self.funded-self.withdrawn)+NEAR/2,"Top up separate world storage and gas funding");
        self.check();event("world_day_reserved",near_sdk::serde_json::json!({"day_id":day_id,"manifest_hash":manifest_hash,"coins":coins.to_string(),"zones":zones.to_string()}));
        self.get_world_day(day_id).unwrap()
    }
    /// Monotonic cumulative totals, persisted before any reservation transfer.
    pub fn record_world_earned(&mut self,day_id:String,coins_yocto:U128,zones_yocto:U128){
        self.publisher();let mut d=days().get(&day_id).expect("Unknown world day");
        assert!(now_ms()>=d.starts,"World day not open");
        earned(&mut d,coins_yocto.0,zones_yocto.0);days().insert(&day_id,&d);
    }
    pub fn close_world_day(&mut self,day_id:String,earned_coins:U128,earned_zones:U128)->near_sdk::serde_json::Value {
        self.publisher();let mut d=days().get(&day_id).expect("Unknown world day");
        assert!(now_ms()>=d.ends,"World day still open");earned(&mut d,earned_coins.0,earned_zones.0);
        if !d.closed {
            let coins=d.coins-d.earned_coins;let zones=d.zones-d.earned_zones;
            self.coins.reserved-=coins;self.coins.available+=coins;
            self.zones.reserved-=zones;self.zones.available+=zones;d.closed=true;
            days().insert(&day_id,&d);self.check();
            event("world_day_closed",near_sdk::serde_json::json!({"day_id":day_id,"coins_released":coins.to_string(),"zones_released":zones.to_string()}));
        }
        self.get_world_day(day_id).unwrap()
    }
    /// Exact original buckets and UTC days survive cross-day dust aggregation.
    /// The publisher cannot reuse a moved liability or change a published root.
    pub fn move_world_to_payout(&mut self,day_id:String,root:String,leaves:u32,sources:Vec<WorldContribution>){
        self.publisher();assert!(!self.paused,"Publication paused");
        assert!(!sources.is_empty()&&sources.len()<=64,"Supply 1 to 64 world sources");
        assert!(sources.windows(2).all(|w|w[0].world_day_id<w[1].world_day_id),"World sources must be sorted and unique");
        assert!(day_id.starts_with("payout-world-"),"World payout identity required");
        if let Some(previous)=payout_sources().get(&day_id){
            let p=payouts::payout_days().get(&day_id).expect("Missing world payout");
            assert!(previous==sources&&p.root==root&&p.leaves==leaves,"World payout differs");return;
        }
        let(mut coins,mut zones)=(0u128,0u128);
        for source in &sources {
            assert!(source.coins_yocto.0>0||source.zones_yocto.0>0,"Empty world contribution");
            let mut d=days().get(&source.world_day_id).expect("Unknown world day");
            d.moved_coins=d.moved_coins.checked_add(source.coins_yocto.0).expect("Overflow");
            d.moved_zones=d.moved_zones.checked_add(source.zones_yocto.0).expect("Overflow");
            assert!(d.moved_coins<=d.earned_coins&&d.moved_zones<=d.earned_zones,"Transfer exceeds earned reservation");
            coins=coins.checked_add(source.coins_yocto.0).expect("Overflow");zones=zones.checked_add(source.zones_yocto.0).expect("Overflow");
            days().insert(&source.world_day_id,&d);
        }
        // Funds already reside in the reserved treasury buckets. Publication
        // merely changes which immutable manifest owns those same liabilities.
        self.create_payout_day(day_id.clone(),root,leaves,U128(coins),U128(zones),true);
        payout_sources().insert(&day_id,&sources);self.check();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder,testing_env};
    fn context(at:u64){let mut b=VMContextBuilder::new();b.current_account_id("rewards.testnet".parse().unwrap()).predecessor_account_id("owner.testnet".parse().unwrap()).block_timestamp(at*1_000_000).account_balance(NearToken::from_near(200));testing_env!(b.build());}
    fn fixture()->Rewards{context(0);let mut r=Rewards::new("owner.testnet".parse().unwrap(),"owner.testnet".parse().unwrap(),Base64VecU8(vec![7;32]));r.funded=NEAR;r.coins.available=NEAR/2;r.zones.available=NEAR/2;r}
    const START:u64=1794096000000; // 2026-11-08 UTC
    fn reserve(r:&mut Rewards){r.reserve_world_day("world-2026-11-08-v1".into(),"a".repeat(64),U64(START),U64(START+DAY_MS),U128(NEAR/20),U128(NEAR/20));}
    #[test] fn utc_identity_handles_leap_centuries(){assert_eq!(utc_date(0),"1970-01-01");assert_eq!(utc_date(START),"2026-11-08");assert_eq!(utc_date(4107542400000),"2100-03-01");}
    #[test] fn reservation_replay_and_move_preserve_cap_and_cash(){let mut r=fixture();reserve(&mut r);let totals=r.get_date_totals("2026-11-08".into());reserve(&mut r);assert_eq!(r.coins.reserved,NEAR/20);context(START);r.record_world_earned("world-2026-11-08-v1".into(),U128(NEAR/100),U128(NEAR/200));let sources=vec![WorldContribution{world_day_id:"world-2026-11-08-v1".into(),coins_yocto:U128(NEAR/100),zones_yocto:U128(NEAR/200)}];r.move_world_to_payout("payout-world-2026-11-09-v1".into(),"b".repeat(64),1,sources.clone());r.move_world_to_payout("payout-world-2026-11-09-v1".into(),"b".repeat(64),1,sources);assert_eq!(r.get_date_totals("2026-11-08".into()),totals);assert_eq!(r.coins.reserved,NEAR/20);r.check();}
    #[test] fn close_releases_only_unearned_and_preserves_dust(){let mut r=fixture();reserve(&mut r);context(START+DAY_MS);r.close_world_day("world-2026-11-08-v1".into(),U128(1),U128(2));assert_eq!(r.coins.reserved,1);assert_eq!(r.zones.reserved,2);let coins=r.coins.available;r.close_world_day("world-2026-11-08-v1".into(),U128(1),U128(2));assert_eq!(coins,r.coins.available);r.check();}
    #[test] #[should_panic(expected="Reserve world before opening")] fn late_reservation_rejected(){let mut r=fixture();context(START+1);reserve(&mut r);}
    #[test] #[should_panic(expected="Earned rights cannot decrease")] fn earnings_never_shrink(){let mut r=fixture();reserve(&mut r);context(START);r.record_world_earned("world-2026-11-08-v1".into(),U128(3),U128(0));r.record_world_earned("world-2026-11-08-v1".into(),U128(2),U128(0));}
    #[test] #[should_panic(expected="Transfer exceeds earned reservation")] fn transfer_cannot_spend_unearned(){let mut r=fixture();reserve(&mut r);r.move_world_to_payout("payout-world-2026-11-09-v1".into(),"b".repeat(64),1,vec![WorldContribution{world_day_id:"world-2026-11-08-v1".into(),coins_yocto:U128(1),zones_yocto:U128(0)}]);}
}
