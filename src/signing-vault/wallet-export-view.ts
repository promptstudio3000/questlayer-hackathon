// The step-by-step wallet words screen inside the secure account window.
// One decision per step: warning, show, check, done. Words are written into
// the page only while the player holds them open, and are wiped afterwards.
import { wordChecks } from "./wallet-export.ts";

const HOLD_MS = 1200,
  AUTO_HIDE_MS = 120000;
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export function walletExportView(
  root: Element,
  heading: HTMLElement,
  o: {
    accountId: string;
    passkey: boolean;
    confirmPasskey: () => Promise<void>;
    create: () => Promise<{ words: string[]; publicKey: string }>;
    // Resolves to an error message, or null when the words are live.
    activate: (publicKey: string) => Promise<string | null>;
    cancel: () => Promise<void>;
  },
) {
  const body = el("section", "", "wallet-words"),
    status = el("p");
  status.setAttribute("role", "status");
  root.append(body, status);
  let words: string[] = [],
    publicKey = "",
    cleanup = () => {};
  const show = (title: string, ...nodes: Node[]) => {
    cleanup();
    cleanup = () => {};
    heading.textContent = title;
    status.textContent = "";
    body.replaceChildren(...nodes);
  };
  const actions = (...buttons: HTMLButtonElement[]) => {
    const row = el("div", "", "actions");
    row.append(...buttons);
    return row;
  };
  const cancelButton = () => {
    const b = el("button", "Cancel");
    b.onclick = () => {
      wipe();
      void o.cancel().then(() => {
        show("Cancelled", el("p", "Nothing changed. You can close this window."));
      });
    };
    return b;
  };
  const wipe = () => {
    words.fill("");
    words = [];
    publicKey = "";
  };

  function warn() {
    const list = el("ul", "", "wallet-facts");
    for (const text of [
      "Anyone with these 12 words controls your account.",
      "Never type them into a chat, an email or a website that asks.",
      "Write them on paper. Nobody can show them again, not even QuestLayer.",
    ])
      list.append(el("li", text));
    const go = el(
      "button",
      o.passkey ? "Unlock with my passkey" : "Hold to continue",
      "primary hold",
    );
    const start = async () => {
      go.disabled = true;
      try {
        if (o.passkey) await o.confirmPasskey();
        ({ words, publicKey } = await o.create());
        reveal();
      } catch (error) {
        go.disabled = false;
        status.textContent = (error as Error).message;
      }
    };
    if (o.passkey) go.onclick = () => void start();
    else {
      // A press and hold, so a stray tap never opens the words.
      let timer = 0;
      const stop = () => {
        clearTimeout(timer);
        go.classList.remove("holding");
      };
      go.onpointerdown = () => {
        go.classList.add("holding");
        timer = window.setTimeout(() => {
          stop();
          void start();
        }, HOLD_MS);
      };
      go.onpointerup = go.onpointerleave = go.onpointercancel = stop;
      go.oncontextmenu = (e) => e.preventDefault();
      // Keyboard and switch users cannot hold: one deliberate press counts.
      go.onclick = (e) => {
        if (e.detail === 0) void start();
      };
      cleanup = stop;
    }
    show(
      "Get 12 words for a wallet?",
      el("p", `They open ${o.accountId} in Meteor or another NEAR wallet.`),
      list,
      actions(cancelButton(), go),
    );
    go.focus();
  }

  function reveal() {
    const grid = el("ol", "", "wallet-grid"),
      toggle = el("button", "Show my words"),
      next = el("button", "I wrote them down", "primary");
    let open = false,
      timer = 0;
    next.disabled = true;
    const paint = () => {
      grid.replaceChildren(
        ...words.map((word) => el("li", open ? word : "•••••")),
      );
      grid.classList.toggle("closed", !open);
      toggle.textContent = open ? "Hide" : "Show my words";
    };
    const set = (value: boolean) => {
      open = value;
      clearTimeout(timer);
      if (open) {
        next.disabled = false;
        timer = window.setTimeout(() => set(false), AUTO_HIDE_MS);
      }
      paint();
    };
    const hide = () => set(false);
    toggle.onclick = () => set(!open);
    document.addEventListener("visibilitychange", hide);
    addEventListener("blur", hide);
    addEventListener("pagehide", hide);
    next.onclick = () => check();
    show(
      "Write these 12 words down",
      el("p", "In this order, on paper. They hide when you leave this window."),
      grid,
      actions(toggle, next),
      actions(cancelButton()),
    );
    cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
      removeEventListener("blur", hide);
      removeEventListener("pagehide", hide);
    };
    paint();
    toggle.focus();
  }

  function check() {
    const rounds = wordChecks(words);
    const ask = (index: number) => {
      const round = rounds[index];
      if (!round) return void finish();
      const options = el("div", "", "wallet-options");
      for (const option of round.options) {
        const b = el("button", option);
        b.onclick = () => {
          if (option === round.answer) ask(index + 1);
          else {
            reveal();
            status.textContent = "Not that one. Check your copy and try again.";
          }
        };
        options.append(b);
      }
      const back = el("button", "Show the words again");
      back.onclick = () => reveal();
      show(
        `Which is word ${round.position}?`,
        el("p", `Check ${index + 1} of ${rounds.length}. Read it from your paper.`),
        options,
        actions(back),
      );
    };
    ask(0);
  }

  async function finish() {
    const key = publicKey;
    show("Turning your words on…", el("p", "A few seconds. Keep this window open."));
    const error = await o.activate(key);
    wipe();
    if (error)
      show(
        "Your words were not turned on",
        el("p", error),
        el("p", "Throw that paper away and start again from Settings in QuestLayer."),
      );
    else
      show(
        "Your words work now",
        el("p", "Back to QuestLayer for the wallet links. You can close this window."),
      );
  }

  warn();
}
