import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { personaFor } from "../server/npc/personas.mjs";
import { buildMenu, offerFacts, MAX_LINES_PER_DAY } from "../server/npc/offers.mjs";
import { createNpcService } from "../server/npc/service.mjs";
import { createKeeperVault } from "../server/npc/keeper-vault.mjs";
import {
  PATRON_PATH_LINES,
  PATRON_STORY,
  completedPatronLines,
  patronEditionLive,
  patronPathView,
} from "../server/npc/patron-path.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const RADA = { id: "rada", kind: "npc", archetype: "quest_giver", name: "Poutnice Ráda", persona: "poutnice-rada" };
const BELA = { id: "bela", kind: "npc", archetype: "storyteller", name: "Kronikářka Běla", persona: "kronikarka-bela" };

async function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Patron", NOW);
  const world = await ensureWorld(db, HOME, true, NOW);
  let clock = NOW;
  const view = (tier = 2) => ({ ...worldView(db, world.id, player, { now: clock }), playerTier: tier });
  const service = createNpcService(db, {
    env: {},
    config: { provider: "template", perHour: 20, perMinute: 6, dailyCalls: 2000 },
    provider: null,
    clock: () => clock,
  });
  return { db, player, view, service, tick: (ms) => (clock += ms) };
}

const walk = (db, player, offer, at) => {
  for (const s of offer.terms.steps) db.prepare("INSERT OR IGNORE INTO quest_claims VALUES (?,?,?)").run(s.questId, player, at);
};

test("patron lines: Tier 2 only, end in a patron zone, same XP as any line", async (t) => {
  const { view } = await fixture(t);
  for (const npc of [RADA, BELA]) {
    const persona = personaFor(npc);
    const free = buildMenu({ actor: npc, persona, world: view(1), now: NOW });
    assert.ok(!free.some((o) => o.terms.patron), "no patron offers below the tier");
    const menu = buildMenu({ actor: npc, persona, world: view(2), now: NOW });
    const patron = menu.filter((o) => o.terms.patron);
    assert.equal(patron.length, 1, `${npc.id}: one patron offer per NPC and day`);
    const [p] = patron;
    const zones = new Map(view(2).zones.map((z) => [z.name, z]));
    const last = p.terms.steps.at(-1);
    assert.ok(last.tier >= 2 && zones.get(last.zone).tier >= 2, "the line leads into a patron zone");
    assert.equal(p.terms.pathLine, 1);
    assert.match(p.id, /^(?:quest|chapter):[0-9a-f]{16}$/, "the id fits the accept/complete route");
    assert.equal(p.terms.pathOf, PATRON_PATH_LINES);
    if (npc === RADA) {
      assert.equal(p.kind, "quest");
      assert.equal(p.terms.xp, 20 * p.terms.steps.length + 10, "no bonus XP: the lure is the walk and the story");
    } else {
      assert.equal(p.kind, "chapter");
      assert.equal(p.terms.aura, false, "patron chapters sit outside the story sets");
    }
    const others = menu.filter((o) => !o.terms.patron).flatMap((o) => o.terms.steps.map((s) => s.questId));
    assert.ok(p.terms.steps.every((s) => !others.includes(s.questId)), "no step is offered twice");
    const fact = offerFacts(menu)[menu.indexOf(p)].text;
    assert.match(fact, /Patron's Path/);
    assert.doesNotMatch(`${p.label} ${fact.replace("does not change any luck or payout", "")}`, /odds|chance|multiplier|%|luck|payout/i);
    // Taken patron line today: no second one; the regular cap does not hide it.
    assert.ok(!buildMenu({ actor: npc, persona, world: view(2), now: NOW, patronToday: 1 }).some((o) => o.terms.patron));
    if (npc === RADA) {
      const capped = buildMenu({ actor: npc, persona, world: view(2), now: NOW, linesToday: MAX_LINES_PER_DAY });
      assert.deepEqual(capped.map((o) => o.id), [p.id], "regular cap reached: only the patron line stays");
    }
  }
});

test("patron path: turn-ins reveal the story, count across NPCs, keeper shows progress", async (t) => {
  const { db, player, view, service, tick } = await fixture(t);
  const npcs = [RADA, BELA, { ...RADA, id: "rada-2" }, { ...BELA, id: "bela-2" }];
  let step = 0;
  for (const npc of npcs) {
    const offer = service.greet({ player, actor: npc, world: view() }).menu.find((o) => o.terms.patron);
    if (!offer) continue;
    // A Tier 1 player cannot accept it (the offer is not on their menu).
    assert.throws(() => service.accept({ player, actor: npc, world: view(1), offerId: offer.id }), /no longer available/);
    service.accept({ player, actor: npc, world: view(), offerId: offer.id });
    const active = service.greet({ player, actor: npc, world: view() }).active.find((l) => l.offerId === offer.id);
    assert.deepEqual(active.patron, { pathLine: step + 1, pathOf: PATRON_PATH_LINES });
    tick(1000);
    walk(db, player, offer, NOW + step * 10_000 + 2000);
    tick(10_000);
    const done = service.complete({ player, actor: npc, world: view(), offerId: offer.id });
    step++;
    assert.equal(done.state, "completed");
    assert.equal(done.patron.pathLine, Math.min(step, PATRON_PATH_LINES));
    assert.deepEqual(done.patron.story, PATRON_STORY[Math.min(step, PATRON_STORY.length) - 1]);
    if (!patronEditionLive()) assert.equal(done.patron.edition, null, "edition waits for the collectibles upgrade");
    if (step >= PATRON_PATH_LINES) break;
  }
  assert.ok(step >= 2, "the test world has enough patron zones for two lines");
  assert.equal(completedPatronLines(db, player), step);
  // Patron lines never feed the storyteller's chapter set count.
  assert.equal(db.prepare("SELECT count(*) n FROM earned_editions WHERE edition='chronicle'").get().n, 0);
  const path = patronPathView(db, player);
  assert.equal(path.done, step);
  assert.equal(path.story.filter((c) => !c.locked).length, step);
  assert.ok(path.story.slice(step).every((c) => c.locked && !c.text));
  const keeper = createKeeperVault(db, { clock: () => NOW });
  const card = keeper.view({ player, level: 1, positions: [], patronPath: path });
  assert.equal(card.inner.open, false, "no stake: the inner vault stays locked");
  assert.equal(card.inner.path.done, step, "progress stays visible after a withdrawal (D29)");
});
