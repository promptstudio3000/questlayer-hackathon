// The QuestLayer wiki at /wiki (docs/WIKI.md): a public, read-only know-how
// center that explains every mechanism in force. Each chapter reads in three
// layers: a TL;DR, a few key numbers and one picture; everything else sits
// under "More details" so the page stays short. Own lazy chunk; nothing here
// loads for the game itself.
import React, { useEffect, useMemo, useState } from "react";
import { ArrowsInLineVertical, ArrowsOutLineVertical, CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { CHAPTERS, GROUPS, STATUS_LABEL, type Block, type Chapter } from "./chapters";
import { BigPicture, Viz } from "./diagrams";
import "./wiki.css";
import "../public-polish.css";
import { scrollRegionKeys } from "../scroll-region";

/** **bold**, `code` and [label](/path) — the only markup chapters use. */
export function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0,
    m: RegExpExecArray | null,
    k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={k++}>{m[2]}</code>);
    else out.push(<a key={k++} href={m[4]}>{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function BlockView({ b }: { b: Block }) {
  if ("h" in b) return <h3>{b.h}</h3>;
  if ("p" in b) return <p>{inline(b.p)}</p>;
  if ("list" in b)
    return (
      <ul className="wk-list">
        {b.list.map((t, i) => (
          <li key={i}>{inline(t)}</li>
        ))}
      </ul>
    );
  if ("table" in b)
    return (
      <div className="wk-table-wrap" tabIndex={0} role="group" aria-label={b.table.head.join(", ")} onKeyDown={scrollRegionKeys}>
        <table className="wk-table">
          <thead>
            <tr>
              {b.table.head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{inline(c)}</th> : <td key={j}>{inline(c)}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if ("facts" in b)
    return (
      <dl className="wk-facts">
        {b.facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{inline(v)}</dd>
          </div>
        ))}
      </dl>
    );
  if ("viz" in b) return <Viz id={b.viz} />;
  return <aside className={`wk-note ${b.tone ?? "info"}`}>{inline(b.note)}</aside>;
}

const blockText = (b: Block) =>
  "p" in b ? b.p : "list" in b ? b.list.join(" ") : "h" in b ? b.h : "note" in b ? b.note : "table" in b ? b.table.rows.flat().join(" ") : "facts" in b ? b.facts.flat().join(" ") : "";

const plain = (c: Chapter) => [c.title, c.tldr, ...c.keyFacts.flat(), ...c.blocks.map(blockText)].join(" ").toLowerCase();

function KeyFacts({ facts }: { facts: Chapter["keyFacts"] }) {
  if (!facts.length) return null;
  return (
    <dl className="wk-keyfacts">
      {facts.map(([value, label]) => (
        <div key={label}>
          <dt>{inline(label)}</dt>
          <dd>{inline(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChapterView({ c, index, open, onToggle }: { c: Chapter; index: number; open: boolean; onToggle: (open: boolean) => void }) {
  const topics = c.blocks.filter((b): b is { h: string } => "h" in b).map((b) => b.h);
  return (
    <section id={c.id} className="wk-chapter" aria-labelledby={`${c.id}-title`}>
      <header>
        <span className="wk-num" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <h2 id={`${c.id}-title`}>
            <a href={`#${c.id}`}>{c.title}</a>
          </h2>
          <p className="wk-meta">
            <span className={`wk-status ${c.status}`}>{STATUS_LABEL[c.status]}</span>
            <span>Checked {c.updated}</span>
          </p>
        </div>
      </header>
      <div className="wk-tldr">
        <span className="wk-tldr-tag">TL;DR</span>
        <p>{inline(c.tldr)}</p>
      </div>
      <KeyFacts facts={c.keyFacts} />
      {c.hero ? <Viz id={c.hero} /> : null}
      <details className="wk-more" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <CaretDown className="wk-more-caret" size={20} weight="bold" aria-hidden="true" />
          <span className="wk-more-label">{open ? "Fewer details" : "More details"}</span>
          {topics.length ? <span className="wk-more-topics">{topics.join(" · ")}</span> : null}
        </summary>
        <div className="wk-more-body">
          {c.blocks.map((b, i) => (
            <BlockView key={i} b={b} />
          ))}
          <details className="wk-sources">
            <summary>Sources in the repository ({c.sources.length})</summary>
            <ul>
              {c.sources.map((s) => (
                <li key={s}>
                  <code>{s}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </section>
  );
}

export default function WikiPage() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(CHAPTERS[0].id);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    document.title = "QuestLayer wiki";
    document.documentElement.classList.add("wk-root");
    return () => document.documentElement.classList.remove("wk-root");
  }, []);

  const index = useMemo(() => new Map(CHAPTERS.map((c) => [c.id, plain(c)])), []);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? CHAPTERS.filter((c) => q.split(/\s+/).every((w) => index.get(c.id)!.includes(w))) : CHAPTERS), [q, index]);

  // A search opens the details of every matching chapter, so the match is on screen.
  useEffect(() => {
    if (q) setOpen(new Set(visible.map((c) => c.id)));
  }, [q, visible]);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const c of visible) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    // Deep links (/wiki#qgold) land after the lazy chunk renders.
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);

  const allOpen = visible.length > 0 && visible.every((c) => open.has(c.id));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(CHAPTERS.map((c) => c.id)));
  const setChapter = (id: string, isOpen: boolean) =>
    setOpen((prev) => {
      if (prev.has(id) === isOpen) return prev;
      const next = new Set(prev);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });

  const live = CHAPTERS.filter((c) => c.status === "live").length;
  return (
    <div className="wk">
      <header className="wk-top">
        <a className="wk-brand" href="/">
          QuestLayer <span>wiki</span>
        </a>
        <nav aria-label="Related pages">
          <a href="/how-it-works">How it works</a>
          <a href="/economy">Economy</a>
          <a href="/treasury">Treasury</a>
          <a className="wk-play" href="/">
            Play
          </a>
        </nav>
      </header>
      <div className="wk-hero">
        <h1>How QuestLayer works</h1>
        <p>
          Every mechanism in force, short first: a TL;DR, the key numbers and one picture per chapter. Open <strong>More details</strong> only where you need them. {CHAPTERS.length}{" "}
          chapters, {live} fully live on testnet.
        </p>
        <div className="wk-hero-tools">
          <label className="wk-search">
            <MagnifyingGlass size={20} aria-hidden="true" />
            <span className="wk-visually-hidden">Search the wiki</span>
            <input type="search" placeholder="Search: vault, waves, Intents, XP…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" className="wk-expand" aria-pressed={allOpen} onClick={toggleAll}>
            {allOpen ? <ArrowsInLineVertical size={20} aria-hidden="true" /> : <ArrowsOutLineVertical size={20} aria-hidden="true" />}
            {allOpen ? "Fold all details" : "Open all details"}
          </button>
        </div>
        {q ? (
          <p className="wk-search-count" role="status">
            {visible.length ? `${visible.length} of ${CHAPTERS.length} chapters mention “${query.trim()}”; their details are open.` : ""}
          </p>
        ) : null}
      </div>
      {!q ? <BigPicture /> : null}
      <div className="wk-body">
        <nav className={`wk-toc${menu ? " open" : ""}`} aria-label="Chapters">
          <button type="button" className="wk-toc-toggle" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            Chapters
            <CaretDown size={18} weight="bold" aria-hidden="true" />
          </button>
          <div className="wk-toc-list">
            {GROUPS.map((g) => {
              const items = visible.filter((c) => c.group === g.id);
              if (!items.length) return null;
              return (
                <div key={g.id}>
                  <h4>{g.title}</h4>
                  <ul>
                    {items.map((c) => (
                      <li key={c.id}>
                        <a href={`#${c.id}`} aria-current={active === c.id ? "location" : undefined} onClick={() => setMenu(false)}>
                          <i className={`wk-dot-status ${c.status}`} aria-hidden="true" />
                          {c.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>
        <main className="wk-main">
          {visible.length ? (
            visible.map((c) => <ChapterView key={c.id} c={c} index={CHAPTERS.indexOf(c)} open={open.has(c.id)} onToggle={(o) => setChapter(c.id, o)} />)
          ) : (
            <p className="wk-empty-search">No chapter mentions “{query}”.</p>
          )}
          <footer className="wk-foot">
            <p>
              Runs on NEAR testnet; test NEAR has no monetary value. This wiki is updated together with every change to a mechanism (see “How this wiki stays current”).
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
