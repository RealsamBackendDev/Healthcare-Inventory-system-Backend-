# Healthcare Centre Inventory and Requisition Management System

Phase 1 implementation of the healthcare centre inventory and requisition system described in `docs/SRS_v1.2` requirements: drug catalogue, batch-level stock, receiving, stock import, FEFO dispensing, adjustments with approval thresholds, returns, requisitions with automatic shortage drafts, expiry monitoring, reports, dashboards, users, roles, audit history and system settings.

This repository follows the approved folder architecture. The backend is complete; the React frontend is the next build step.

## What is implemented

- Node.js + Express REST API in CommonJS
- PostgreSQL schema with 24 tables, UUID keys, double precision quantities, constraints and indexes
- JWT authentication with bcrypt hashing (bcryptjs, so it installs without a compiler in Termux)
- Administrator and Staff roles with permission-based authorization and organisation scoping on every query
- Drug catalogue with duplicate active code protection and deactivation instead of deletion
- Batch-level inventory with usable, blocked, expired and destroyed quantities
- Stock receiving with transactional batch creation and stock movements
- Administrator stock import for CSV and Excel with preview, validation and all-or-nothing or valid-only commit
- FEFO dispensing with row locking, tolerance-aware decimal arithmetic and overselling prevention
- Stock adjustments with configurable quantity and value approval thresholds
- Physical stock count workflow that creates pending adjustment proposals
- Return requests with approval workflow and disposition handling
- Requisition lifecycle: draft, submit, approve, reject, cancel, close, amend, automatic shortage drafts
- Expiry monitoring with 90, 30 and 7 day windows, expiry boundary enforcement and in-app notifications
- Dashboard, eight operational reports and audit history with CSV, Excel and PDF export
- Audit trail that records actor full name, actor id, server timestamp, action, entity, before and after values
- Jest unit tests and integration tests

## Repository layout

```
healthcare-inventory-system/
├── backend/
│   ├── src/
│   │   ├── config/            database.js, environment.js
│   │   ├── modules/           auth, users, organisations, drugs, inventory, receiving,
│   │   │                      dispensing, adjustments, requisitions, expiry, reports, notifications
│   │   ├── middleware/        authenticate.js, authorize.js, validate.js, errorHandler.js
│   │   ├── database/          connection.js, migrate.js, migrations/, seeds/
│   │   ├── shared/            errors/, constants/, utils/
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/                 unit/, integration/, fixtures/
│   ├── scripts/               backup.sh, restore.sh
│   ├── .env.example
│   └── package.json
├── docs/                      SRS, database design, API documentation, deployment guide, business rules
├── docker-compose.yml
└── README.md
```

Module folders follow the same pattern: `<name>.routes.js`, `<name>.controller.js`, `<name>.service.js`, `<name>.repository.js`, `<name>.validation.js`. Returns live beside adjustments because both alter stock, and system settings live in the users module because only administrators manage them. Both are exposed at their own API paths (`/api/returns`, `/api/settings`).

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer (16 or 17 recommended)
- Termux on Android for the current setup, or Docker Compose on a server

## Quick start in Termux

Install the runtime and database once:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts postgresql git
```

Initialise and start PostgreSQL (the data directory below is the Termux default):

```bash
initdb $PREFIX/var/lib/postgresql
pg_ctl -D $PREFIX/var/lib/postgresql start
createdb healthcare_inventory
```

Termux PostgreSQL trusts local connections and uses your Termux username as the superuser. Check it with `whoami` and use that value for `DB_USER` below; leave `DB_PASSWORD` empty.

Configure and install the backend:

```bash
cd ~/healthcare-inventory-system/backend
cp .env.example .env
nano .env
```

Set at minimum `DB_USER` to your Termux username and `JWT_SECRET` to a long random value. Then:

```bash
npm install
npm run migrate
npm run seed
npm run seed:demo
npm start
```

The API listens on `http://127.0.0.1:4000`. Check it with:

```bash
curl http://127.0.0.1:4000/api/health
```

Default accounts created by the seeds:

- Administrator: `admin@healthcentre.local`, password from `ADMIN_PASSWORD` in `.env` (default `ChangeMe123!`)
- Staff: `staff@healthcentre.local`, password from `STAFF_PASSWORD` in `.env` (default `Staff123!`)

`npm run seed:demo` is optional and loads twelve demo drugs with batches at different expiry stages, a pending requisition, a pending adjustment, a pending return and notifications.

To keep the API running after closing Termux:

```bash
mkdir -p logs
nohup npm start > logs/api.log 2>&1 &
```

After a phone restart, start PostgreSQL again with `pg_ctl -D $PREFIX/var/lib/postgresql start` and restart the API.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the API |
| `npm run dev` | Start with file watching |
| `npm run migrate` | Apply SQL migrations |
| `npm run seed` | Create roles, permissions, centre, settings and the administrator |
| `npm run seed:demo` | Load demo catalogue and workflow records |
| `npm test` | Run unit tests |
| `RUN_INTEGRATION=true npm test` | Run API integration tests against the configured database |
| `bash scripts/backup.sh` | Write a compressed database backup with retention |
| `CONFIRM_RESTORE=yes bash scripts/restore.sh <file>` | Restore a backup |

Integration tests create real records, so point them at a disposable database.

## Docker deployment on a server

```bash
cp backend/.env.example backend/.env
nano backend/.env
docker compose up -d --build
docker compose exec api node src/database/migrate.js
docker compose exec api node src/database/seeds/001_bootstrap.js
```

The API is published on port 4000. Full instructions, including backup and restore verification, are in `docs/deployment-guide.md`.

## Documentation

- `docs/database-design.md` - schema, relationships and data rules
- `docs/api-documentation.md` - endpoints, payloads, permissions and exports
- `docs/business-rules.md` - FEFO, expiry boundary, thresholds, returns and requisition rules
- `docs/deployment-guide.md` - Termux, Docker, backup, restore and recovery

The SRS document supplied with the build brief is the requirements source; copy it into `docs/` if you want it stored beside the code.

## Security notes

- Every endpoint validates input with Zod and uses parameterized SQL only
- Passwords are hashed with bcryptjs
- Deactivated accounts and password resets revoke existing tokens through a token version check
- Failed logins are rate limited per IP and accounts lock temporarily after repeated failures
- Error responses never expose stack traces in production
- Patient-identifying data is never collected

## Assumptions made where the specification left room

- Phase 1 is single-centre, but all records carry an organisation id and users have centre-scoped memberships
- Quantities are stored as `DOUBLE PRECISION` and compared with a `1e-9` tolerance; display rounds quantities to six decimals and money to two
- Staff adjustment thresholds default to 10 units and ₦5,000 per adjustment, configurable in Settings
- Staff adjustments within both thresholds apply immediately; anything above either threshold waits for administrator approval
- Administrators applying their own adjustments bypass approval but every action is audited
- Returns do not change stock when requested; approval applies the chosen disposition
- A stock import is all-or-nothing by default and can be switched to valid-rows-only
- Reports export from the server as CSV, XLSX or PDF so totals match the database exactly
- The frontend is delivered as the next milestone; this repository currently contains the full backend
