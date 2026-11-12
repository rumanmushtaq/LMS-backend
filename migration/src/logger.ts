import * as fs from 'fs';
import * as path from 'path';

const ts = () => new Date().toISOString();

export const log = {
  info: (msg: string, ...a: any[]) => console.log(`[${ts()}] ${msg}`, ...a),
  warn: (msg: string, ...a: any[]) => console.warn(`[${ts()}] WARN  ${msg}`, ...a),
  error: (msg: string, ...a: any[]) => console.error(`[${ts()}] ERROR ${msg}`, ...a),
};

/** Appends failed rows to migration/errors/<table>.json instead of crashing. */
export function writeErrors(table: string, rows: any[]): void {
  if (rows.length === 0) return;
  const dir = path.resolve(__dirname, '..', 'errors');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${table}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  log.warn(`Wrote ${rows.length} failed rows → ${file}`);
}
