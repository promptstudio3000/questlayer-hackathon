# Treasury DAO: players vote, the council approves every run

Status 11 Nov 2026: testnet. Approved by Lubos on 11 Nov 2026 (plan "QuestLayer DAO: plán treasury pro track Social
Money", his answers: automatic daily approval, a weekly mix vote whose recommended option gets the automatic vote,
extra votes listed under it, Explorers at level 3+ who played in the last 7 days, the QGOLD vault council moves to the
DAO once it keeps working and collecting yield).

Hackathon track: **Social Money** (`social`), which asks projects to build on Sputnik DAO and Trezu instead of writing
a new multisig. QuestLayer does exactly that: the treasury decisions run on a stock Sputnik DAO v2 created by the
factory Trezu uses, with Trezu's role names.

Code: `server/native/treasury-dao.mjs` (policy, tallies, views; never signs), `scripts/treasury-dao-testnet.mjs`
(Mac, keys in `.data/`), `src/TreasuryVote.tsx` (Community → Quests card), the "Who decides" section on `/treasury`,
tests `tests/treasury-dao.test.mjs`.

## Accounts and roles

| Role (Trezu name) | Accounts | May | Threshold |
| --- | --- | --- | --- |
| Requestor | `keeper.questlayer-dev-20261101.testnet` | file proposals only: polls, results, the daily run, the Explorer list | votes on nothing |
| Admin | the council | members, roles, settings, upgrades | 2 of 3 |
| Approver | the council | approve or reject decisions and money moves | 2 of 3 |
| Explorers | players who qualify, plus the keeper | approve poll options only (`vote:VoteApprove`) | never finalizes (see Polls) |

The council is `questlayer-dev-20261101.testnet` (Lubos's seat) plus `council-a.` and `council-b.` sub-accounts of the
operator. The two `council-*` keys are the **automatic approvals** Lubos chose: the daily script approves with them,
but only what it checked (below). Lubos's seat can reject, and with one of the automatic keys he can change the
policy, remove the automatic keys or add his own wallet, in Trezu or with any NEAR CLI.

DAO: `questlayer-treasury.sputnik-v2.testnet`. Factory: `sputnik-v2.testnet` (Sputnik DAO v2, the one Trezu's testnet
mode opens). Proposal bond 0 (only the keeper and the council can file), proposal period 8 days.

## Who is an Explorer

A player whose explorer (managed) account is ready, who has **level 3 or more** (QXP ≥ 400, `server/levels.mjs`) and
who **played in the last 7 days** (a non-welcome history event or a collected coin). Demo bots (`seed-*`) never vote.
Votes are 1 explorer = 1 vote: XP is soulbound, so a vote cannot be bought; QGOLD or stake does not weigh in.

`GET /api/treasury/dao/explorers` lists the qualifying accounts. Each morning the keeper compares it with the
Explorers role and, when it changed, files one `ChangePolicyAddOrUpdateRole` proposal with the whole list, which the
automatic council keys approve. So a player who reaches level 3 can vote from the next morning.

## Polls (weekly mix and extra votes)

Every option is one Sputnik `Vote` proposal (a signal, it executes nothing). The Explorers role's vote policy has a
quorum no role can reach, so an option never turns "Approved" and stays open all week; the result is counted, not
executed. The keeper's description ends with a machine line, `questlayer:{json}`, and only the keeper's proposals
count (a look-alike from anyone else is ignored).

- **Weekly mix**, ISO week, Monday 00:00 UTC to Monday 00:00 UTC. Options (all inside the treasury-mix hard limits):
  Balanced 50 / 40 / 10 (**recommended**), More staking 70 / 20 / 10, Bigger reserve 40 / 30 / 30 (liquid staking /
  stablecoins on Rhea / NEAR reserve). When the poll opens the keeper votes for the recommended option: that is the
  visible automatic vote, so with no other votes the recommended option wins.
- **Extra votes** for the same week: `node scripts/treasury-dao-testnet.mjs poll "<question>" "<a>" "<b>"` (2 to 4
  options, the first is recommended and gets the automatic vote). The card and `/treasury` list them under the weekly
  mix vote.
- **Tally**: the first morning run after a poll closes counts the approvals of each option; the most approvals win,
  a tie goes to the recommended option, then to the first option. The keeper files an "Adopt treasury mix" (or
  "Result") proposal carrying the tally and the voter count, and the council approves it. The newest approved adopt
  proposal is the **mix in force**: `scripts/treasury-mix-testnet.mjs` and `GET /api/treasury/mix` use it as the
  target (`policy.governedBy: "dao"`). At setup the council adopts Balanced, so a target exists from day one.

A player votes from **Community → Quests → Treasury vote**. The explorer account signs
`act_proposal({ id, action: "VoteApprove", proposal: "Vote" })` on the DAO; the relayer sponsors exactly that call (no
deposit, no other action, no other kind) and the signing vault signs it without its approval window, because no money
moves. The card allows one vote per poll; the chain itself would accept approving several options (approval voting),
and the tally would count each.

## The daily run (automatic approval)

`node scripts/treasury-dao-testnet.mjs daily` runs in the 06:30 LaunchAgent before the mix rebalance:

1. tally closed polls and file their results (council approves);
2. open this week's mix poll if it is missing, with the automatic vote;
3. sync the Explorers role;
4. plan today's treasury run against the adopted mix and file it as "Daily treasury run <date>". The automatic
   council keys approve it only when the target is the adopted mix and the plan moves no more than the treasury-mix
   move limit (25 % of the treasury, hard ceiling in code); otherwise it is not filed and the log says why.

`scripts/treasury-mix-testnet.mjs rebalance` then runs **only if today's run is Approved in the DAO** and its target is
the adopted mix. Without an approved run it logs `skipped` and moves nothing. The harvest and `keep` steps are
unchanged.

## Custody

On testnet the funds stay where they were (operator wallet and the yield vault, whose treasury account is fixed at
deployment). The DAO decides the target and approves every run, and the scripts refuse to run without it, but it does
not hold the coins yet. Moving custody means a fresh yield vault with the DAO as treasury and every rebalance step as a
DAO `FunctionCall` proposal; it is the next step and needs no change to the governance above.

## QGOLD vault council

Lubos approved moving the QGOLD vault council to the DAO, provided the vault keeps working and collecting yield.
`node scripts/treasury-dao-testnet.mjs qgold-council --execute` proposes `SetCouncil { members: [DAO], threshold: 1 }`
from the current council (the operator); after the vault's timelock a second run executes it. The script refuses while
any other QGOLD proposal is open (the pending upgrade's approvals belong to the current council), so it runs after that
upgrade. The council change touches neither the backing nor the yield: minting, payouts, redemptions and the guardian
pause stay as they are. Afterwards a QGOLD upgrade is a DAO `FunctionCall` proposal (`propose`, `approve`), and
`apply_upgrade` stays callable by anyone with the approved code.

## Trezu

The roles are named the way Trezu reads them (Requestor, Admin, Approver), so the DAO opens in Trezu as an ordinary
treasury. Trezu's hosted backend is mainnet-only; on testnet its UI runs locally (`bun run testnet:mock`, then
`http://localhost:3000/questlayer-treasury.sputnik-v2.testnet/requests`, see the Trezu README), which lists proposals
and votes from RPC. On mainnet the same DAO shape opens on trezu.app.

## Running it (Mac, operator key in `.data/near-operator.json`)

```sh
node scripts/treasury-dao-testnet.mjs setup            # dry run: what would be created
node scripts/treasury-dao-testnet.mjs setup --execute  # keeper + council keys, the DAO (about 6 NEAR storage), manifest, genesis adopt, first daily
node scripts/treasury-dao-testnet.mjs status
node scripts/treasury-dao-testnet.mjs daily --dry-run
bash scripts/install-stnear-harvest-mac.sh             # LaunchAgent: harvest → DAO daily → rebalance → keep
```

`setup` writes `public/native-treasury-dao-testnet.json`; commit it, then deploy, so the server, the relayer and the
signing vault (its fingerprint includes the manifest) know the DAO. Keys: `.data/treasury-dao-keys.json` (chmod 600),
never in git or chat. `TREASURY_DAO_ENABLED=0` hides the DAO on a host.

## API

- `GET /api/treasury/dao[?account=<explorer account>]`: DAO id, council, threshold, keeper, Explorer count, rule, this
  week's mix poll with approvals per option (and `mine` for the account), extra polls, the adopted mix, today's run,
  recent decisions.
- `GET /api/treasury/dao/explorers`: the qualifying accounts for the keeper's daily sync.

## Limits

- Testnet only. Mainnet needs Lubos's explicit go, a real custody move and its own review.
- The Explorer rule is a testnet sybil defence (level and recent play). Mainnet needs stronger proof of personhood.
- The Explorers role lists every voter in the policy: fine for hundreds, for thousands the vote moves to token weight
  or to one DAO per community layer (the long-term plan: each layer gets its own DAO and share of the yield).
- All three council keys sit on one Mac today; adding Lubos's own wallet as the third seat is one Admin proposal.

## Staking first (11 Nov 2026)

The weekly options are now staked NEAR / stablecoins / NEAR reserve:
**Staking first 90 / 10 / 0** (recommended; the stables are 5 % USDC + 5 % USDT),
More stables 70 / 20 / 10 and Bigger reserve 60 / 20 / 20. Polls filed before
the change keep their own targets (`LEGACY_MIX_PRESETS`; a tally uses the
targets stored in the poll first).

Owner decision: `node scripts/treasury-dao-testnet.mjs adopt staking-first --execute`
has the keeper file an adopt proposal and the two council keys approve it. It
lists the open mix poll of the week in `supersedes`, so the Monday tally does
not override it, and then runs `daily`, which re-files today's run because the
one filed earlier has another target. Next Monday opens a fresh vote with the
new options.

The vote itself moved to the **/treasury page, tab Vote** (see TREASURY-PAGE.md).
