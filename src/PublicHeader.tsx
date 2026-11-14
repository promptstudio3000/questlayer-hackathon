// One header for every public info page (/how-it-works, /treasury, /economy,
// /wiki): the same brand, the same links between the pages and the same Play
// button back to the game. Styles live in src/public-polish.css (.pub-top).
import { ArrowRight } from "./dir-icons";
import { tr } from "./i18n";

export type PublicPage = "how-it-works" | "treasury" | "economy" | "wiki";

const links = (): [PublicPage, string][] => [
  ["how-it-works", tr("How it works")],
  ["treasury", tr("Treasury")],
  ["economy", tr("Economy")],
  ["wiki", tr("Wiki")],
];

export function PublicHeader({ current }: { current: PublicPage }) {
  return (
    <header className="pub-top">
      <a className="pub-brand" href="/">
        <img src="/icon.svg" alt="" width={32} height={32} />
        <span>QuestLayer</span>
      </a>
      <nav className="pub-links" aria-label={tr("Learn more")}>
        {links().map(([page, label]) => (
          <a key={page} href={`/${page}`} aria-current={page === current ? "page" : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <a className="pub-play" href="/">
        {tr("Play now")} <ArrowRight size={18} weight="bold" />
      </a>
    </header>
  );
}
