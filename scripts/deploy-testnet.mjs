import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{Account,KeyPairSigner,JsonRpcProvider,actions}from'near-api-js';
// Retired 10 November 2026: this script creates and smoke-tests the first-alpha game
// contract (contracts/game), which the live game never used and whose account is being
// deleted. It would recreate that account, so it refuses to run. Kept as history.
throw new Error('Retired: the first-alpha game contract is no longer deployed. See docs/HOW-TO-TRY.md.');
const operator=JSON.parse(readFileSync('.data/near-operator.json','utf8'));
if(operator.network!=='testnet'||!operator.accountId.endsWith('.testnet'))throw new Error('Testnet only.');
const provider=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),signer=KeyPairSigner.fromSecretKey(operator.secretKey),root=new Account(operator.accountId,provider,signer);
const game=`game.${operator.accountId}`,nfts=`nfts.${operator.accountId}`,explorer=`explorer.${operator.accountId}`;
const journal='.data/testnet-operations.json';const records=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):[];const NEAR=10n**24n;
async function record(label,fn){const r=await fn();const tx=r.transaction_outcome?.id||r.transaction?.hash;records.push({label,transaction:tx});writeFileSync(journal,JSON.stringify(records,null,2));console.log(JSON.stringify({step:label,transaction:tx}));return r;}
async function child(name,near){try{await provider.query({request_type:'view_account',account_id:name,finality:'final'});}catch(e){if(!String(e.message).includes('does not exist')&&!String(e.message).includes('UNKNOWN_ACCOUNT'))throw e;await record(`create ${name}`,()=>root.createAccount({newAccountId:name,publicKey:operator.publicKey,nearToTransfer:near*NEAR}));}}
await child(game,3n);await child(nfts,4n);await child(explorer,1n);
async function deploy(accountId,wasm){const account=new Account(accountId,provider,signer);const existing=await provider.query({request_type:'view_account',account_id:accountId,finality:'final'});const state=await provider.query({request_type:'view_state',account_id:accountId,prefix_base64:'',finality:'final'});if(state.values?.some(v=>v.key==='U1RBVEU=')){console.log(JSON.stringify({step:`preserve initialized ${accountId}`}));return account;}
 await record(`deploy ${accountId}`,()=>account.signAndSendTransaction({receiverId:accountId,actions:[actions.deployContract(readFileSync(wasm)),actions.functionCall('new',{owner_id:operator.accountId,oracle_id:operator.accountId},100n*10n**12n,0n)],waitUntil:'FINAL'}));return account;
}
await deploy(game,'contracts/target/wasm32-unknown-unknown/release/questlayer_game.wasm');
await deploy(nfts,'contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm');
const tag=Date.now().toString(),batch=`smoke-${tag}`,quest=`solo-${tag}`;
const call=(contractId,methodName,args,deposit=0n)=>root.callFunctionRaw({contractId,methodName,args,deposit,gas:150n*10n**12n,waitUntil:'FINAL'});
const currentFund=await provider.query({request_type:'call_function',account_id:game,method_name:'get_treasury',args_base64:Buffer.from('{}').toString('base64'),finality:'final'});const current=JSON.parse(Buffer.from(currentFund.result).toString());if(BigInt(current.funded)===0n)await record('fund 50/50 reward buckets',()=>call(game,'fund_rewards',{source:'sponsor'},NEAR/5n));
const timestamp=BigInt((await provider.viewBlock({finality:'final'})).header.timestamp_nanosec);
await record('publish shared street coin batch',()=>call(game,'create_coin_batch',{batch_id:batch,count:4,unit_reward:(10n**19n).toString(),expires_at:(timestamp+60n*10n**9n).toString(),manifest_hash:'1'.repeat(64)}));
await record('settle one shared coin',()=>call(game,'settle_coin_claims',{batch_id:batch,claims:[{index:0,account_id:explorer,received_at:timestamp.toString(),evidence_hash:'2'.repeat(64)}]}));
await record('replay coin without duplicate credit',()=>call(game,'settle_coin_claims',{batch_id:batch,claims:[{index:0,account_id:explorer,received_at:timestamp.toString(),evidence_hash:'2'.repeat(64)}]}));
await record('publish funded solo quest',()=>call(game,'publish_quest',{quest_id:quest,reward:(10n**20n).toString(),xp:50,opens_at:timestamp.toString(),closes_at:(timestamp+600n*10n**9n).toString(),manifest_hash:'3'.repeat(64)}));
await record('complete a quest without another player',()=>call(game,'complete_quest',{quest_id:quest,account_id:explorer,received_at:timestamp.toString(),evidence_hash:'4'.repeat(64)}));
await record('withdraw actual testnet reward',()=>new Account(explorer,provider,signer).callFunctionRaw({contractId:game,methodName:'withdraw_reward',args:{},deposit:1n,gas:100n*10n**12n,waitUntil:'FINAL'}));
const metadata={title:'Northern Lights',description:'QuestLayer cosmetic. Testnet proof.',copies:256,extra:JSON.stringify({slot:'above',rarity:'rare',origin:'questlayer-original'}),media:null,media_hash:null,reference:null,reference_hash:null};
await record('mint a real NEP-171 Aura',()=>call(nfts,'mint_aura',{edition:'polar',receiver_id:explorer,metadata},NEAR/10n));
const view=async(contractId,methodName,args)=>{const r=await provider.query({request_type:'call_function',account_id:contractId,method_name:methodName,args_base64:Buffer.from(JSON.stringify(args)).toString('base64'),finality:'final'});return JSON.parse(Buffer.from(r.result).toString());};
const tokens=await view(nfts,'nft_tokens_for_owner',{account_id:explorer,from_index:'0',limit:50});const token=tokens.at(-1);
await record('equip owned NFT',()=>new Account(explorer,provider,signer).callFunctionRaw({contractId:nfts,methodName:'equip_aura',args:{token_id:token.token_id},gas:50n*10n**12n,waitUntil:'FINAL'}));
await record('transfer NFT and clear original equipment',()=>new Account(explorer,provider,signer).callFunctionRaw({contractId:nfts,methodName:'nft_transfer',args:{receiver_id:operator.accountId,token_id:token.token_id},deposit:1n,gas:100n*10n**12n,waitUntil:'FINAL'}));
const treasury=await view(game,'get_treasury',{}),owner=await view(nfts,'nft_token',{token_id:token.token_id}),equipped=await view(nfts,'get_equipped',{account_id:explorer});
if(owner.owner_id!==operator.accountId||equipped!==null)throw new Error('NFT postconditions failed');
const deployment={network:'testnet',verifiedAt:new Date().toISOString(),gameContract:game,collectiblesContract:nfts,operator:operator.accountId,smokeAccount:explorer,tokenId:token.token_id,transactions:records,treasury,gameEconomy:'separate-demo-ledger',intents:'not-deployed',vault:'not-deployed'};
writeFileSync('public/testnet-deployment.json',JSON.stringify(deployment,null,2)+'\n');console.log(JSON.stringify({status:'verified',gameContract:game,collectiblesContract:nfts,transactions:records.length}));
