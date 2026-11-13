import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Cube } from "@phosphor-icons/react";
import { api } from "../api";
import { ChainLink } from "../ChainLink";
import { ChainFeed } from "../ChainFeed";
import type { ChainRef } from "../chain-proof";
import { tr } from "../i18n";

type Action = { id: string; kind: string; at: number; evidenceHash: string; chain: ChainRef | null };
type Activity = { network: string; contract: string | null; verifier: string; submission: string; actions: Action[] };
const title = (kind: string) => ({
  "expedition-started": tr("Expedition accepted"), "hollow-found": tr("Crystal Hollow discovered"),
  "quarry-found": tr("Basalt Quarry discovered"), "resource-mined": tr("Resource mined"),
  "block-changed": tr("Block placed"), "block-removed": tr("Block removed"),
  "atlas-revealed": tr("Atlas tile discovered"), "signal-tuned": tr("Signal tuned"),
  "marker-built": tr("Trail marker built"), "marker-checked": tr("Trail marker checked"),
  "beacon-restored": tr("Beacon restored"),
  "place-found": tr("World place discovered"),
})[kind] || tr("World action");

export function LayerActivity({ layer }: { layer: string }) {
  const [data, setData] = useState<Activity | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const verificationMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (verificationError) verificationMessage.current?.scrollIntoView({ block: "nearest" }); }, [verificationError]);
  const [actionId, setActionId] = useState(""), [transactionHash, setTransactionHash] = useState("");
  const [platform, setPlatform] = useState(false), [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (!platform) return;
    let active = true;
    void api<{ account?: string | null }>("/chain/profile").then(p => { if (active) setAccount(p.account || null); }).catch(() => {});
    return () => { active = false; };
  }, [platform]);
  const load = async () => {
    setBusy(true); setError("");
    try { setData(await api(`/layer/expedition/activity?layer=${encodeURIComponent(layer)}`)); }
    catch { setError(tr("Action history is unavailable. Try again.")); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [layer]);
  return <>
    <div className="ml-proof-heading"><h2>{tr("Actions and NEAR proofs")}</h2><button className="map-settings-toggle" onClick={() => void load()} disabled={busy} aria-label={tr("Refresh")}><ArrowClockwise size={22} /></button></div>
    <p>{tr("A saved world action and a finalized NEAR transaction are shown separately.")}</p>
    <div className="ml-chain-capabilities"><Cube size={24} /><div><strong>{tr("NEAR testnet")}</strong><span>{data?.verifier === "read-only" ? tr("Transaction verification ready") : tr("MetaLayer contract not connected")}</span></div></div>
    <p className="ml-story-note">{tr("MetaGold, MetaXP, badges and parcel NFTs are not issued by this preview.")}</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!data && !error && <p role="status">{tr("Loading…")}</p>}
    {data?.actions.length === 0 && <p>{tr("Your first discovery or block action will appear here.")}</p>}
    {data && data.actions.length > 0 && <ol className="ml-activity-list">{data.actions.slice(0, 10).map(action => <li key={action.id}>
      <div><strong>{title(action.kind)}</strong><small>{new Date(action.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small></div>
      {action.chain ? <ChainLink chain={action.chain} label /> : <span className="ml-local-receipt">{tr("Saved in preview")}</span>}
      <code title={action.evidenceHash}>{action.evidenceHash.slice(0, 16)}</code>
    </li>)}</ol>}
    {data?.verifier === "read-only" && data.actions.some(a => !a.chain) && <form className="ml-proof-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setVerificationError("");
      try { setData(await api("/layer/expedition/verify", { layer, actionId, transactionHash: transactionHash.trim() })); setTransactionHash(""); }
      catch { setVerificationError(tr("This transaction does not verify the selected MetaLayer action. Keep its reference and retry.")); }
      finally { setBusy(false); }
    }}>
      <div><label htmlFor="ml-proof-action">{tr("World action")}</label><select id="ml-proof-action" required value={actionId} onChange={e => setActionId(e.target.value)}><option value="">{tr("Choose an action")}</option>{data.actions.filter(a => !a.chain).map(a => <option key={a.id} value={a.id}>{title(a.kind)} · {a.id.slice(-6)}</option>)}</select></div>
      <div><label htmlFor="ml-proof-hash">{tr("NEAR transaction hash")}</label><input id="ml-proof-hash" required value={transactionHash} onChange={e => setTransactionHash(e.target.value)} maxLength={44} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></div>
      {verificationError && <p className="ml-sheet-error" ref={verificationMessage} role="alert">{verificationError}</p>}
      <button className="primary-button ml-wide" disabled={busy}>{tr("Verify transaction")}</button>
    </form>}
    <details className="screen-details" onToggle={e => setPlatform(e.currentTarget.open)}><summary>{tr("Platform account history")}</summary><p>{tr("Account, NFT and city transactions from QuestLayer. These do not verify MetaLayer actions.")}</p>{platform && <ChainFeed accountId={account} />}</details>
  </>;
}
