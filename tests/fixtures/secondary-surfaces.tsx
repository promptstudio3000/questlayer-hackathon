// Render real secondary components with explicit, synthetic local read responses.
// Callback receipts here establish UI behavior only; no wallet or financial operation runs.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "../../src/Dialog";
import { NativeProfilePanel } from "../../src/NativeProfile";
import { AccountSessions } from "../../src/AccountSessions";
import { DeviceKeys } from "../../src/DeviceKeys";
import { NativeStaking } from "../../src/NativeStaking";
import { PlayerCard } from "../../src/PlayerCard";
import { NoteRecordDialog } from "../../src/NoteRecordDialog";
import { EmptyState } from "../../src/EmptyState";
import { GoldShop } from "../../src/GoldShop";
import { PlaceMessages } from "../../src/PlaceMessages";
import "../../src/style.css";
import "../../src/mobile-adventure.css";
import "../../src/profile-community.css";
import "../../src/secondary-surfaces.css";
const state = window as any;
const sample = state.__secondaryFixture;
const kind = new URLSearchParams(location.search).get("case") || "profile-ready";
const player = { ...sample.player, wallets: [{ account_id: "mira.testnet", wallet: "fixture" }] };
const failure = () => Promise.reject(new Error("The connection was interrupted. Your changes have not been confirmed."));
const stalled = () => new Promise<any>(() => {});
const profile = { accountId: "mira.testnet", status: "missing", publishAvatar: null, publishEnabled: true, deposit: "1", profile: null, avatarVerified: false };
const readProfile = kind === "profile-error" ? failure : kind === "profile-loading" ? stalled : () => Promise.resolve(kind === "profile-published" ? { ...profile, status: "published", profile: { name: "Mira", avatar: null } } : profile);
const sessions = () => Promise.resolve({ network: "testnet", activeSessionCount: 2, hasMoreSessions: false, evmWallets: [], sessions: [{ id: "current", current: true, kind: "browser", accountId: "mira.testnet", createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now()+86400000 }, { id: "other", current: false, kind: "browser", accountId: "mira.testnet", createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now()+86400000 }], recovery: { nearAccounts: ["mira.testnet"], demoPasskeys: 0, canRevokeOtherSessions: true, nativePasskeyAccount: false } });
const record = { network: "testnet", contractId: "v1.social08.testnet", accountId: "mira.testnet", noteId: "message_fixture", localState: "active", chain: null, media: null, publications: [], permanence: "Earlier copies may remain public." };
const readRecord = kind === "record-error" ? failure : () => Promise.resolve(record);
const vaults = () => Promise.resolve({network:"testnet",factoryId:"factory.testnet",status:"ready",config:{setup_deposit:"100000000000000000000000",vault_reserve:"10000000000000000000000",factory_storage:"1000000000000000000000",created:0,capacity:100},pools:[{id:"pool.testnet",name:"Example validator"}],positions:[],refund:null});
function Fixture() {
 const [open,setOpen] = useState(false);
 const callback = async (...args: unknown[]) => { (state.__secondaryActions ||= []).push(args); return true; };
 const close = () => setOpen(false);
 const content = kind.startsWith("profile-") ? <NativeProfilePanel player={player} busy={kind === "profile-pending" ? "native-profile" : ""} onConnect={callback} onPublish={callback} readProfile={readProfile as any} />
 : kind === "account" ? <><AccountSessions player={player} busy="" onConnect={callback} onRevoke={callback} readSessions={sessions as any} /><DeviceKeys status="ready" accountId="mira.testnet" keys={[{publicKey:"local-device-a",kind:"device",state:"active",label:"This browser",createdAt:Date.now()},{publicKey:"local-device-b",kind:"device",state:"active",label:"Travel phone",createdAt:Date.now()}] as any} localPublicKey="local-device-a" busy="" onSetupRecovery={callback} onRevoke={callback} onRestore={callback}/></>
 : kind === "staking" ? <NativeStaking player={player} onConnect={callback} onTransaction={callback} readVaults={vaults}/>
 : kind === "shop" ? <GoldShop worldId="fixture" fix={null} arena onSpent={()=>callback("spent")} notify={()=>{}}/>
 : kind === "places" ? <PlaceMessages position={{lat:49.74745,lng:13.3774}} fix={null} arena notify={()=>{}} onSpent={()=>callback("spent")}/>
 : <EmptyState title="No discoveries in this area yet" art="chest" action={{label:"Back to map",onClick:close}}>Try another part of the map.</EmptyState>;
 let surface: React.ReactNode;
 if (kind === "player") surface = <PlayerCard playerId="other-explorer" onClose={close}/>;
 else if (kind.startsWith("record-")) surface = <NoteRecordDialog noteId="message_fixture" noteText="A quiet fountain between discoveries." account={{accountId:"mira.testnet",managed:false}} onRecord={callback} onClose={close} read={readRecord as any}/>;
 else if (kind === "confirmation") surface = <Dialog label="Remove note?" onClose={close}>
   <h2>Remove note?</h2><p>The public pin will be removed. This action does not erase earlier public records.</p>
   <button className="secondary-button" onClick={close}>Cancel</button>
   <button className="primary-button" onClick={()=>{callback("confirm");close();}}>Remove note</button>
 </Dialog>;
 else surface = <div className="app-shell" data-screen="settings" data-area="profile">
   <Dialog label="Explorer details" onClose={close}><div className="secondary-fixture">{content}</div><button className="secondary-button" onClick={close}>Close</button></Dialog>
 </div>;
 return <><button id="fixture-open" onClick={()=>setOpen(true)}>Open detail</button><p className="fixture-disclosure">Synthetic local UI fixture · no financial operation</p>{open && surface}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
