/**
 * Step 2 — transform + load. Idempotent.
 *
 *   npx ts-node migration/migrate.ts --only=tutors --dry-run
 *   npx ts-node migration/migrate.ts --only=tutors --limit=1   # one record
 *   npx ts-node migration/migrate.ts --only=shirts
 *
 * Flags:
 *   --only=tutors|shirts   which entity (required)
 *   --dry-run              transform + validate + print samples, write nothing
 *   --limit=<n>            cap source rows (for testing)
 *
 * Upserts keyed on `legacyId` so re-running is safe.
 */
import { openSource } from './src/source';
import { openTarget } from './src/target';
import { ENTITIES, EntityConfig } from './src/map';
import { log, writeErrors } from './src/logger';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const BATCH = 500;

function validate(doc: Record<string, any>, required: string[]): string | null {
  if (doc.legacyId === undefined || doc.legacyId === null) return 'missing legacyId';
  for (const f of required) {
    if (doc[f] === undefined || doc[f] === null || doc[f] === '') return `missing ${f}`;
  }
  return null;
}

async function migrateEntity(cfg: EntityConfig, dryRun: boolean, limit?: number) {
  const src = await openSource();
  const tgt = await openTarget();
  try {
    const col = tgt.db.collection(cfg.targetCollection);
    // Unique index on legacyId makes the upsert key explicit + idempotent.
    if (!dryRun) {
      await col.createIndex({ legacyId: 1 }, { unique: true, sparse: true });
    }

    const where = cfg.sourceWhere ? `WHERE ${cfg.sourceWhere}` : '';
    const lim = limit && limit > 0 ? `LIMIT ${limit}` : '';
    const rows = await src.query<Record<string, any>>(
      `SELECT * FROM \`${cfg.sourceTable}\` ${where} ${lim}`,
    );
    log.info(`${cfg.key}: read ${rows.length} source rows from \`${cfg.sourceTable}\``);

    const docs: Record<string, any>[] = [];
    const bad: any[] = [];
    for (const row of rows) {
      try {
        const doc = cfg.transform(row);
        const err = validate(doc, cfg.required);
        if (err) {
          bad.push({ reason: err, legacyId: doc.legacyId, row });
        } else {
          docs.push(doc);
        }
      } catch (e: any) {
        bad.push({ reason: e?.message || 'transform threw', row });
      }
    }
    writeErrors(cfg.sourceTable, bad);
    log.info(`${cfg.key}: ${docs.length} valid, ${bad.length} invalid`);

    if (dryRun) {
      log.info(`${cfg.key}: DRY RUN — sample documents:`);
      console.dir(docs.slice(0, 3), { depth: null });
      return { valid: docs.length, invalid: bad.length, upserted: 0 };
    }

    let upserted = 0;
    for (let i = 0; i < docs.length; i += BATCH) {
      const slice = docs.slice(i, i + BATCH);
      const ops = slice.map((d) => ({
        updateOne: {
          filter: { legacyId: d.legacyId },
          update: { $set: d },
          upsert: true,
        },
      }));
      const res = await col.bulkWrite(ops, { ordered: false });
      upserted += (res.upsertedCount || 0) + (res.modifiedCount || 0);
      log.info(`${cfg.key}: batch ${i / BATCH + 1} → upserted ${res.upsertedCount}, modified ${res.modifiedCount}`);
    }
    log.info(`${cfg.key}: done — ${upserted} documents written to \`${cfg.targetCollection}\``);
    return { valid: docs.length, invalid: bad.length, upserted };
  } finally {
    await src.close();
    await tgt.close();
  }
}

async function main() {
  const only = arg('only');
  const dryRun = hasFlag('dry-run');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;

  if (only !== 'tutors' && only !== 'shirts') {
    throw new Error('Pass --only=tutors or --only=shirts');
  }

  log.info(`Migrating "${only}"${dryRun ? ' (DRY RUN)' : ''}${limit ? ` limit=${limit}` : ''}`);
  const result = await migrateEntity(ENTITIES[only], dryRun, limit);
  log.info(`Summary: ${JSON.stringify(result)}`);
}

main().catch((e) => {
  log.error(e?.message || e);
  process.exit(1);
});
