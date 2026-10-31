import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { api } from "../src/api";
import type { Item, Player } from "../src/types";
import type { AdventureRealm, AdventureResult } from "../src/adventure-results";
import { useAdventureResults } from "../src/useAdventureResults";
import { AdventureResultDialog, AdventureResultResume } from "../src/AdventureResults";
import "../src/style.css";
import "../src/play-ui.css";
import "./adventure-results.css";

const item: Item = { id:"fixture-exact-aura-17", kind:"aura", name:"Northern Lights", rarity:"rare", slot:"above", color:"#9c6bdf", equipped:0, serial:17 };
type Context = { actor:string; realm:AdventureRealm; enabled:boolean; online:boolean; nativeOutfit:boolean; equipped:boolean };
const initial: Context = { actor:"fixture-explorer-a", realm:"arena", enabled:true, online:true, nativeOutfit:false, equipped:false };
const ids = ["owned", "no-item", "legacy", "listed"] as const;
const completedAt = Date.UTC(2026,9,31,12);

function resultFor(kind:string, context:Context, viewedAt:number|null):AdventureResult {
  const legacy=kind==="legacy", noItem=kind==="no-item", listed=kind==="listed";
  const equipped=context.equipped && !context.nativeOutfit;
  return { id:`fixture-result-${kind}`, version:1, domain:"demo", source:"system-quest", status:legacy?"legacy-unavailable":"confirmed", playerId:context.actor, worldId:`demo:fixture:${context.realm}`, realm:context.realm, questId:`fixture-quest-${kind}`, questKind:noItem?"visit":"chest", title:legacy?"Old riverbank discovery":noItem?"Riverbank observation":listed?"Market-square discovery":"Northern riverbank chest", completedAt, viewedAt, reward:legacy?null:{xp:noItem?50:80,goldU:0,item:noItem?null:{...item}}, itemCurrent:{status:legacy?"legacy-unavailable":noItem?"none":listed?"listed":"owned", equippable:!legacy&&!noItem&&!listed&&!equipped, equipped:!legacy&&!noItem&&!listed&&equipped, reason:legacy?"Exact historical reward detail is unavailable.":noItem?"No item was awarded.":listed?"Cancel the demo listing before equipping this Aura.":equipped?"This Aura is already equipped.":"This Aura can be equipped in your demo inventory.", item:legacy||noItem?null:{...item,equipped:context.equipped?1:0} } };
}

function Fixture() {
  const [context,setContext]=useState(initial);
  const contextRef=useRef(context); contextRef.current=context;
  const viewed=useRef(new Map<string,number>());
  const transportLog=useRef<string[]>([]);
  const nextDetailDelay=useRef(80);
  const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const [message,setMessage]=useState("Choose a simulated result or a declared timed scenario. All state is private to this page and lost on reload.");
  const later=(after:number,fn:()=>void)=>timers.current.push(setTimeout(fn,after));
  const clearTimers=()=>{ timers.current.forEach(clearTimeout); timers.current=[]; };
  useEffect(()=>()=>clearTimers(),[]);
  const request=useCallback<typeof api>(async <T,>(path:string,data?:unknown,_options?:{signal?:AbortSignal}):Promise<T>=>{
    const captured={...contextRef.current};
    const url=new URL(path,"https://fixture.invalid");
    const isList=url.pathname==="/adventure-results";
    const isAck=url.pathname.endsWith("/viewed");
    const kind=isList?"":decodeURIComponent(url.pathname.split("/")[2]||"").replace("fixture-result-","");
    const key=(id:string)=>JSON.stringify([captured.actor,captured.realm,id]);
    const delay=isList||isAck?20:nextDetailDelay.current;
    if(!isList&&!isAck) nextDetailDelay.current=80;
    // Deliberately finish stale fake reads despite abort so the hook's scope fence is exercised.
    await new Promise<void>(resolve=>setTimeout(resolve,delay));
    transportLog.current.push(`${data===undefined?"GET":"POST"} ${path} actor=${captured.actor} realm=${captured.realm}`);
    if(isList){
      let results=ids.map(id=>resultFor(id,captured,viewed.current.get(key(id))??null));
      if(url.searchParams.get("unviewedOnly")==="true") results=results.filter(r=>r.status==="confirmed"&&r.viewedAt===null);
      results=results.slice(0,Number(url.searchParams.get("limit")||20));
      return {results,nextCursor:null} as T;
    }
    if(!ids.includes(kind as typeof ids[number])) throw new Error("Unknown simulated result.");
    if(isAck&&!viewed.current.has(key(kind))) viewed.current.set(key(kind),Date.now());
    return {result:resultFor(kind,captured,viewed.current.get(key(kind))??null)} as T;
  },[]);
  const results=useAdventureResults({playerId:context.actor,realm:context.realm,enabled:context.enabled,online:context.online,request});
  const player:Player={ id:context.actor,name:"Synthetic riverbank explorer",appearance:{},gold_u:0,xp:80,level:1,tier:0,weighted_u:0,inventory:[{...item,equipped:context.equipped?1:0}],positions:[],withdrawals:[],history:[],wallets:[],nativeOutfit:context.nativeOutfit };
  function inspect(kind:string){void results.inspect(`fixture-result-${kind}`);}
  function roundtrip(kind:"realm"|"actor"|"native") {
    clearTimers();
    const before={...context};
    nextDetailDelay.current=1000;
    setMessage(`Simulated ${kind} roundtrip: detail GET finishes after1000ms; switch away at300ms, return at600ms. The old result must stay closed.`);
    inspect("owned");
    later(300,()=>setContext({...before,...(kind==="realm"?{realm:before.realm==="arena"?"gps":"arena"}:kind==="actor"?{actor:"fixture-explorer-b"}:{enabled:false})}));
    later(600,()=>setContext(before));
    later(1400,()=>setMessage(`${kind} scenario complete. Expected: no result dialog automatically reopened. All reads and acknowledgements were simulated.`));
  }
  async function connectionRoundtrip(){
    clearTimers();
    setMessage("Opening a fresh simulated detail, then offline at300ms/reconnect at600ms. Historic detail must remain; Try it on stays disabled until a manual fresh check.");
    await results.inspect("fixture-result-owned");
    later(300,()=>setContext(value=>({...value,online:false})));
    later(600,()=>setContext(value=>({...value,online:true})));
  }
  function reset(){clearTimers();results.close();setContext(initial);setMessage("Simulation reset. No server, wallet, GPS or economic state was changed.");}
  return <>
    <main className="result-fixture">
      <h1>Simulated adventure result review</h1>
      <p><strong>Presentation fixture only.</strong> Real shared result components and hook; fake in-memory transport. No API, wallet, GPS, rewards or inventory writes.</p>
      <p role="status">{message}</p>
      <p className="result-fixture-state">Actor: {context.actor} · Realm: {context.realm} · Demo enabled: {String(context.enabled)} · Online: {String(context.online)} · Native outfit: {String(context.nativeOutfit)}</p>
      {results.unread&&<AdventureResultResume result={results.unread} onInspect={()=>void results.inspect(results.unread!.id)}/>}
      <div className="result-fixture-actions">
        <button onClick={()=>inspect("owned")}>Open owned Northern Lights ·80XP ·0demoGOLD</button>
        <button onClick={()=>inspect("no-item")}>Open confirmed visit without an Aura</button>
        <button onClick={()=>inspect("legacy")}>Open historical detail unavailable</button>
        <button onClick={()=>inspect("listed")}>Open listed Aura</button>
        <button onClick={()=>{setContext(value=>({...value,nativeOutfit:true,equipped:true}));later(0,()=>inspect("owned"));}}>Open retained demo Aura while native outfit is active</button>
        <button onClick={results.history}>Open result archive</button>
        <button onClick={()=>roundtrip("realm")}>Pending detail: realm away300ms /back600ms</button>
        <button onClick={()=>roundtrip("actor")}>Pending detail: actor away300ms /back600ms</button>
        <button onClick={()=>roundtrip("native")}>Pending detail: native mode away300ms /back600ms</button>
        <button onClick={()=>void connectionRoundtrip()}>Fresh detail: offline300ms /reconnect600ms</button>
        <button onClick={reset}>Reset simulation</button>
      </div>
      <p>Use Escape to close a result before starting another scenario. The Try it on callback changes only this fixture's synthetic outfit. It does not exercise App's delayed equipment navigation flow.</p>
    </main>
    <AdventureResultDialog results={results} player={player} realm={context.realm} online={context.online} busy={false} onInspect={id=>void results.inspect(id)} onEquip={()=>{setContext(value=>({...value,equipped:true,nativeOutfit:false}));results.close();setMessage("Simulated desiredEquipped:true selected the local demo outfit. No server transaction occurred.");}} onInventory={()=>{results.close();setMessage("Simulated inventory destination. No real inventory was opened.");}} onMap={()=>{results.close();setMessage("Simulated map destination. No map or movement occurred.");}}/>
  </>;
}
if(new URLSearchParams(location.search).get("text")==="large") document.body.classList.add("result-fixture-large");
createRoot(document.getElementById("root")!).render(<Fixture/>);
