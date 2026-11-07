// Reviewed operation wrapper around the existing near-api-js testnet signer.
// It never prints or copies the operator key. No key is read without an explicit
// --check-signer or --execute-reviewed-testnet argument. No mainnet fallback.
import assert from 'node:assert/strict';
import {readFileSync,statSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Account,KeyPairSigner,PublicKey,actions} from 'near-api-js';
import {createNearProvider} from '../../../server/near-provider.mjs';
import {allowedWorkerMethods} from '../../../server/native/reward-worker.mjs';
import {WORLD_CHAIN_METHODS} from '../../../server/global-reward-worker.mjs';
const root=resolve(import.meta.dirname,'../../..'),OWNER='questlayer-dev-20261101.testnet',REWARDS='questlayer-rewards-20261101b.testnet',QGOLD='questlayer-qgold-vault-20261104.testnet';
const out=resolve(root,'output/qa/global-release/world-reservations/owner-operations.json');
const execute=process.argv.includes('--execute-reviewed-testnet'),check=process.argv.includes('--check-signer');
const option=n=>{const i=process.argv.indexOf(n);return i>=0?process.argv[i+1]:null;};
const operatorPath=option('--operator-key');
const provider=createNearProvider('https://archival-rpc.testnet.near.org');
const artifacts=JSON.parse(readFileSync(resolve(root,'output/qa/global-release/runtime-20261107/current-artifacts.json'))).artifacts;
const manifest=JSON.parse(readFileSync(resolve(root,'public/native-rewards-testnet.json')));
const oldGold=JSON.parse(readFileSync(resolve(root,'public/native-qgold-vault-testnet.json')));
let step='public-preconditions';
const previous=existsSync(out)?JSON.parse(readFileSync(out)):null;
const report={network:'testnet',owner:OWNER,rewards:REWARDS,qgold:QGOLD,transactions:previous?.network==='testnet'&&previous?.rewards===REWARDS?(previous.transactions||[]).map(t=>({step:t.step,transactionHash:t.transactionHash})):[]};
if(previous?.network==='testnet'&&previous?.rewards===REWARDS)for(const k of ['rewardsCodeHash','rewardsWasmSha256','workerMethods','treasuryAfter','qgoldCodeHash','qgoldWasmSha256','qgoldProposal','supersededQgoldProposal','at'])if(previous[k]!==undefined)report[k]=previous[k];
const save=()=>{mkdirSync(resolve(root,'output/qa/global-release/world-reservations'),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});};
const view=async(contractId,method,args={})=>{const r=await provider.query({request_type:'call_function',account_id:contractId,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64'),finality:'final'});return JSON.parse(Buffer.from(r.result).toString());};
const accountView=accountId=>provider.query({request_type:'view_account',account_id:accountId,finality:'final'});
async function send(label,account,request){
 step=label;report.pendingStep=label;save();
 const raw=await account.signAndSendTransaction({...request,waitUntil:'FINAL'}),r=raw.final_execution_outcome??raw;
 assert(!r.status?.Failure);const transactionHash=r.transaction?.hash||r.transaction_outcome?.id;assert(transactionHash);
 report.transactions.push({step:label,transactionHash});delete report.pendingStep;save();return r;
}
async function main(){
 const canonical=JSON.parse(readFileSync(resolve(root,'contracts/wasm-sha256.json'))).contracts;
 assert.equal(artifacts.qgold.sha256,canonical.questlayer_qgold,'QGOLD source advanced; review the current artifact before signing');
 assert.equal(artifacts.rewards.sha256,canonical.questlayer_rewards);
 assert.equal((await provider.viewNodeStatus()).chain_id,'testnet');
 assert.equal(manifest.network,'testnet');assert.equal(oldGold.network,'testnet');
 const [rewardCode,goldCode,cfg,gcfg,gstate,treasury]=await Promise.all([accountView(REWARDS),accountView(QGOLD),view(REWARDS,'get_config'),view(QGOLD,'get_config'),view(QGOLD,'get_state'),view(REWARDS,'get_treasury')]);
 assert([manifest.codeHash,artifacts.rewards.nearCodeHash].includes(rewardCode.code_hash));
 assert([oldGold.codeHash,artifacts.qgold.nearCodeHash].includes(goldCode.code_hash));
 assert.equal(cfg.publisher,REWARDS);assert.equal(cfg.qgold_vault,QGOLD);assert(gcfg.council.includes(OWNER));assert(gcfg.minters.includes(REWARDS));assert.equal(gcfg.timelock_ms,'172800000');
 const bytes=readFileSync(resolve(root,'output/qa/global-release/world-reservations/'+artifacts.rewards.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),artifacts.rewards.sha256);
 const keys=(await provider.query({request_type:'view_access_key_list',account_id:REWARDS,finality:'final'})).keys;
 const existing=keys.find(k=>k.public_key===manifest.workerPublicKey),permission=existing?.access_key.permission?.FunctionCall;
 assert(permission&&permission.receiver_id===REWARDS&&permission.allowance!==null&&BigInt(permission.allowance)<=10n**24n&&BigInt(permission.allowance)>0n&&allowedWorkerMethods(permission.method_names));
 const methods=[...new Set([...permission.method_names,...WORLD_CHAIN_METHODS])];assert(allowedWorkerMethods(methods));
 let proposal=null;
 for(let id=1;id<=64;id++){
  const p=await view(QGOLD,'get_proposal',{id:String(id)});if(!p)break;
  if(p.action?.Upgrade?.code_sha256===artifacts.qgold.sha256){assert(!p.done||goldCode.code_hash===artifacts.qgold.nearCodeHash);proposal=p;break;}
  assert(id<64,'Proposal inventory requires explicit review');
 }
 const protocol=await provider.experimental_protocolConfig({finality:'final'}),byteCost=BigInt(protocol.runtime_config.storage_amount_per_byte);
 const oldCode=await provider.query({request_type:'view_code',account_id:REWARDS,finality:'final'}),oldBytes=Buffer.from(oldCode.code_base64,'base64');
 const delta=BigInt(Math.max(0,bytes.length-oldBytes.length));
 assert(BigInt(rewardCode.amount)>=(BigInt(rewardCode.storage_usage)+delta)*byteCost+BigInt(treasury.funded)-BigInt(treasury.withdrawn)+51n*10n**22n,'Separate operating/storage balance is insufficient');
 const goldDelta=BigInt(Math.max(0,artifacts.qgold.bytes-Number(oldGold.codeBytes??370615)));
 report.plan={rewardsFrom:rewardCode.code_hash,rewardsTo:artifacts.rewards.nearCodeHash,qgoldFrom:goldCode.code_hash,qgoldTo:artifacts.qgold.nearCodeHash,qgoldSha256:artifacts.qgold.sha256,workerMethods:methods,workerAllowanceYocto:permission.allowance,timelockMs:gcfg.timelock_ms,proposalId:proposal?.id??null,additionalRewardsStorageYocto:String(delta*byteCost),additionalQgoldStorageYocto:String(goldDelta*byteCost),fundingBefore:treasury.funded,qgoldBackingBefore:gstate.backing};
 if(process.argv.includes('--apply-ready-qgold')&&goldCode.code_hash!==artifacts.qgold.nearCodeHash){
  assert(proposal&&!proposal.done,'A live reviewed upgrade proposal is required');
  const block=await provider.viewBlock({finality:'final'}),now=BigInt(block.header.timestamp_nanosec)/1000000n;
  if(now<BigInt(proposal.executable_at)){report.state='awaiting-qgold-timelock';report.qgoldProposal=proposal;save();console.log(JSON.stringify({state:report.state,executableAt:proposal.executable_at,keyRead:false,transactionSent:false}));return;}
 }
 if(!execute&&!check){console.log(JSON.stringify({state:'review-only',plan:report.plan}));return;}
 step='opaque-signer-validation';assert(operatorPath);assert.equal(statSync(operatorPath).mode&0o077,0);
 // Same signer/configuration shape as scripts/deploy-qgold-testnet.mjs.
 const operator=JSON.parse(readFileSync(operatorPath));assert.equal(operator.network,'testnet');assert.equal(operator.accountId,OWNER);
 const signer=KeyPairSigner.fromSecretKey(operator.secretKey),publicKey=(await signer.getPublicKey()).toString();
 for(const account_id of [OWNER,REWARDS]){const access=await provider.query({request_type:'view_access_key',account_id,public_key:publicKey,finality:'final'});assert.equal(access.permission,'FullAccess');}
 if(!execute){console.log(JSON.stringify({state:'signer-ready',plan:report.plan}));return;}
 const owner=new Account(OWNER,provider,signer),rewards=new Account(REWARDS,provider,signer);
 if(process.argv.includes('--apply-ready-qgold')){
  if(goldCode.code_hash!==artifacts.qgold.nearCodeHash){
   assert(proposal&&!proposal.done);assert(new Set(proposal.approvals.filter(a=>gcfg.council.includes(a))).size>=gcfg.threshold);
   const goldBytes=readFileSync(resolve(root,'output/qa/global-release/world-reservations/'+artifacts.qgold.file));assert.equal(createHash('sha256').update(goldBytes).digest('hex'),artifacts.qgold.sha256);
   const deployed=await provider.query({request_type:'view_code',account_id:QGOLD,finality:'final'}),oldGoldBytes=Buffer.from(deployed.code_base64,'base64'),audit=await view(QGOLD,'audit');
   assert(audit.ok&&BigInt(audit.slack)>=BigInt(Math.max(0,goldBytes.length-oldGoldBytes.length))*byteCost+10n**21n,'Separate QGOLD operating/storage margin is insufficient');
   writeFileSync(resolve(root,'output/qa/global-release/world-reservations/qgold-before-upgrade.wasm'),oldGoldBytes,{mode:0o600});
   await send('apply-reviewed-qgold-upgrade',owner,{receiverId:QGOLD,actions:[actions.functionCall('apply_upgrade',{id:String(proposal.id),code:goldBytes.toString('base64')},280n*10n**12n,0n)]});
  }
  assert.equal((await accountView(QGOLD)).code_hash,artifacts.qgold.nearCodeHash);const after=await view(QGOLD,'get_state');
  for(const key of ['backing','supply','insurance','treasury_due','minted_total','burned_total','redeemed_total','fees_total','losses_total','refilled_total'])assert.equal(after[key],gstate[key]);
  assert.equal(after.exact_game_mint,1);assert.equal(after.mint_carry_total,gstate.mint_carry_total??'0');assert.deepEqual(await view(QGOLD,'get_config'),gcfg);assert((await view(QGOLD,'audit')).ok);
  report.state='qgold-applied';report.qgoldCodeHash=artifacts.qgold.nearCodeHash;report.qgoldWasmSha256=artifacts.qgold.sha256;report.at=new Date().toISOString();save();console.log(JSON.stringify({state:report.state,qgoldCodeHash:report.qgoldCodeHash,transactions:report.transactions}));return;
 }

 if(goldCode.code_hash!==artifacts.qgold.nearCodeHash&&!proposal){
  const r=await send('propose-exact-qgold-upgrade',owner,{receiverId:QGOLD,actions:[actions.functionCall('propose',{action:{Upgrade:{code_sha256:artifacts.qgold.sha256}}},100n*10n**12n,0n)]});
  const id=JSON.parse(Buffer.from(r.status.SuccessValue,'base64').toString());proposal=await view(QGOLD,'get_proposal',{id:String(id)});
 }
 if(proposal){assert.equal(proposal.action.Upgrade.code_sha256,artifacts.qgold.sha256);assert.equal(BigInt(proposal.executable_at)-BigInt(proposal.created_at),172800000n);report.qgoldProposal=proposal;save();}
 if(process.argv.includes('--retire-superseded-proposal')){
  const pending=oldGold.pendingWorldUpgrade;
  assert(proposal&&!proposal.done&&proposal.approvals.includes(OWNER));
  assert(pending&&pending.codeSha256!==artifacts.qgold.sha256&&String(pending.proposalId)!==String(proposal.id));
  const superseded=await view(QGOLD,'get_proposal',{id:String(pending.proposalId)});
  assert.equal(superseded.action.Upgrade.code_sha256,pending.codeSha256);
  if(!superseded.done)await send('retire-superseded-qgold-proposal',owner,{receiverId:QGOLD,actions:[actions.functionCall('cancel',{id:String(superseded.id)},50n*10n**12n,0n)]});
  assert((await view(QGOLD,'get_proposal',{id:String(superseded.id)})).done);
  report.supersededQgoldProposal={id:superseded.id,codeSha256:pending.codeSha256,state:'cancelled'};save();
 }
 if(process.argv.includes('--proposal-only')){report.state='qgold-proposed';report.at=new Date().toISOString();save();console.log(JSON.stringify({state:report.state,qgoldProposal:{id:proposal.id,executableAt:proposal.executable_at},transactions:report.transactions}));return;}
 if(rewardCode.code_hash!==artifacts.rewards.nearCodeHash){
  step='back-up-public-rewards-code';writeFileSync(resolve(root,'output/qa/global-release/world-reservations/rewards-before-upgrade.wasm'),oldBytes,{mode:0o600});
  await send('deploy-reviewed-rewards',rewards,{receiverId:REWARDS,actions:[actions.deployContract(bytes)]});
 }
 assert.equal((await accountView(REWARDS)).code_hash,artifacts.rewards.nearCodeHash);
 assert.deepEqual(await view(REWARDS,'get_treasury'),treasury,'Treasury changed during the operation; reconcile before continuing');
 assert.deepEqual(await view(REWARDS,'get_config'),cfg);
 assert.equal((await view(REWARDS,'get_world_budget')).version,1);
 if(!WORLD_CHAIN_METHODS.every(m=>permission.method_names.includes(m))){
  await send('extend-bounded-world-worker-methods',rewards,{receiverId:REWARDS,actions:[actions.deleteKey(PublicKey.from(manifest.workerPublicKey)),actions.addFunctionCallAccessKey(PublicKey.from(manifest.workerPublicKey),REWARDS,methods,BigInt(permission.allowance))]});
 }
 const finalAccess=await provider.query({request_type:'view_access_key',account_id:REWARDS,public_key:manifest.workerPublicKey,finality:'final'});
 assert.equal(finalAccess.permission.FunctionCall.receiver_id,REWARDS);assert.deepEqual(new Set(finalAccess.permission.FunctionCall.method_names),new Set(methods));assert(BigInt(finalAccess.permission.FunctionCall.allowance)<=10n**24n);
 report.state=goldCode.code_hash===artifacts.qgold.nearCodeHash?'contracts-current':'awaiting-qgold-timelock';report.rewardsCodeHash=artifacts.rewards.nearCodeHash;report.rewardsWasmSha256=artifacts.rewards.sha256;report.workerMethods=methods;report.treasuryAfter=await view(REWARDS,'get_treasury');report.at=new Date().toISOString();save();
 console.log(JSON.stringify({state:report.state,rewardsCodeHash:report.rewardsCodeHash,qgoldProposal:proposal?{id:proposal.id,executableAt:proposal.executable_at}:null,transactions:report.transactions}));
}
main().catch(error=>{report.state='failed';report.failedStep=step;report.errorClass=error.name;save();console.error(JSON.stringify({state:'failed',step,errorClass:error.name}));process.exitCode=1;});
