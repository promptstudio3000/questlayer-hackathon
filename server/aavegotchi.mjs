import{createPublicClient,http,parseAbi,getAddress,encodeFunctionData,hexToString}from'viem';
import{base}from'viem/chains';
export const AAVEGOTCHI='0xA99c4B08201F2913Db8D28e71d020c4298F29dBF';
export const AAVEGOTCHI_ABI=parseAbi([
 'function tokenIdsOfOwner(address owner) view returns (uint32[])',
 'function itemBalances(address owner) view returns ((uint256 itemId, uint256 balance)[])',
 'function itemBalancesOfToken(address tokenContract,uint256 tokenId) view returns ((uint256 itemId,uint256 balance)[])',
 'function equippedWearables(uint256 tokenId) view returns (uint16[16])',
 'function getAavegotchiSvg(uint256 tokenId) view returns (string)',
 'function getItemSvg(uint256 itemId) view returns (string)',
 'function modifiedTraitsAndRarityScore(uint256 tokenId) view returns (int16[6], uint256)',
 'function getAavegotchi(uint256 tokenId)',
]);
// Names change rarely and getAavegotchi returns ~50 KB (it embeds every item
// type), so names are read once per process and token.
const names=new Map();
// getAavegotchi returns a tuple whose first two members are tokenId and the
// name string; only the name is decoded so later struct additions do not break it.
export function decodeGotchiName(hex){
 const h=hex.startsWith('0x')?hex.slice(2):hex;const word=(byte)=>Number(BigInt('0x'+(h.slice(byte*2,byte*2+64)||'0')));
 const tuple=word(0),at=tuple+word(tuple+32),length=word(at);
 if(!length||length>64||(at+32+length)*2>h.length)return '';
 return hexToString('0x'+h.slice((at+32)*2,(at+32+length)*2)).replace(/[\u0000-\u001f]/g,'').trim().slice(0,40);
}
async function readName(client,tokenId){
 const key=tokenId.toString();if(names.has(key))return names.get(key);
 let name='';
 try{const{data}=await client.call({to:AAVEGOTCHI,data:encodeFunctionData({abi:AAVEGOTCHI_ABI,functionName:'getAavegotchi',args:[tokenId]})});name=data?decodeGotchiName(data):'';}catch{return '';}
 if(names.size>5000)names.delete(names.keys().next().value);
 names.set(key,name);return name;
}
/** The owned Aavegotchi shown by default: highest rarity score (BRS with
 * wearables), then the lowest token id. Portals and gotchis without art are skipped. */
export function defaultGotchi(gotchis=[]){
 return [...gotchis].filter((g)=>g.claimed!==false&&g.svg!==null).sort((a,b)=>(b.brs??-1)-(a.brs??-1)||Number(a.tokenId)-Number(b.tokenId))[0]||null;
}
export async function readGotchiItemSvg(itemId){
 const client=createPublicClient({chain:base,transport:http(process.env.BASE_RPC_URL||'https://mainnet.base.org',{timeout:4000,retryCount:0})});
 return client.readContract({address:AAVEGOTCHI,abi:AAVEGOTCHI_ABI,functionName:'getItemSvg',args:[BigInt(itemId)]});
}
export async function readGotchis(address,{limit=50}={}){
 const abi=AAVEGOTCHI_ABI;
 const client=createPublicClient({chain:base,transport:http(process.env.BASE_RPC_URL||'https://mainnet.base.org',{timeout:12000,retryCount:1})});
 const owner=getAddress(address),allIds=await client.readContract({address:AAVEGOTCHI,abi,functionName:'tokenIdsOfOwner',args:[owner]});
 const ids=allIds.slice(0,Math.max(1,Math.min(50,Math.trunc(limit)||50)));const quantities=new Map();const warnings=[];
 function add(items){for(const i of items){const key=i.itemId.toString();quantities.set(key,(quantities.get(key)||0n)+i.balance);}}
 try{add(await client.readContract({address:AAVEGOTCHI,abi,functionName:'itemBalances',args:[owner]}));}catch{warnings.push('Loose wearables could not be loaded.');}
 const gotchis=[];
 for(let offset=0;offset<ids.length;offset+=4){const results=await Promise.all(ids.slice(offset,offset+4).map(async token=>{
  const tokenId=BigInt(token);const [svg,wearables,nested,score,name]=await Promise.allSettled([
   client.readContract({address:AAVEGOTCHI,abi,functionName:'getAavegotchiSvg',args:[tokenId]}),
   client.readContract({address:AAVEGOTCHI,abi,functionName:'equippedWearables',args:[tokenId]}),
   client.readContract({address:AAVEGOTCHI,abi,functionName:'itemBalancesOfToken',args:[AAVEGOTCHI,tokenId]}),
   client.readContract({address:AAVEGOTCHI,abi,functionName:'modifiedTraitsAndRarityScore',args:[tokenId]}),
   readName(client,tokenId),
  ]);
  if(nested.status==='fulfilled')add(nested.value);else warnings.push(`Inventory #${token} is temporarily unavailable.`);
  const image=svg.status==='fulfilled'&&svg.value.length<200000?svg.value:null;
  // modifiedTraitsAndRarityScore reverts for an unopened portal ("Must be claimed").
  const claimed=score.status==='fulfilled'||!/claimed/i.test(String(score.reason?.shortMessage||score.reason?.message||''));
  const label=name.status==='fulfilled'&&name.value?name.value:`Aavegotchi #${token}`;
  return{tokenId:String(token),name:label,svg:claimed?image:null,brs:score.status==='fulfilled'?Number(score.value[1]):null,claimed,equipped:wearables.status==='fulfilled'?wearables.value.map(String):[],origin:'base',premium:true};
 }));gotchis.push(...results);}
 gotchis.sort((a,b)=>(b.brs??-1)-(a.brs??-1)||Number(a.tokenId)-Number(b.tokenId));
 return{address:owner,chain:'base',contract:AAVEGOTCHI,count:allIds.length,truncated:allIds.length>ids.length,gotchis,wearables:[...quantities].filter(([,q])=>q>0n).map(([itemId,q])=>({itemId,quantity:q.toString(),origin:'origin-linked',tradable:false})),warnings,verifiedAt:Date.now()};
}
