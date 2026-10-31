# Creator database backup and restore rehearsal

31 October 2026. Executed locally with disposable databases, using the existing
`deploy/backup-state.py` private SQLite backup tool. No production database,
network, service configuration, signing capability or chain was accessed. No
backup-tool change was required.

`tests/creator-restore.test.mjs` keeps the source database open in WAL mode, invokes
the actual Python backup tool, checks the recorded SHA-256 and private file modes,
then copies the snapshot into a separate temporary state directory. The restored
copy opens through the application's database/runtime factories. It passes SQLite
integrity and foreign-key checks and matches the source schema and every table's
rows exactly, including policy and actor-scoped operation receipts.

The fixture uses an explicitly QA-only, versioned 200-XP commitment and 1000 earned
XP. It contains a public author profile, a separate private profile, a retained
follow, a published quest, and a second quest closing with one unresolved admitted
participant. The participant retains approved revision 1 while the author's newer
private draft is withdrawn. Public discovery does not expose private profile text
or the newer draft; the accepted revision remains available privately.

| Checkpoint | Earned XP | Locked XP | Available XP | Current level |
| --- | ---: | ---: | ---: | ---: |
| Live source and first restored copy | 1000 | 400 | 600 | 3 |
| Independent resolution and one quest finalized | 1000 | 200 | 800 | 3 |
| Second snapshot restored and historical operations retried | 1000 | 200 | 800 | 3 |

Replaying profile/follow/start/close/approval receipts after recovery leaves every
table unchanged. Premature finalization fails and retains both commitments. Only
independent resolution permits the closing quest's exact one-time release. A
second snapshot/restore retains the resolved obligation, closed quest, remaining
published commitment, and original resolve/finalize receipts; retrying them changes
no rows. The original live copy is unchanged by recovery work. Earned XP, starter
inventory, history, treasury and native-award tables remain unchanged throughout;
the participant earns no reward.

`tests.txt` records **6/6 passing**: this creator lifecycle rehearsal plus the five
existing private backup/media/key/retention tests. Temporary databases and snapshots
are deleted after the test. Reproduce with:

```sh
node --test tests/creator-restore.test.mjs tests/state-backup.test.mjs
```

This proves the bounded local SQLite creator-state recovery path. It does not
complete W00/W13 full-host or offsite recovery, native-chain reconciliation,
production migration/concurrency, real key recovery, operational staffing or the
city pilot. No milestone exit gate is marked complete by this rehearsal.
