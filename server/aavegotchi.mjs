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
// Name, haunt, collateral and base traits change rarely and getAavegotchi
// returns ~50 KB (it embeds every item type), so they are read once per
// process and token. Previews (custom outfits) need haunt, collateral and traits.
const infos=new Map();
// getAavegotchi returns one tuple. Its static head is decoded by word index
// (tokenId 0, name offset 1, numericTraits 5-10, collateral 33, hauntId 43),
// so later dynamic additions to the struct do not break it.
export function decodeGotchiInfo(hex){
 const h=hex.startsWith('0x')?hex.slice(2):hex;
 const raw=(i)=>h.slice(i*64,i*64+64)||'0';const word=(i)=>BigInt('0x'+raw(i));
 const tuple=Number(word(0))/32;const at=(tuple*32+Number(word(tuple+1)))/32;
 const length=Number(word(at));let name='';
 if(length&&length<=64&&(at+1)*64+length*2<=h.length)name=hexToString('0x'+h.slice((at+1)*64,(at+1)*64+length*2)).replace(/[\u0000-\u001f]/g,'').trim().slice(0,40);
 const signed=(i)=>{const v=word(tuple+i);return Number(v>=2n**255n?v-2n**256n:v);};
 const traits=[5,6,7,8,9,10].map(signed);
 const collateral=h.length>=(tuple+34)*64?'0x'+raw(tuple+33).slice(24):null;
 const hauntId=h.length>=(tuple+44)*64?Number(word(tuple+43)):null;
 return{name,traits,collateral,hauntId};
}
export const decodeGotchiName=(hex)=>decodeGotchiInfo(hex).name;
async function readInfo(client,tokenId){
 const key=tokenId.toString();if(infos.has(key))return infos.get(key);
 let info;
 try{const{data}=await client.call({to:AAVEGOTCHI,data:encodeFunctionData({abi:AAVEGOTCHI_ABI,functionName:'getAavegotchi',args:[tokenId]})});info=data?decodeGotchiInfo(data):null;}catch{return null;}
 if(!info)return null;
 if(infos.size>5000)infos.delete(infos.keys().next().value);
 infos.set(key,info);return info;
}
const PREVIEW_ABI=parseAbi(['function previewAavegotchi(uint256 _hauntId,address _collateralType,int16[6] _numericTraits,uint16[16] equippedWearables) view returns (string)']);
/** Renders an owned gotchi with another set of wearables (16 slot ids) on Base. */
export async function previewGotchiSvg({hauntId,collateral,traits},equipped){
 const client=createPublicClient({chain:base,transport:http(process.env.BASE_RPC_URL||'https://mainnet.base.org',{timeout:6000,retryCount:1})});
 return client.readContract({address:AAVEGOTCHI,abi:PREVIEW_ABI,functionName:'previewAavegotchi',args:[BigInt(hauntId),collateral,traits,equipped.map(Number)]});
}
/** The owned Aavegotchi shown by default: highest rarity score (BRS with
 * wearables), then the lowest token id. Portals and gotchis without art are skipped. */
export function defaultGotchi(gotchis=[]){
 return [...gotchis].filter((g)=>g.claimed!==false&&g.svg!==null).sort((a,b)=>(b.brs??-1)-(a.brs??-1)||Number(a.tokenId)-Number(b.tokenId))[0]||null;
}
export async function readGotchiItemSvg(itemId){
 const client=createPublicClient({chain:base,transport:http(process.env.BASE_RPC_URL||'https://mainnet.base.org',{timeout:4000,retryCount:1})});
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
   readInfo(client,tokenId),
  ]);
  if(nested.status==='fulfilled')add(nested.value);else warnings.push(`Inventory #${token} is temporarily unavailable.`);
  const image=svg.status==='fulfilled'&&svg.value.length<200000?svg.value:null;
  // modifiedTraitsAndRarityScore reverts for an unopened portal ("Must be claimed").
  const claimed=score.status==='fulfilled'||!/claimed/i.test(String(score.reason?.shortMessage||score.reason?.message||''));
  const info=name.status==='fulfilled'?name.value:null;
  const label=info?.name||`Aavegotchi #${token}`;
  return{tokenId:String(token),name:label,svg:claimed?image:null,brs:score.status==='fulfilled'?Number(score.value[1]):null,claimed,preview:info&&info.hauntId&&info.collateral?{hauntId:info.hauntId,collateral:info.collateral,traits:info.traits}:null,equipped:wearables.status==='fulfilled'?wearables.value.map(String):[],origin:'base',premium:true};
 }));gotchis.push(...results);}
 gotchis.sort((a,b)=>(b.brs??-1)-(a.brs??-1)||Number(a.tokenId)-Number(b.tokenId));
 return{address:owner,chain:'base',contract:AAVEGOTCHI,count:allIds.length,truncated:allIds.length>ids.length,gotchis,wearables:[...quantities].filter(([,q])=>q>0n).map(([itemId,q])=>({itemId,quantity:q.toString(),origin:'origin-linked',tradable:false})),warnings,verifiedAt:Date.now()};
}
