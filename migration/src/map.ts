/**
 * Field maps: old MySQL row → new MongoDB document.
 *
 * Source table names and the exact column names come from `inspect.ts`
 * (`migration/mapping.md`). The column pickers below accept several common
 * spellings so the transform keeps working whatever the old schema called
 * them; tighten them once the inspection confirms the real names.
 *
 * Only two entities are in scope: tutors → `users` (role = 'tutor') and
 * shirts → `products`.
 */

// ─── CONFIRM AFTER INSPECT ───────────────────────────────────────────────────
// Set these to the real source table names (and the tutor filter) once
// inspect.ts has listed the tables.
export const SOURCE = {
  tutors: {
    table: 'users', // e.g. 'users' or 'tutors'
    // Extra WHERE applied when the tutor rows live in a shared users table.
    // Leave '' if the table only holds tutors.
    where: "role = 'tutor'",
  },
  shirts: {
    table: 'products', // e.g. 'products' or 'shirts'
    where: '',
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────
function pick(row: Record<string, any>, ...names: string[]): any {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null) return row[n];
  }
  return undefined;
}

function toDate(v: any): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'y'].includes(v.toLowerCase());
  return false;
}

function toNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: any): string {
  return v == null ? '' : String(v).trim();
}

/** Splits a flat column into an array: JSON array, or comma-separated. */
function toArray(v: any): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (v == null || v === '') return [];
  const s = String(v).trim();
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(str).filter(Boolean);
    } catch {
      /* fall through to CSV */
    }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export interface EntityConfig {
  key: 'tutors' | 'shirts';
  sourceTable: string;
  sourceWhere: string;
  targetCollection: string;
  /** One source row → one target document (without _id). */
  transform(row: Record<string, any>): Record<string, any>;
  /** Fields a valid target doc must have (non-empty). */
  required: string[];
}

const now = () => new Date();

export const ENTITIES: Record<'tutors' | 'shirts', EntityConfig> = {
  tutors: {
    key: 'tutors',
    sourceTable: SOURCE.tutors.table,
    sourceWhere: SOURCE.tutors.where,
    targetCollection: 'users',
    required: ['email', 'firstName', 'lastName', 'password'],
    transform(row) {
      const created = toDate(pick(row, 'created_at', 'createdAt', 'created')) ?? now();
      return {
        legacyId: pick(row, 'id', 'ID'),
        email: str(pick(row, 'email', 'email_address')).toLowerCase(),
        firstName: str(pick(row, 'first_name', 'firstName', 'fname', 'name')),
        lastName: str(pick(row, 'last_name', 'lastName', 'lname', 'surname')),
        // Keep the hash exactly as stored — never re-hash.
        password: str(pick(row, 'password', 'password_hash', 'passwordHash')),
        role: 'tutor',
        status: str(pick(row, 'status')) || 'active',
        emailVerified: toBool(pick(row, 'email_verified', 'emailVerified', 'is_verified')),
        isDeleted: toBool(pick(row, 'is_deleted', 'isDeleted', 'deleted')),
        createdAt: created,
        updatedAt: toDate(pick(row, 'updated_at', 'updatedAt')) ?? created,
      };
    },
  },
  shirts: {
    key: 'shirts',
    sourceTable: SOURCE.shirts.table,
    sourceWhere: SOURCE.shirts.where,
    targetCollection: 'products',
    required: ['title', 'description'],
    transform(row) {
      const created = toDate(pick(row, 'created_at', 'createdAt', 'created')) ?? now();
      return {
        legacyId: pick(row, 'id', 'ID'),
        title: str(pick(row, 'title', 'name', 'product_name')),
        description: str(pick(row, 'description', 'desc', 'details')),
        price: toNumber(pick(row, 'price', 'amount', 'cost')),
        images: toArray(pick(row, 'images', 'image', 'image_url', 'photos')),
        sizes: toArray(pick(row, 'sizes', 'size', 'available_sizes')),
        isActive: pick(row, 'is_active', 'isActive', 'active', 'status') == null
          ? true
          : toBool(pick(row, 'is_active', 'isActive', 'active', 'status')),
        createdAt: created,
        updatedAt: toDate(pick(row, 'updated_at', 'updatedAt')) ?? created,
      };
    },
  },
};
