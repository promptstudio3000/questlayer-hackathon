import { tr } from "./i18n.ts";
import { formatGold, QGOLD_UNITS } from "./gold-units.ts";
// Amounts are kept in micro-QGOLD; 1 in-game GOLD is one of those units
// (src/gold-units.ts), so every GOLD amount is a whole number.
export const GOLD=1;
// The second argument is kept for older call sites; GOLD has no decimals.
export const gold=(value:number,_decimals?:number)=>formatGold(value/GOLD);
// NEAR value of GOLD at the vault's starting rate (0.001 NEAR per QGOLD).
export const near=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(value/QGOLD_UNITS/1000);
export class ApiError extends Error {code:string;status:number;details?:Record<string,unknown>;constructor(message:string,code:string,status:number,details?:Record<string,unknown>){super(message);this.code=code;this.status=status;this.details=details;}}
export async function api<T=Record<string,unknown>>(path:string,data?:unknown,options?:{signal?:AbortSignal;purchaseId?:string}):Promise<T>{const r=await fetch(`/api${path}`,{signal:options?.signal,method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json',...(options?.purchaseId?{'X-Questlayer-Purchase':options.purchaseId}:{})},credentials:'same-origin',...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await r.json();if(!r.ok)throw new ApiError(result.error||'Could not connect to the game.',result.code,r.status,result.details);return result as T;}
export function meters(a:{lat:number;lng:number},b:{lat:number;lng:number}){const r=Math.PI/180;const x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;return Math.sqrt(x*x+y*y)*6371000;}
export function remaining(at:number){const s=Math.max(0,Math.ceil((at-Date.now())/1000));if(s<60)return tr("{0} s",{0:s});if(s<3600)return tr("{0} min",{0:Math.ceil(s/60)});return tr("{0} h {1} min",{0:Math.floor(s/3600),1:Math.floor(s%3600/60)});}
