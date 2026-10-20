/**
 * Step 3 — verify. Read-only on both sides.
 *
 *   npx ts-node migration/verify.ts --only=tutors
 *   npx ts-node migration/verify.ts            # both
 *
 * Per entity: source row count vs migrated document count, plus 5 random
 * spot-checks (source row ↔ Mongo doc by legacyId).
 */
import { openSource } from './src/source';
import { openTarget } from './src/target';
import { ENTITIES, EntityConfig } from './src/map';
import { log } from './src/logger';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}

async function verifyEntity(cfg: EntityConfig) {
  const src = await openSource();
  const tgt = await openTarget();
  try {
    const col = tgt.db.collection(cfg.targetCollection);

    const [{ c: srcCount }] = await src.query<{ c: number }>(cfg.countSql());
    const tgtCount = await col.countDocuments({ legacyId: { $exists: true } });

    log.info(
      `${cfg.key}: source=${srcCount}  migrated(legacyId)=${tgtCount}  ${srcCount === tgtCount ? 'MATCH' : 'MISMATCH'}`,
    );

    // 5 spot-checks.
    const samples = await src.query<Record<string, any>>(cfg.sql(5));
    let ok = 0;
    for (const row of samples) {
      const expected = cfg.transform(row);
      const got = await col.findOne({ legacyId: expected.legacyId });
      if (!got) {
        log.warn(`${cfg.key}: legacyId ${expected.legacyId} MISSING in Mongo`);
        continue;
      }
      const field = cfg.required[cfg.required.length - 1];
      const matches = String(got[field]) === String(expected[field]);
      log.info(
        `${cfg.key}: legacyId ${expected.legacyId} → ${matches ? 'ok' : 'DIFF'} (${field}: ${got[field]})`,
      );
      if (matches) ok++;
    }
    log.info(`${cfg.key}: ${ok}/${samples.length} spot-checks matched`);
    return { entity: cfg.key, srcCount, tgtCount, match: srcCount === tgtCount, spotOk: ok };
  } finally {
    await src.close();
    await tgt.close();
  }
}

async function main() {
  const only = arg('only');
  const keys = only
    ? [only as 'tutors' | 'shirts']
    : (['tutors', 'shirts'] as const);
  const results = [];
  for (const k of keys) results.push(await verifyEntity(ENTITIES[k]));
  log.info(`\n=== VERIFY SUMMARY ===`);
  for (const r of results) log.info(JSON.stringify(r));
}

main().catch((e) => {
  log.error(e?.message || e);
  process.exit(1);
});
