import{createPublicClient,http,parseAbi,getAddress}from'viem';
import{base}from'viem/chains';
export const AAVEGOTCHI='0xA99c4B08201F2913Db8D28e71d020c4298F29dBF';
export const AAVEGOTCHI_ABI=parseAbi([
 'function tokenIdsOfOwner(address owner) view returns (uint32[])',
 'function itemBalances(address owner) view returns ((uint256 itemId, uint256 balance)[])',
 'function itemBalancesOfToken(address tokenContract,uint256 tokenId) view returns ((uint256 itemId,uint256 balance)[])',
 'function equippedWearables(uint256 tokenId) view returns (uint16[16])',
 'function getAavegotchiSvg(uint256 tokenId) view returns (string)',
]);
export async function readGotchis(address,{limit=50}={}){
 const abi=AAVEGOTCHI_ABI;
 const client=createPublicClient({chain:base,transport:http(process.env.BASE_RPC_URL||'https://mainnet.base.org',{timeout:12000,retryCount:1})});
 const owner=getAddress(address),allIds=await client.readContract({address:AAVEGOTCHI,abi,functionName:'tokenIdsOfOwner',args:[owner]});
 const ids=allIds.slice(0,Math.max(1,Math.min(50,Math.trunc(limit)||50)));const quantities=new Map();const warnings=[];
 function add(items){for(const i of items){const key=i.itemId.toString();quantities.set(key,(quantities.get(key)||0n)+i.balance);}}
 try{add(await client.readContract({address:AAVEGOTCHI,abi,functionName:'itemBalances',args:[owner]}));}catch{warnings.push('Loose wearables could not be loaded.');}
 const gotchis=[];
 for(let offset=0;offset<ids.length;offset+=4){const results=await Promise.all(ids.slice(offset,offset+4).map(async token=>{
  const tokenId=BigInt(token);const [svg,wearables,nested]=await Promise.allSettled([
   client.readContract({address:AAVEGOTCHI,abi,functionName:'getAavegotchiSvg',args:[tokenId]}),
   client.readContract({address:AAVEGOTCHI,abi,functionName:'equippedWearables',args:[tokenId]}),
   client.readContract({address:AAVEGOTCHI,abi,functionName:'itemBalancesOfToken',args:[AAVEGOTCHI,tokenId]}),
  ]);
  if(nested.status==='fulfilled')add(nested.value);else warnings.push(`Inventory #${token} is temporarily unavailable.`);
  const image=svg.status==='fulfilled'&&svg.value.length<200000?svg.value:null;
  return{tokenId:String(token),name:`Aavegotchi #${token}`,svg:image,equipped:wearables.status==='fulfilled'?wearables.value.map(String):[],origin:'base',premium:true};
 }));gotchis.push(...results);}
 return{address:owner,chain:'base',contract:AAVEGOTCHI,count:allIds.length,truncated:allIds.length>ids.length,gotchis,wearables:[...quantities].filter(([,q])=>q>0n).map(([itemId,q])=>({itemId,quantity:q.toString(),origin:'origin-linked',tradable:false})),warnings,verifiedAt:Date.now()};
}
