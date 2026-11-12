# Deployment Guide

Two supported targets: Termux on Android (current development environment) and Docker Compose on a local or on-premises server.

## 1. Termux on Android

### One-time setup

```bash
pkg update && pkg upgrade
pkg install nodejs-lts postgresql git
```

Initialise the database cluster:

```bash
initdb $PREFIX/var/lib/postgresql
pg_ctl -D $PREFIX/var/lib/postgresql start
createdb healthcare_inventory
```

Termux uses your device username as the PostgreSQL superuser. Run `whoami` and use that value as `DB_USER`. Local connections are trusted, so `DB_PASSWORD` can stay empty.

### Backend setup

```bash
cd ~/healthcare-inventory-system/backend
cp .env.example .env
nano .env
```

Required edits:

- `DB_USER` set to your Termux username
- `JWT_SECRET` set to a long random string
- `ADMIN_PASSWORD` changed from the default
- `CORS_ORIGINS` includes the address the frontend will run on, for example `http://localhost:5173`

Install, migrate and seed:

```bash
npm install
npm run migrate
npm run seed
npm run seed:demo
```

Start the API:

```bash
npm start
```

Verify from another Termux session or the same one:

```bash
curl http://127.0.0.1:4000/api/health
```

### Running in the background

```bash
mkdir -p logs
nohup npm start > logs/api.log 2>&1 &
tail -f logs/api.log
```

### After restarting the phone

```bash
pg_ctl -D $PREFIX/var/lib/postgresql start
cd ~/healthcare-inventory-system/backend
nohup npm start > logs/api.log 2>&1 &
```

The API binds to `0.0.0.0` on port 4000, so other devices on the same network can reach it at `http://<phone-ip>:4000` once Android hotspot or LAN routing allows it. Keep the power supply connected for long sessions.

### Termux notes

- bcryptjs is used instead of native bcrypt so no compiler toolchain is needed.
- If `npm install` is slow, run it while charging and avoid killing the session.
- If PostgreSQL refuses to start, check that `$PREFIX/var/lib/postgresql/postmaster.pid` is not left over from a crash, then start again.
- Use `npm run dev` only while developing; use `npm start` for daily operation.

## 2. Docker Compose on a server

```bash
cp backend/.env.example backend/.env
nano backend/.env
docker compose up -d --build
```

Set `JWT_SECRET`, `ADMIN_PASSWORD` and a strong `DB_PASSWORD` before the first start. The compose file passes `DB_HOST=db` to the API container.

Apply migrations and seed once:

```bash
docker compose exec api node src/database/migrate.js
docker compose exec api node src/database/seeds/001_bootstrap.js
docker compose exec api node src/database/seeds/002_demo.js
```

Check status:

```bash
docker compose ps
curl http://127.0.0.1:4000/api/health
docker compose logs -f api
```

The database volume is `db_data`. The API mounts `./backups` so backup files can be written to the host.

Put a reverse proxy with HTTPS in front of the API before exposing it beyond a trusted network.

## 3. Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Runtime mode | `development` |
| `PORT` | API port | `4000` |
| `DATABASE_URL` | Optional connection string overriding host settings | empty |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL connection | `127.0.0.1`, `5432`, `postgres`, empty, `healthcare_inventory` |
| `DB_SSL` | Enable TLS to PostgreSQL | `false` |
| `JWT_SECRET` | Token signing secret, minimum 16 characters | required |
| `JWT_EXPIRES_IN` | Token lifetime | `8h` |
| `BCRYPT_ROUNDS` | Password hashing cost | `10` |
| `MAX_LOGIN_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | Account lockout policy | `5`, `15` |
| `STAFF_ADJUSTMENT_QUANTITY_THRESHOLD` | Initial staff quantity limit | `10` |
| `STAFF_ADJUSTMENT_VALUE_THRESHOLD` | Initial staff value limit | `5000` |
| `NEAR_EXPIRY_DAYS` | Initial near-expiry window | `90` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME` | Bootstrap administrator | `admin@healthcentre.local`, `ChangeMe123!`, `System Administrator` |
| `STAFF_EMAIL`, `STAFF_PASSWORD` | Demo staff account | `staff@healthcentre.local`, `Staff123!` |
| `CENTRE_NAME`, `CENTRE_CODE` | Bootstrap centre | `Primary Healthcare Centre`, `PHC-001` |
| `STATE_NAME`, `STATE_CODE` | Bootstrap state | `Lagos`, `LA` |
| `LOCAL_GOVERNMENT_NAME`, `LOCAL_GOVERNMENT_CODE` | Bootstrap local government | `Ikeja`, `IKEJA` |
| `CORS_ORIGINS` | Allowed browser origins, comma separated | `http://localhost:5173,http://127.0.0.1:5173` |
| `EXPIRY_JOB_ENABLED`, `EXPIRY_JOB_INTERVAL_HOURS` | Background expiry refresh | `true`, `24` |

Change the seeded administrator password immediately after the first login.

## 4. Backup

Backups use `pg_dump` in custom format.

```bash
cd backend
bash scripts/backup.sh
```

The script reads `backend/.env`, writes `backend/backups/<database>-<timestamp>.dump`, refuses to keep an empty file, and deletes backups older than `BACKUP_RETENTION_DAYS` (default 30).

Schedule it with cron on a server, for example nightly at 22:00:

```
0 22 * * * cd /opt/healthcare-inventory-system/backend && bash scripts/backup.sh >> logs/backup.log 2>&1
```

In Termux, run the script manually before major changes, or use Termux job scheduling with `termux-job-scheduler`.

Rules:

- Keep backups on a different physical device or storage from the server where possible.
- Restrict access to the backup directory (`chmod 700`), which the script applies.
- A backup is unverified until a restore test succeeds.

## 5. Restore and restore test

Restore into the target database:

```bash
cd backend
CONFIRM_RESTORE=yes bash scripts/restore.sh backups/healthcare_inventory-20261112-220000.dump
```

The script refuses to run without `CONFIRM_RESTORE=yes`, restores with clean and if-exists, and leaves ownership to the local role.

Restore test procedure:

1. Create a separate test database: `createdb healthcare_inventory_restore_test`.
2. Point a copy of the environment at it with `DB_NAME=healthcare_inventory_restore_test` or `DATABASE_URL`.
3. Restore the latest backup into that database.
4. Start the API against it and confirm `/api/health` returns 200.
5. Log in as the administrator, open Inventory and Reports, and compare usable totals against the production dashboard.
6. Record the date, backup file and result in the operations log.

Perform a restore test at least monthly and after any database upgrade.

## 6. Recovery during downtime

1. Keep the API running with the existing database if only PostgreSQL needs a restart.
2. If the database host fails, restore the latest verified backup on the standby server, update connection settings, and start the API.
3. Announce a read-only period: staff record receipts on paper during the outage and enter them once service resumes.
4. Reconcile quantities with a physical stock count and post adjustments through the normal approval workflow; never edit movements directly.

## 7. Health checks and logging

- `GET /api/health` returns 200 with `database: connected`, or 503 when the database is unreachable.
- API logs go to stdout, so use `nohup` redirection in Termux or `docker compose logs` on a server.
- The expiry refresh job logs one line per run and also runs at startup.
- Failed logins, rejected approvals and all stock actions are recorded in the audit trail, visible to administrators.

## 8. Upgrading

1. Take a backup.
2. Pull the new code.
3. Run `npm install` (or rebuild the Docker image).
4. Run `npm run migrate`.
5. Restart the API and verify `/api/health`.
6. Keep the previous backup until the new version has been verified.

## 9. Known limitations in Phase 1

- Single healthcare centre in practice, with organisation-scoped data ready for expansion
- No SMS or email notifications; in-app only
- No vendor portals, purchase orders, central store transfers or local government approvals
- No patient records, prescriptions or billing
- Expiry boundaries use the server's date, so the server clock must be correct
- The React frontend is delivered as the next milestone; only the API exists at this point
