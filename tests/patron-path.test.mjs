import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { personaFor } from "../server/npc/personas.mjs";
import { buildMenu, offerFacts, MAX_LINES_PER_DAY } from "../server/npc/offers.mjs";
import { createNpcService } from "../server/npc/service.mjs";
import { createKeeperVault } from "../server/npc/keeper-vault.mjs";
import { lockedOffers } from "../server/npc/offers.mjs";
import { recordStakerStatus, stakerAccess } from "../server/staker-gates.mjs";
import {
  PATRON_PATH_LINES,
  PATRON_STORY,
  completedPatronLines,
  patronEditionLive,
  patronPathView,
} from "../server/npc/patron-path.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const XP = { 1: 0, 2: 100, 4: 900 };
const TWO_NEAR = (2n * 10n ** 24n).toString();
const RADA = { id: "rada", kind: "npc", archetype: "quest_giver", name: "Poutnice Ráda", persona: "poutnice-rada" };
const BELA = { id: "bela", kind: "npc", archetype: "storyteller", name: "Kronikářka Běla", persona: "kronikarka-bela" };

async function fixture(t, { level = 4 } = {}) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Patron", NOW);
  db.prepare("UPDATE players SET xp=? WHERE id=?").run(XP[level], player);
  const world = await ensureWorld(db, HOME, true, NOW);
  let clock = NOW;
  const view = (tier = 2) => ({ ...worldView(db, world.id, player, { now: clock }), playerTier: tier });
  const service = createNpcService(db, {
    env: {},
    config: { provider: "template", perHour: 20, perMinute: 6, dailyCalls: 2000 },
    provider: null,
    clock: () => clock,
  });
  const setLevel = (l) => db.prepare("UPDATE players SET xp=? WHERE id=?").run(XP[l], player);
  return { db, player, view, service, setLevel, tick: (ms) => (clock += ms) };
}

const walk = (db, player, offer, at) => {
  for (const s of offer.terms.steps) db.prepare("INSERT OR IGNORE INTO quest_claims VALUES (?,?,?)").run(s.questId, player, at);
};

test("patron lines open by staker step AND level, never by odds", async (t) => {
  const { view } = await fixture(t);
  const at = (tier, level, extra = {}) => stakerAccess({ tier, level, ...extra });
  for (const npc of [RADA, BELA]) {
    const persona = personaFor(npc);
    const menu = (access, more = {}) => buildMenu({ actor: npc, persona, world: view(1), now: NOW, level: access.level, access, ...more });
    assert.ok(!menu(at(1, 4)).some((o) => o.terms.patron), "no stake: no patron offers");
    assert.ok(!menu(at(1, 1, { matured: TWO_NEAR })).some((o) => o.terms.patron), "staker at L1: chapter 1 needs L2");
    const first = menu(at(1, 2, { matured: TWO_NEAR })).filter((o) => o.terms.patron);
    assert.equal(first.length, 1, `${npc.id}: a 2 NEAR staker at L2 gets path step 1`);
    assert.ok(!menu(at(1, 3, { matured: TWO_NEAR }), { patronDone: 1 }).some((o) => o.terms.patron), "step 2+ needs L4");
    const later = menu(at(1, 4, { matured: TWO_NEAR }), { patronDone: 1 }).filter((o) => o.terms.patron);
    assert.equal(later.length, 1);
    assert.equal(later[0].terms.pathLine, 2);
    const [p] = first;
    assert.equal(p.terms.pathLine, 1);
    assert.match(p.id, /^(?:quest|chapter):[0-9a-f]{16}$/, "the id fits the accept/complete route");
    assert.equal(p.terms.pathOf, PATRON_PATH_LINES);
    assert.ok(p.terms.steps.every((s) => s.tier === 1), "a Tier 1 staker's patron stops stay in zones they may enter (E16)");
    if (npc === RADA) {
      assert.equal(p.kind, "quest");
      assert.equal(p.terms.xp, 20 * p.terms.steps.length + 10, "no bonus XP: the lure is the walk and the story");
    } else {
      assert.equal(p.kind, "chapter");
      assert.equal(p.terms.aura, false, "patron chapters sit outside the story sets");
    }
    const all = menu(at(1, 2, { matured: TWO_NEAR }));
    const others = all.filter((o) => !o.terms.patron).flatMap((o) => o.terms.steps.map((s) => s.questId));
    assert.ok(p.terms.steps.every((s) => !others.includes(s.questId)), "no step is offered twice");
    const fact = offerFacts(all)[all.findIndex((o) => o.terms.patron)].text;
    assert.match(fact, /Patron's Path/);
    assert.doesNotMatch(`${p.label} ${fact.replace("does not change any luck or payout", "")}`, /odds|chance|multiplier|%|luck|payout/i);
    assert.ok(!menu(at(1, 2, { matured: TWO_NEAR }), { patronToday: 1 }).some((o) => o.terms.patron), "one per NPC and day");
    // Tier 2 + L6 stakers: the patron walk leads into a Tier 2+ zone.
    const t2 = buildMenu({ actor: npc, persona, world: view(2), now: NOW, level: 6, access: at(2, 6) }).find((o) => o.terms.patron);
    assert.ok(t2.terms.steps.at(-1).tier >= 2);
    if (npc === RADA) {
      const capped = menu(at(1, 2, { matured: TWO_NEAR }), { linesToday: MAX_LINES_PER_DAY });
      assert.deepEqual(capped.map((o) => o.id), [p.id], "regular cap reached: only the patron line stays");
    }
    // Locked: the next path step shows exactly what is missing.
    const chip = lockedOffers({ actor: npc, persona, world: view(1), now: NOW, level: 1, access: at(1, 1) }).find((c) => c.kind === "patron_path");
    assert.ok(chip);
    assert.deepEqual(chip.locked.missing, ["Stake 2 NEAR", "Reach level 2"]);
    assert.equal(chip.locked.stakeNear, "2");
    assert.doesNotMatch(`${chip.label} ${chip.perk}`, /odds|chance|multiplier|%/i);
    assert.ok(!lockedOffers({ actor: npc, persona, world: view(1), now: NOW, level: 2, access: at(1, 2, { matured: TWO_NEAR }) }).some((c) => c.kind === "patron_path"));
  }
});

test("patron path: turn-ins reveal the story, count across NPCs, keeper shows progress", async (t) => {
  const { db, player, view, service, tick, setLevel } = await fixture(t, { level: 2 });
  recordStakerStatus(db, player, { tier: 1, matured: TWO_NEAR }, NOW);
  const npcs = [RADA, BELA, { ...RADA, id: "rada-2" }, { ...BELA, id: "bela-2" }];
  let step = 0;
  for (const npc of npcs) {
    if (step === 1) {
      // Step 2 needs level 4: the offer is a locked chip until then.
      const g = service.greet({ player, actor: npc, world: view(1) });
      assert.ok(!g.menu.some((o) => o.terms.patron));
      assert.deepEqual(g.locked.find((c) => c.kind === "patron_path").locked.missing, ["Reach level 4"]);
      setLevel(4);
    }
    const offer = service.greet({ player, actor: npc, world: view(1) }).menu.find((o) => o.terms.patron);
    if (!offer) continue;
    service.accept({ player, actor: npc, world: view(1), offerId: offer.id });
    const active = service.greet({ player, actor: npc, world: view(1) }).active.find((l) => l.offerId === offer.id);
    assert.deepEqual(active.patron, { pathLine: step + 1, pathOf: PATRON_PATH_LINES });
    tick(1000);
    walk(db, player, offer, NOW + step * 10_000 + 2000);
    tick(10_000);
    const done = service.complete({ player, actor: npc, world: view(1), offerId: offer.id });
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
  const path = patronPathView(db, player, { access: stakerAccess({ tier: 1, level: 1 }) });
  assert.deepEqual(path.next.missing, ["Stake 2 NEAR", "Reach level 4"], "after a withdrawal the next step says what is missing");
  assert.equal(path.done, step);
  assert.equal(path.story.filter((c) => !c.locked).length, step);
  assert.ok(path.story.slice(step).every((c) => c.locked && !c.text));
  const keeper = createKeeperVault(db, { clock: () => NOW });
  const card = keeper.view({ player: "nobody", level: 1, positions: [], patronPath: path });
  assert.equal(card.inner.open, false, "no stake: the inner vault stays locked");
  assert.ok(card.inner.path, "the keeper shows the path");
  assert.equal(card.inner.path.done, step, "progress stays visible after a withdrawal (D29)");
});
