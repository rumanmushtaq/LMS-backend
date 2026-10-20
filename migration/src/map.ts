/**
 * Field maps: old MySQL (Laravel `varona`) → new MongoDB documents.
 *
 * Scope: tutors → `users` (role='tutor') and shirts → `products`.
 *
 * Real source schema (confirmed by inspect):
 *   users(id,name,email,password,role enum(admin,tutor,student),email_verified_at,...)
 *   tutor_profiles(user_id, first_name, last_name, ...)
 *   products(id,title,description,price,status enum(active,inactive),...)
 *   product_images(product_id, image)      sizes(product_id, size)
 *
 * Images/sizes live in child tables, so each entity uses a JOIN with
 * GROUP_CONCAT to pull them as one row.
 */

const SEP = '||';

function str(v: any): string {
  return v == null ? '' : String(v).trim();
}
function toNumber(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toDate(v: any): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function splitList(v: any): string[] {
  if (v == null || v === '') return [];
  return String(v).split(SEP).map((x) => x.trim()).filter(Boolean);
}

export interface EntityConfig {
  key: 'tutors' | 'shirts';
  targetCollection: string;
  required: string[];
  /** Full SELECT for the entity (optionally capped). */
  sql(limit?: number): string;
  /** COUNT of source rows this entity migrates. */
  countSql(): string;
  transform(row: Record<string, any>): Record<string, any>;
}

const lim = (n?: number) => (n && n > 0 ? ` LIMIT ${n}` : '');

export const ENTITIES: Record<'tutors' | 'shirts', EntityConfig> = {
  tutors: {
    key: 'tutors',
    targetCollection: 'users',
    required: ['email', 'firstName', 'lastName', 'password'],
    countSql: () => `SELECT COUNT(*) AS c FROM users WHERE role = 'tutor'`,
    sql: (n) => `
      SELECT u.id AS id, u.email, u.name, u.password,
             u.email_verified_at, u.created_at, u.updated_at,
             tp.first_name, tp.last_name
      FROM users u
      LEFT JOIN tutor_profiles tp ON tp.user_id = u.id
      WHERE u.role = 'tutor'${lim(n)}`,
    transform(row) {
      const nameParts = str(row.name).split(/\s+/).filter(Boolean);
      const firstName = str(row.first_name) || nameParts[0] || '';
      const lastName =
        str(row.last_name) || nameParts.slice(1).join(' ') || firstName || '—';
      const created = toDate(row.created_at) ?? new Date();
      return {
        legacyId: row.id,
        email: str(row.email).toLowerCase(),
        firstName,
        lastName,
        // Keep the hash exactly as stored — never re-hash.
        password: str(row.password),
        role: 'tutor',
        status: 'active',
        emailVerified: row.email_verified_at != null,
        isDeleted: false,
        createdAt: created,
        updatedAt: toDate(row.updated_at) ?? created,
      };
    },
  },

  shirts: {
    key: 'shirts',
    targetCollection: 'products',
    required: ['title', 'description'],
    countSql: () => `SELECT COUNT(*) AS c FROM products`,
    sql: (n) => `
      SELECT p.id, p.title, p.description, p.price, p.status,
             p.created_at, p.updated_at,
             (SELECT GROUP_CONCAT(pi.image SEPARATOR '${SEP}')
                FROM product_images pi WHERE pi.product_id = p.id) AS images,
             (SELECT GROUP_CONCAT(s.size SEPARATOR '${SEP}')
                FROM sizes s WHERE s.product_id = p.id) AS sizes
      FROM products p${lim(n)}`,
    transform(row) {
      const created = toDate(row.created_at) ?? new Date();
      return {
        legacyId: row.id,
        title: str(row.title),
        description: str(row.description),
        price: toNumber(row.price),
        images: splitList(row.images),
        sizes: splitList(row.sizes),
        isActive: str(row.status) !== 'inactive',
        createdAt: created,
        updatedAt: toDate(row.updated_at) ?? created,
      };
    },
  },
};
