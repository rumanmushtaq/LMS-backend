import * as fs from 'fs';

/**
 * Minimal reader for a phpMyAdmin / mysqldump `.sql` file.
 *
 * The media step runs against the same dump the row migration used, so it
 * needs no MySQL server. Only `INSERT INTO` statements are read; column names
 * come from the INSERT column list, or from `CREATE TABLE` when it has none.
 */
export type Row = Record<string, string | null>;
export type Tables = Record<string, Row[]>;

/** Splits `(a,'b',NULL),(…)` into rows of raw string values. */
function parseTuples(s: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '(') {
      i++;
      continue;
    }
    i++;
    const row: (string | null)[] = [];
    let cur = '';
    let quoted = false;
    let inStr = false;
    while (i < s.length) {
      const c = s[i];
      if (inStr) {
        if (c === '\\') {
          const n = s[i + 1];
          cur += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n === '0' ? '\0' : n;
          i += 2;
          continue;
        }
        if (c === "'") {
          if (s[i + 1] === "'") {
            cur += "'";
            i += 2;
            continue;
          }
          inStr = false;
        } else {
          cur += c;
        }
      } else if (c === "'") {
        inStr = true;
        quoted = true;
      } else if (c === ',' || c === ')') {
        row.push(!quoted && cur === 'NULL' ? null : cur);
        cur = '';
        quoted = false;
        if (c === ')') {
          i++;
          break;
        }
      } else if (c !== ' ' && c !== '\n' && c !== '\r') {
        cur += c;
      }
      i++;
    }
    rows.push(row);
  }
  return rows;
}

export function readDump(file: string): Tables {
  const src = fs.readFileSync(file, 'utf8');

  const createCols: Record<string, string[]> = {};
  for (const m of src.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\)/g)) {
    createCols[m[1]] = [...m[2].matchAll(/^\s*`(\w+)`/gm)].map((x) => x[1]);
  }

  const tables: Tables = {};
  const insert = /INSERT INTO `(\w+)`\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);\r?\n/g;
  for (const m of src.matchAll(insert)) {
    const table = m[1];
    const cols = m[2] ? [...m[2].matchAll(/`(\w+)`/g)].map((x) => x[1]) : createCols[table] ?? [];
    const out = (tables[table] ??= []);
    for (const vals of parseTuples(m[3])) {
      const row: Row = {};
      cols.forEach((c, idx) => (row[c] = vals[idx] ?? null));
      out.push(row);
    }
  }
  return tables;
}
