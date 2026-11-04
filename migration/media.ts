/**
 * Step 3 — move old media files to ImageKit and link them in MongoDB.
 *
 *   npx ts-node migration/media.ts --dry-run
 *   npx ts-node migration/media.ts --only=tutors --limit=1
 *   npx ts-node migration/media.ts
 *
 * Flags:
 *   --dump=<file>          old MySQL dump (default ~/Downloads/127_0_0_1.sql)
 *   --media=<dir>          copy of the old Laravel `public/` folder
 *                          (default ~/varona-old-media/public)
 *   --only=tutors|products which entity (default: both)
 *   --dry-run              resolve files + print the plan, upload/write nothing
 *   --limit=<n>            cap records per entity (for testing)
 *   --id=<legacyId>        only this record (test one tutor/product)
 *
 * What moves where (records matched on `legacyId`):
 *   tutor_profiles.photo_path / users.avatar → users.kycData.photoUrl (+ avatar)
 *   tutor_profiles.video_path                → users.kycData.introVideoUrl
 *   tutor_certificates + tutor_profiles.certifications → users.kycData.certifications
 *   product_images.image                     → products.images
 *
 * Idempotent: every uploaded file is recorded in migration/media-map.json
 * (old path → ImageKit url) and never uploaded twice. A tutor's avatar or
 * video is only set when the field is still empty, so nothing a tutor changed
 * in the new app is overwritten.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import ImageKit, { toFile } from '@imagekit/nodejs';
import { openTarget } from './src/target';
import { readDump, Row } from './src/dump';
import { log, writeErrors } from './src/logger';

// ImageKit keys live in the backend's own .env, next to the app that uses them.
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const home = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());

const MAP_FILE = path.resolve(__dirname, 'media-map.json');
const FOLDERS = {
  avatar: 'legacy/tutor-photos',
  video: 'legacy/tutor-videos',
  certificate: 'legacy/tutor-certificates',
  product: 'legacy/products',
} as const;
type Kind = keyof typeof FOLDERS;

interface Uploaded {
  url: string;
  fileId: string;
}

const isUrl = (v: string) => /^https?:\/\//i.test(v);

class Media {
  private map: Record<string, Uploaded> = fs.existsSync(MAP_FILE)
    ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))
    : {};
  readonly missing: { kind: Kind; legacyId: number; path: string }[] = [];
  readonly failed: { kind: Kind; legacyId: number; path: string; error: string }[] = [];
  uploads = 0;
  private imagekit?: ImageKit;

  constructor(
    private root: string,
    private dryRun: boolean,
  ) {
    if (!dryRun) {
      const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
      if (!privateKey || !process.env.IMAGEKIT_PUBLIC_KEY) {
        throw new Error('Missing IMAGEKIT_PRIVATE_KEY / IMAGEKIT_PUBLIC_KEY in backend .env');
      }
      // Large tutor videos (60 MB+) outlast the SDK's default request timeout.
      this.imagekit = new ImageKit({ privateKey, timeout: 15 * 60 * 1000 });
    }
  }

  /** Finds the file under the media root; old paths may be URL-encoded or start with '/'. */
  locate(oldPath: string): string | null {
    const rel = oldPath.replace(/^\/+/, '');
    const candidates = [rel];
    try {
      candidates.push(decodeURIComponent(rel));
    } catch {
      /* not encoded */
    }
    for (const c of candidates) {
      const full = path.join(this.root, c);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  }

  /** Returns the ImageKit url for an old path, uploading it once. null = file not found. */
  async url(kind: Kind, legacyId: number, oldPath: string): Promise<string | null> {
    if (isUrl(oldPath)) return oldPath;
    const cached = this.map[oldPath];
    if (cached) return cached.url;

    const file = this.locate(oldPath);
    if (!file) {
      this.missing.push({ kind, legacyId, path: oldPath });
      return null;
    }
    if (this.dryRun) return `(upload) ${FOLDERS[kind]}/${path.basename(file)}`;

    let res;
    try {
      res = await this.imagekit!.files.upload({
        file: await toFile(fs.readFileSync(file), path.basename(file)),
        fileName: path.basename(file),
        folder: FOLDERS[kind],
        publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
      });
    } catch (e: any) {
      // e.g. over the plan's file-size limit — record it, keep going.
      this.failed.push({ kind, legacyId, path: oldPath, error: e?.message || String(e) });
      log.warn(`upload failed ${oldPath}: ${e?.message || e}`);
      return null;
    }
    this.map[oldPath] = { url: res.url!, fileId: res.fileId! };
    // Save after every upload so a crash never loses track of a paid upload.
    fs.writeFileSync(MAP_FILE, JSON.stringify(this.map, null, 2));
    this.uploads++;
    log.info(`uploaded ${oldPath} → ${res.url}`);
    return res.url!;
  }
}

const str = (v: string | null | undefined) => (v ?? '').trim();
const groupBy = (rows: Row[], key: string) => {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = str(r[key]);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(r);
  }
  return out;
};

/**
 * The old site kept certificates in two places: tutor_certificates rows and
 * the tutor_profiles.certifications column (one path, or a JSON array of
 * paths). Merges both, deduped on the normalised path.
 */
// The seeded demo tutors all point at this file; it is an unrelated developer
// write-up, not a certificate, so it is never shown as one.
const PLACEHOLDER_CERT = 'frontend/crt.pdf';

function certificatePaths(rows: string[], column: string | null): string[] {
  const fromColumn: string[] = [];
  const raw = str(column);
  if (raw) {
    try {
      const parsed = raw.startsWith('[') ? JSON.parse(raw) : [raw];
      if (Array.isArray(parsed)) fromColumn.push(...parsed.map(String));
    } catch {
      fromColumn.push(raw);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...rows, ...fromColumn].map((x) => str(x)).filter(Boolean)) {
    const key = p.replace(/^\/+/, '');
    if (key === PLACEHOLDER_CERT || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function migrateTutors(
  tables: ReturnType<typeof readDump>,
  media: Media,
  dryRun: boolean,
  limit?: number,
  id?: number,
) {
  const tgt = await openTarget();
  try {
    const users = tgt.db.collection('users');
    const userById = new Map((tables.users ?? []).map((u) => [str(u.id), u]));
    const profileByUser = new Map((tables.tutor_profiles ?? []).map((p) => [str(p.user_id), p]));
    const certsByProfile = groupBy(tables.tutor_certificates ?? [], 'tutor_profile_id');

    const docs = await users
      .find({ legacyId: id ?? { $exists: true }, role: 'tutor' })
      .project({ legacyId: 1, kycData: 1 })
      .sort({ legacyId: 1 })
      .toArray();
    const todo = limit ? docs.slice(0, limit) : docs;
    log.info(`tutors: ${todo.length} of ${docs.length} migrated tutors`);

    let changed = 0;
    for (const doc of todo) {
      const id = String(doc.legacyId);
      const profile = profileByUser.get(id);
      const photo = str(profile?.photo_path) || str(userById.get(id)?.avatar);
      const video = str(profile?.video_path);
      const certs = certificatePaths(
        (certsByProfile.get(str(profile?.id)) ?? []).map((c) => str(c.certificate_path)),
        profile?.certifications ?? null,
      );

      const kyc = doc.kycData && typeof doc.kycData === 'object' ? doc.kycData : null;
      const set: Record<string, any> = {};
      // The admin and onboarding read photoUrl; the dashboard also reads avatar.
      if (photo && !kyc?.photoUrl) {
        const url = await media.url('avatar', doc.legacyId, photo);
        if (url) {
          set.photoUrl = url;
          if (!kyc?.avatar) set.avatar = url;
        }
      }
      if (video && !kyc?.introVideoUrl) {
        const url = await media.url('video', doc.legacyId, video);
        if (url) set.introVideoUrl = url;
      }
      const certUrls: string[] = [];
      for (const c of certs) {
        const url = await media.url('certificate', doc.legacyId, c);
        if (url) certUrls.push(url);
      }
      const existingCerts: string[] = Array.isArray(kyc?.certifications) ? kyc.certifications : [];
      const newCerts = certUrls.filter((u) => !existingCerts.includes(u));
      if (newCerts.length) set.certifications = [...existingCerts, ...newCerts];

      if (!Object.keys(set).length) continue;
      changed++;

      // kycData can be null on migrated tutors; a dotted $set into null fails.
      const update = {
        $set: kyc
          ? Object.fromEntries(Object.entries(set).map(([k, v]) => [`kycData.${k}`, v]))
          : { kycData: set },
      };

      if (dryRun) {
        if (changed <= 3) console.dir({ legacyId: doc.legacyId, update }, { depth: null });
        continue;
      }
      await users.updateOne({ _id: doc._id }, update);
    }
    log.info(`tutors: ${changed} ${dryRun ? 'would change' : 'updated'}`);
  } finally {
    await tgt.close();
  }
}

async function migrateProducts(media: Media, dryRun: boolean, limit?: number, id?: number) {
  const tgt = await openTarget();
  try {
    const products = tgt.db.collection('products');
    const docs = await products
      .find({ legacyId: id ?? { $exists: true } })
      .project({ legacyId: 1, images: 1 })
      .sort({ legacyId: 1 })
      .toArray();
    const todo = limit ? docs.slice(0, limit) : docs;
    log.info(`products: ${todo.length} of ${docs.length} migrated products`);

    let changed = 0;
    for (const doc of todo) {
      const images: string[] = Array.isArray(doc.images) ? doc.images : [];
      if (images.every(isUrl)) continue;
      // Keep a legacy path in place when its file is missing, so nothing is lost.
      const next: string[] = [];
      for (const img of images) next.push((await media.url('product', doc.legacyId, img)) ?? img);
      if (next.every((v, i) => v === images[i])) continue;
      changed++;
      if (dryRun) {
        if (changed <= 3) console.dir({ legacyId: doc.legacyId, images: next }, { depth: null });
        continue;
      }
      await products.updateOne({ _id: doc._id }, { $set: { images: next } });
    }
    log.info(`products: ${changed} ${dryRun ? 'would change' : 'updated'}`);
  } finally {
    await tgt.close();
  }
}

async function main() {
  const only = arg('only');
  const dryRun = hasFlag('dry-run');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const id = arg('id') ? Number(arg('id')) : undefined;
  const dumpFile = home(arg('dump') ?? '~/Downloads/127_0_0_1.sql');
  const root = home(arg('media') ?? '~/varona-old-media/public');

  if (only && only !== 'tutors' && only !== 'products') {
    throw new Error('Pass --only=tutors or --only=products (or nothing for both)');
  }
  if (!fs.existsSync(root)) throw new Error(`Media folder not found: ${root}`);

  log.info(`dump=${dumpFile} media=${root}${dryRun ? ' (DRY RUN)' : ''}`);
  const media = new Media(root, dryRun);

  if (!only || only === 'tutors') await migrateTutors(readDump(dumpFile), media, dryRun, limit, id);
  if (!only || only === 'products') await migrateProducts(media, dryRun, limit, id);

  writeErrors('media-missing', media.missing);
  writeErrors('media-failed', media.failed);
  log.info(
    `done — ${media.uploads} uploaded, ${media.missing.length} files missing, ${media.failed.length} uploads failed`,
  );
}

main().catch((e) => {
  log.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
