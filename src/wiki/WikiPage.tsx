// The QuestLayer wiki at /wiki (docs/WIKI.md): a public, read-only know-how
// center that explains every mechanism in force, with diagrams, charts and
// small simulators. Own lazy chunk; nothing here loads for the game itself.
import React, { useEffect, useMemo, useState } from "react";
import { CHAPTERS, GROUPS, STATUS_LABEL, type Block, type Chapter } from "./chapters";
import { Viz } from "./diagrams";
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

const plain = (c: Chapter) =>
  [c.title, c.summary, ...c.blocks.map((b) => ("p" in b ? b.p : "list" in b ? b.list.join(" ") : "h" in b ? b.h : "note" in b ? b.note : "table" in b ? b.table.rows.flat().join(" ") : ""))]
    .join(" ")
    .toLowerCase();

function ChapterView({ c, index }: { c: Chapter; index: number }) {
  return (
    <section id={c.id} className="wk-chapter" aria-labelledby={`${c.id}-title`}>
      <header>
        <span className="wk-num">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2 id={`${c.id}-title`}>
            <a href={`#${c.id}`}>{c.title}</a>
          </h2>
          <p className="wk-summary">{c.summary}</p>
          <p className="wk-meta">
            <span className={`wk-status ${c.status}`}>{STATUS_LABEL[c.status]}</span>
            <span>Checked {c.updated}</span>
          </p>
        </div>
      </header>
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
    </section>
  );
}

export default function WikiPage() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(CHAPTERS[0].id);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    document.title = "QuestLayer wiki";
    document.documentElement.classList.add("wk-root");
    return () => document.documentElement.classList.remove("wk-root");
  }, []);

  const index = useMemo(() => new Map(CHAPTERS.map((c) => [c.id, plain(c)])), []);
  const q = query.trim().toLowerCase();
  const visible = q ? CHAPTERS.filter((c) => q.split(/\s+/).every((w) => index.get(c.id)!.includes(w))) : CHAPTERS;

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
        <h1>How QuestLayer works, in detail</h1>
        <p>
          The know-how center: every mechanism in force, how it connects to the others and where it lives in the code. {CHAPTERS.length} chapters, {live} of them fully live on
          testnet.
        </p>
        <label className="wk-search">
          <span className="wk-visually-hidden">Search the wiki</span>
          <input type="search" placeholder="Search: vault, waves, Intents, XP…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="wk-body">
        <nav className={`wk-toc${menu ? " open" : ""}`} aria-label="Chapters">
          <button type="button" className="wk-toc-toggle" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            Chapters
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
            visible.map((c) => <ChapterView key={c.id} c={c} index={CHAPTERS.indexOf(c)} />)
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
