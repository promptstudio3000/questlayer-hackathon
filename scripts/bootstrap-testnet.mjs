import{existsSync,mkdirSync,readFileSync,writeFileSync}from'node:fs';
import{KeyPair,JsonRpcProvider}from'near-api-js';
const path='.data/near-operator.json';mkdirSync('.data',{recursive:true,mode:0o700});
let operator;if(existsSync(path)){operator=JSON.parse(readFileSync(path,'utf8'));}else{
 const key=KeyPair.fromRandom('ed25519');operator={network:'testnet',accountId:`questlayer-dev-${new Date().toISOString().slice(0,10).replaceAll('-','')}.testnet`,publicKey:key.getPublicKey().toString(),secretKey:key.toString()};writeFileSync(path,JSON.stringify(operator),{mode:0o600,flag:'wx'});
}
const provider=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'});
try{const account=await provider.query({request_type:'view_account',account_id:operator.accountId,finality:'final'});console.log(JSON.stringify({accountId:operator.accountId,status:'exists',amount:account.amount}));process.exit(0);}catch(e){if(!String(e.message).includes('does not exist')&&!String(e.message).includes('UNKNOWN_ACCOUNT')){console.log(JSON.stringify({accountId:operator.accountId,status:'rpc-unavailable'}));process.exit(1);}}
console.log(JSON.stringify({accountId:operator.accountId,status:'requesting-testnet-faucet',publicKey:operator.publicKey}));
try{const result=await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:operator.accountId,newAccountPublicKey:operator.publicKey}),signal:AbortSignal.timeout(20000)});const text=await result.text();console.log(JSON.stringify({accountId:operator.accountId,status:result.status,response:text.slice(0,1000)}));if(!result.ok)process.exitCode=1;}catch{console.log(JSON.stringify({accountId:operator.accountId,status:'faucet-unavailable',next:'Fund this testnet account through an official faucet. Never send mainnet NEAR.'}));process.exitCode=1;}
