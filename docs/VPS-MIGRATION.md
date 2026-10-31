# VPS migration from the former installation

The public host still runs the original installation under its former technical name
(`auratrail.service`, `/opt/ps3000/apps/auratrail`, `/var/lib/auratrail/auratrail.sqlite`, loopback 7091,
domain `questlayer.promptstudio3000.com`). `scripts/deploy-vps.sh` refuses such a host on purpose.
Run `scripts/migrate-vps-legacy.sh` once, from a machine with SSH access, then deploy normally.

## What the migration does

1. Stops the old unit and the old backup timer, disables them.
2. Takes a consistent SQLite backup (`sqlite3 .backup`) of the old database into `/opt/ps3000/apps/questlayer-hackathon/backups/migration-<stamp>/`.
3. Creates `/var/lib/questlayer-hackathon` (mode 0700, same owner) and moves the database, WAL/SHM, signer files
   (`award-attestor.pem`, `reward-attestor.pem`, `reward-worker.json`) and note media directory into it, renaming the
   database to `questlayer-hackathon.sqlite`.
4. Moves `/opt/ps3000/apps/auratrail/{releases,current,assets,state-backups,runtime.env}` to
   `/opt/ps3000/apps/questlayer-hackathon/`, rewriting `DATABASE_PATH`/`STATIC_ASSET_DIR` in `runtime.env`.
5. Installs `deploy/questlayer-hackathon.service` and the backup units, reloads systemd, starts the new unit,
   checks `http://127.0.0.1:7091/api/health` and the public health URL.
6. Removes `/etc/systemd/system/auratrail.service` and the empty old directories only after the health check passes.

Rollback: the script keeps the old unit file and the backup directory; `--rollback <stamp>` restores paths and unit.

## Before running

- Announce a short downtime; sessions survive (same cookie secret, both cookie names are read).
- Confirm `ls /var/lib/auratrail` shows exactly one `*.sqlite`.
- Have the private `runtime.env` in place; the script does not create secrets.

## After running

- `systemctl status questlayer-hackathon questlayer-state-backup.timer`
- `curl -s https://questlayer.promptstudio3000.com/api/health | jq .schema`
- Then `scripts/deploy-vps.sh` for the new release, and remove the legacy code bridges in a follow-up change
  (`server/state-path.mjs` legacy filename, the old cookie name in `server/index.mjs`, `deploy/backup-state.py`).
