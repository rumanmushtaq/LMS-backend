# Migration — old MySQL `varona` → new MongoDB

Scope: **tutors → `users` (role = "tutor")** and **shirts → `products`**. Nothing else.

Source is **read-only** (SELECT only), reached through an **SSH tunnel** (MySQL
port 3306 is not exposed). Credentials come from `migration/.env` — never
hardcoded. The load is **idempotent** (upserts keyed on `legacyId`), so every
step is safe to re-run.

## Setup

```bash
cd varona-academy-backend
npm install            # installs mysql2, tunnel-ssh, mongodb (added as devDeps)
cp migration/.env.example migration/.env
# fill MYSQL_*, SSH_* (key path or password), MONGO_URI (STAGING first), MONGO_DB
```

## Run order

```bash
# 0. Back up BOTH databases first (rollback safety)
bash migration/backup.sh

# 1. Inspect the source (read-only). Writes migration/mapping.md and stops.
npx ts-node migration/inspect.ts
#    → review mapping.md, then set SOURCE.tutors/shirts (table + where) in
#      migration/src/map.ts to the real table names.

# 2. Dry run (transforms + validates, prints sample docs, writes NOTHING)
npx ts-node migration/migrate.ts --only=tutors --dry-run
npx ts-node migration/migrate.ts --only=shirts --dry-run

# 3. Test with ONE record, then verify it landed correctly
npx ts-node migration/migrate.ts --only=tutors --limit=1
npx ts-node migration/verify.ts --only=tutors

# 4. Full run (against STAGING Mongo)
npx ts-node migration/migrate.ts --only=tutors
npx ts-node migration/migrate.ts --only=shirts

# 5. Verify counts + spot-checks
npx ts-node migration/verify.ts
```

Promote to the production MongoDB only after step 5 passes on staging — point
`MONGO_URI`/`MONGO_DB` at prod and repeat steps 2–5.

## Flags (`migrate.ts`)

- `--only=tutors|shirts` — which entity (required)
- `--dry-run` — transform + validate + print samples, write nothing
- `--limit=<n>` — cap source rows (for testing)

## Safety

- **Read-only source:** every source query is guarded; anything that is not a
  SELECT/SHOW/DESCRIBE is refused (`src/source.ts`).
- **Passwords:** migrated hash-for-hash, never re-hashed.
- **Idempotent:** `bulkWrite` upserts on a unique `legacyId` index.
- **Errors:** rows that fail validation go to `migration/errors/<table>.json`,
  the run continues.
- **Backups:** `backup.sh` dumps MySQL (over SSH) and MongoDB before any write.

## Files

| file | purpose |
|---|---|
| `backup.sh` | mysqldump (SSH) + mongodump |
| `inspect.ts` | list tables/columns/counts → `mapping.md` (stops for approval) |
| `migrate.ts` | transform + idempotent upsert load |
| `verify.ts` | count comparison + 5 random spot-checks |
| `src/env.ts` | load/validate `.env` |
| `src/source.ts` | SSH tunnel + read-only MySQL pool |
| `src/target.ts` | MongoDB connection |
| `src/map.ts` | field maps (confirm source table/column names here) |
| `src/logger.ts` | logging + error-file writer |
