#!/usr/bin/env python3
"""Refresh verified testnet funding inputs; never signs or allocates rewards."""
import argparse,datetime,fcntl,hashlib,json,pathlib,subprocess,time,urllib.parse,urllib.request
REWARDS='questlayer-rewards-20261101b.testnet';QGOLD='questlayer-qgold-vault-20261104.testnet'
REWARDS_CODE='2JEVdTubVxUMt5v9bqrzH6VG7myeSroByRroyKQRDpgT';GOLD_CODE='F4p3S4cuvTScZXBWbqssNUxohgDN3rBGQq8gRS74jj4A';GOLD_SHA='d0fd8cc4e3dc110036b73613b9775d46ba87b7b1d1660367144b94893bbdd95f'
RPC='https://archival-rpc.testnet.near.org';INDEX='https://api-testnet.nearblocks.io/v3'

def amount(v):
 assert isinstance(v,str) and v.isascii() and v.isdigit() and (v=='0' or not v.startswith('0')) and 0<=int(v)<2**128,'Invalid exact monetary input'
 return int(v)

def funding_events(tx,ref,block_height):
 assert tx['transaction']['hash']==ref['hash'] and tx['transaction']['signer_id']==ref['signerId'] and 'SuccessValue' in tx['status'],'Unconfirmed funding transaction'
 proofs=[]
 for receipt in tx.get('receipts_outcome',[]):
  o=receipt['outcome']
  if o['executor_id']!=REWARDS or 'SuccessValue' not in o['status']:continue
  for log in o.get('logs',[]):
   if not log.startswith('EVENT_JSON:'):continue
   e=json.loads(log[11:])
   if e.get('standard')!='questlayer_rewards' or e.get('event')!='funded':continue
   for f in e['data']:
    assert f['source'] in ['sponsor','realized_yield'];amount(f['amount'])
    proofs.append({'id':f['sender']+':'+f['receipt_id'],'source':f['source'],'amountYocto':f['amount'],'blockHeight':block_height(receipt['block_hash']),'transactionHash':ref['hash'],'receiptId':receipt['id'],'finalized':True})
 return proofs

def reconcile(proofs,treasury):
 unique={}
 for p in proofs:
  assert p['finalized'] is True and p['source'] in ['sponsor','realized_yield'];amount(p['amountYocto'])
  if p['id'] in unique:assert unique[p['id']]==p,'Conflicting funding proof'
  unique[p['id']]=p
 values=list(unique.values());assert sum(amount(p['amountYocto']) for p in values)==amount(treasury['funded']),'Funding inventory incomplete'
 for bucket in ['coins','zones']:
  total=sum((amount(p['amountYocto'])//2 if bucket=='coins' else amount(p['amountYocto'])-amount(p['amountYocto'])//2) for p in values)
  assert total==sum(amount(treasury[bucket][k]) for k in ['available','reserved','awarded']),'Funding bucket differs'
 return values

def atomic_json(p,data,mode=0o600):
 tmp=p.with_name(p.name+'.pending');tmp.write_text(json.dumps(data,indent=2)+'\n');tmp.chmod(mode);tmp.replace(p)

def main(a):
 state=pathlib.Path(a.state);state.mkdir(parents=True,exist_ok=True);state.chmod(0o700)
 with (state/'sync.lock').open('w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  deadline=time.monotonic()+240
  def request(url,payload=None):
   assert time.monotonic()<deadline,'Funding sync slice exhausted'
   data=json.dumps(payload).encode() if payload else None
   req=urllib.request.Request(url,data=data,headers={'User-Agent':'QuestLayer verified funding inputs','Content-Type':'application/json'} if data else {'User-Agent':'QuestLayer verified funding inputs'})
   with urllib.request.urlopen(req,timeout=20) as response:raw=response.read(2000001)
   assert len(raw)<=2000000,'Oversize funding response';return json.loads(raw)
  def rpc(method,params):
   d=request(RPC,{'jsonrpc':'2.0','id':'world-funding-inputs','method':method,'params':params});assert 'error' not in d,'Funding RPC unavailable';return d['result']
  def view(account,method,args={}):
   import base64
   r=rpc('query',{'request_type':'call_function','account_id':account,'method_name':method,'args_base64':base64.b64encode(json.dumps(args).encode()).decode(),'finality':'final'});return json.loads(bytes(r['result']))
  def code(account):return rpc('query',{'request_type':'view_account','account_id':account,'finality':'final'})['code_hash']
  assert rpc('status',[])['chain_id']=='testnet'
  release=pathlib.Path(a.release).resolve();m=json.loads((release/'public/native-rewards-testnet.json').read_text());g=json.loads((release/'public/native-qgold-vault-testnet.json').read_text());c=m['globalRewards']
  assert m['network']==g['network']=='testnet' and m['contractId']==REWARDS and c['rewardsCodeHash']==m['codeHash']==REWARDS_CODE and c['qgoldContractId']==QGOLD and c['qgoldCodeHash']==GOLD_CODE
  assert g['vaultContract']==g['tokenContract']==QGOLD and g['rewardsContract']==REWARDS
  assert code(REWARDS)==REWARDS_CODE
  treasury=view(REWARDS,'get_treasury');cache_file=state/'proof-cache.json';cache=json.loads(cache_file.read_text()) if cache_file.exists() else {'network':'testnet','transactions':{},'proofs':{}}
  assert cache['network']=='testnet'
  refs={r['hash']:r for r in c['fundingTransactions']}
  refs.update(cache['transactions'])
  def verify(ref):
   if ref['hash'] in cache['transactions']:return
   tx=rpc('tx',{'tx_hash':ref['hash'],'sender_account_id':ref['signerId'],'wait_until':'FINAL'})
   proofs=funding_events(tx,ref,lambda h:int(rpc('block',{'block_id':h})['header']['height']))
   assert proofs,'Transaction contains no successful Rewards funding'
   for p in proofs:
    old=cache['proofs'].get(p['id']);assert old is None or old==p,'Conflicting historical funding'
    cache['proofs'][p['id']]=p
   cache['transactions'][ref['hash']]=ref;atomic_json(cache_file,cache)
  for ref in list(refs.values()):verify(ref)
  if sum(amount(p['amountYocto']) for p in cache['proofs'].values())!=amount(treasury['funded']):
   # Indexer rows are hints only. Every amount is independently checked via
   # successful finalized contract receipts; an incomplete bounded page blocks.
   page=request(INDEX+'/accounts/'+REWARDS+'/receipts?method=fund_rewards&limit=100')
   assert isinstance(page.get('data'),list) and len(page['data'])<=100
   for receipt in page['data']:
    if receipt.get('receiver_account_id')!=REWARDS or not receipt.get('outcome',{}).get('status') or not any(x.get('method')=='fund_rewards' for x in receipt.get('actions',[])):continue
    h=receipt['transaction_hash']
    if h in cache['transactions']:continue
    detail=request(INDEX+'/txns/'+urllib.parse.quote(h,safe=''))['data'];detail=detail[0] if isinstance(detail,list) else detail
    verify({'hash':h,'signerId':detail['signer_account_id']})
   treasury=view(REWARDS,'get_treasury')
  proofs=reconcile(list(cache['proofs'].values()),treasury)
  gold_code=code(QGOLD);pending=g.get('pendingWorldUpgrade',{});proposal=view(QGOLD,'get_proposal',{'id':str(pending.get('proposalId','1'))})
  assert proposal and proposal['action']['Upgrade']['code_sha256']==GOLD_SHA and str(proposal['executable_at'])==str(pending['executableAt']),'Current reviewed QGOLD proposal is not configured'
  ready=gold_code==GOLD_CODE and proposal['done'] is True
  before_m=json.dumps(m,sort_keys=True);before_g=json.dumps(g,sort_keys=True)
  c['fundingTransactions']=sorted(cache['transactions'].values(),key=lambda r:r['hash'])
  c['fundingRpcUrl']=RPC
  if ready:
   assert view(QGOLD,'get_state')['exact_game_mint']==1 and view(REWARDS,'get_world_budget')['version']==1
   assert REWARDS in view(QGOLD,'get_config')['minters'] and view(QGOLD,'audit')['ok'] is True
   access=rpc('query',{'request_type':'view_access_key','account_id':REWARDS,'public_key':m['workerPublicKey'],'finality':'final'})['permission']['FunctionCall']
   assert access['receiver_id']==REWARDS and 0<int(access['allowance'])<=10**24 and set(access['method_names'])==set(m['workerMethods']) and {'reserve_world_day','close_world_day','record_world_earned','move_world_to_payout'}.issubset(access['method_names'])
   c['enabled']=True;g['codeHash']=GOLD_CODE;g['wasmSha256']=GOLD_SHA;g['pendingWorldUpgrade']['state']='applied'
  else:
   assert gold_code==g['codeHash'],'Unreviewed QGOLD code change'
   c['enabled']=False
  changed=before_m!=json.dumps(m,sort_keys=True) or before_g!=json.dumps(g,sort_keys=True)
  result={'state':'financial-inputs-ready' if ready else 'qgold-upgrade-pending','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'receivedYocto':treasury['funded'],'fundingProofs':len(proofs),'qgoldProposalId':proposal['id'],'qgoldExecutableAt':proposal['executable_at'],'activationArmed':ready,'changed':changed,'applied':False,'attribution':{'name':'NearBlocks','url':'https://testnet.nearblocks.io','role':'funding discovery hints; finalized amounts verified by NEAR RPC'}}
  if changed and a.apply:
   for name,body in [('native-rewards-testnet.json',m),('native-qgold-vault-testnet.json',g)]:
    previous=(release/'public'/name).read_bytes();history=state/(name+'.'+hashlib.sha256(previous).hexdigest()+'.before');history.write_bytes(previous);history.chmod(0o600)
    atomic_json(release/'public'/name,body,0o644);atomic_json(release/'dist'/name,body,0o644)
   metadata=release/'release-source.json';meta=json.loads(metadata.read_text());meta['runtimeDeploymentRecords']=[{'path':'public/'+name,'sha256':hashlib.sha256((release/'public'/name).read_bytes()).hexdigest(),'reason':'Verified funding-input synchronization'} for name in ['native-rewards-testnet.json','native-qgold-vault-testnet.json']];atomic_json(metadata,meta,0o644)
   subprocess.run(['systemctl','restart','questlayer-hackathon'],check=True,timeout=120);result['applied']=True
  atomic_json(state/'status.json',result);print(json.dumps(result))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--release',required=True);p.add_argument('--state',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 try:main(a)
 except Exception as e:
  state=pathlib.Path(a.state);state.mkdir(parents=True,exist_ok=True);result={'state':'waiting-inputs','errorClass':type(e).__name__,'reason':str(e)[:180]};atomic_json(state/'status.json',result);print(json.dumps(result));raise SystemExit(1)
