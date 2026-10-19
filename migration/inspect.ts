/**
 * Step 1 — inspect the source. Read-only.
 *
 * Lists every table with its columns and row count, guesses which tables hold
 * tutors and shirts, and writes `migration/mapping.md`. Writes nothing to
 * either database. Review the mapping and confirm the source table/column
 * names in `src/map.ts` before running `migrate.ts`.
 *
 *   npx ts-node migration/inspect.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { openSource } from './src/source';
import { env } from './src/env';
import { log } from './src/logger';

interface Column {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: any;
}

async function main() {
  const src = await openSource();
  try {
    const tables = (await src.query<Record<string, string>>('SHOW TABLES')).map(
      (r) => Object.values(r)[0],
    );
    log.info(`Found ${tables.length} tables in \`${env.mysql.db}\``);

    const lines: string[] = [];
    lines.push(`# Migration mapping — source \`${env.mysql.db}\``);
    lines.push('');
    lines.push(`Generated ${new Date().toISOString()}. Read-only inspection.`);
    lines.push('');
    lines.push('## Tables');
    lines.push('');

    const summary: { table: string; columns: Column[]; count: number }[] = [];

    for (const table of tables) {
      const columns = await src.query<Column>(`DESCRIBE \`${table}\``);
      const [{ c }] = await src.query<{ c: number }>(
        `SELECT COUNT(*) AS c FROM \`${table}\``,
      );
      summary.push({ table, columns, count: c });

      lines.push(`### \`${table}\` — ${c} rows`);
      lines.push('');
      lines.push('| column | type | null | key |');
      lines.push('|---|---|---|---|');
      for (const col of columns) {
        lines.push(`| ${col.Field} | ${col.Type} | ${col.Null} | ${col.Key} |`);
      }
      lines.push('');
    }

    // Heuristic candidates.
    const has = (cols: Column[], ...names: string[]) =>
      names.some((n) => cols.some((c) => c.Field.toLowerCase() === n));
    const tutorCandidates = summary.filter(
      (t) => has(t.columns, 'email') && has(t.columns, 'password', 'password_hash'),
    );
    const shirtCandidates = summary.filter(
      (t) => has(t.columns, 'price', 'amount') && has(t.columns, 'title', 'name'),
    );

    lines.push('## Proposed mapping (confirm in `src/map.ts`)');
    lines.push('');
    lines.push('### Tutors → `users` (role = "tutor")');
    lines.push(
      `Candidate source tables: ${tutorCandidates.map((t) => `\`${t.table}\``).join(', ') || '(none auto-detected)'}`,
    );
    lines.push('');
    lines.push('| target field | source column (expected) |');
    lines.push('|---|---|');
    lines.push('| legacyId | id |');
    lines.push('| email | email |');
    lines.push('| firstName | first_name |');
    lines.push('| lastName | last_name |');
    lines.push('| password (keep hash) | password / password_hash |');
    lines.push('| role | = "tutor" (constant) |');
    lines.push('| status | status |');
    lines.push('| createdAt / updatedAt | created_at / updated_at |');
    lines.push('');
    lines.push('### Shirts → `products`');
    lines.push(
      `Candidate source tables: ${shirtCandidates.map((t) => `\`${t.table}\``).join(', ') || '(none auto-detected)'}`,
    );
    lines.push('');
    lines.push('| target field | source column (expected) |');
    lines.push('|---|---|');
    lines.push('| legacyId | id |');
    lines.push('| title | title / name |');
    lines.push('| description | description |');
    lines.push('| price | price |');
    lines.push('| images[] | images (JSON/CSV) |');
    lines.push('| sizes[] | sizes (JSON/CSV) |');
    lines.push('| isActive | is_active / status |');
    lines.push('');

    const out = path.resolve(__dirname, 'mapping.md');
    fs.writeFileSync(out, lines.join('\n'));
    log.info(`Wrote mapping → ${out}`);
    log.info(
      `Tutor candidates: ${tutorCandidates.map((t) => t.table).join(', ') || 'none'} | ` +
        `Shirt candidates: ${shirtCandidates.map((t) => t.table).join(', ') || 'none'}`,
    );
    log.info('Review mapping.md, set SOURCE.* in src/map.ts, then run migrate.ts.');
  } finally {
    await src.close();
  }
}

main().catch((e) => {
  log.error(e?.message || e);
  process.exit(1);
});
