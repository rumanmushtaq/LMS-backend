/**
 * Step 4 — copy tutor profile data from the old MySQL dump into
 * `users.kycData`, in the same shape the new onboarding flow writes
 * (tutors/dto/onboarding.dto.ts), so the admin and public pages show it.
 *
 *   npx ts-node migration/profiles.ts --dry-run
 *   npx ts-node migration/profiles.ts --id=206
 *   npx ts-node migration/profiles.ts
 *
 * Flags:
 *   --dump=<file>     old MySQL dump (default ~/Downloads/127_0_0_1.sql)
 *   --dry-run         print the plan, write nothing
 *   --limit=<n>       cap tutors (for testing)
 *   --id=<legacyId>   only this tutor
 *
 * Source per tutor (old users.id = legacyId):
 *   tutor_profiles  → country, city, timezone, lessonTimezone, nativeLanguage,
 *                     spokenLanguages, experience, level, education, bio,
 *                     aboutMe, pricePerHour
 *   tutor_subjects  → category, categories (subject names)
 *   users           → gender, dob
 *
 * Also moves the media step's links onto the fields the app reads:
 *   kycData.avatar                    → kycData.photoUrl
 *   legacy certificates in kycDocuments → kycData.certifications
 *
 * Only empty fields are filled, so anything a tutor already set in the new
 * app is kept. Old availability is not migrated: it holds dated days with no
 * time slots, while the new app stores weekly day + time ranges.
 *
 * Tutors who never finished onboarding on the old site have no
 * tutor_profiles row; there is nothing to copy for them.
 */
import * as os from 'os';
import { openTarget } from './src/target';
import { readDump, Row } from './src/dump';
import { log, writeErrors } from './src/logger';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const home = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());

const LEGACY_CERT = /\/legacy\/tutor-certificates\//;

const str = (v: string | null | undefined) => (v ?? '').trim();
const list = (v: string | null | undefined) =>
  str(v)
    .split(/[,;\/]/)
    .map((x) => x.trim())
    .filter(Boolean);
const isEmpty = (v: any) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Old `experience_range` is "8" or "3-5"; the new app stores "3-5 Years". */
function years(v: string | null): string {
  const s = str(v);
  if (!s) return '';
  return /year/i.test(s) ? s : `${s} Years`;
}

function dateOnly(v: string | null): string {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !s.startsWith('0000') ? s.slice(0, 10) : '';
}

/** Builds the kycData fields the old site has for one tutor. */
function fromLegacy(profile: Row, user: Row | undefined, subjects: string[]): Record<string, any> {
  const bio = str(profile.bio);
  const aboutMe = str(profile.about_me) || bio;
  const price = Number(profile.lesson_price);
  const experience = years(profile.experience_range);
  const out: Record<string, any> = {
    firstName: str(profile.first_name),
    lastName: str(profile.last_name),
    country: str(profile.country),
    city: str(profile.city),
    timezone: str(profile.timezone),
    lessonTimezone: str(profile.lesson_timezone) || str(profile.timezone),
    nativeLanguage: list(profile.native_languages)[0] ?? '',
    spokenLanguages: list(profile.second_languages),
    experience,
    level: experience,
    education: str(profile.education_background),
    bio,
    aboutMe,
    pricePerHour: Number.isFinite(price) && price > 0 ? price : undefined,
    category: subjects[0] ?? '',
    categories: subjects,
    gender: str(user?.gender),
    dob: dateOnly(user?.date_of_birth ?? null),
  };
  for (const k of Object.keys(out)) if (isEmpty(out[k])) delete out[k];
  return out;
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const id = arg('id') ? Number(arg('id')) : undefined;
  const dumpFile = home(arg('dump') ?? '~/Downloads/127_0_0_1.sql');

  log.info(`dump=${dumpFile}${dryRun ? ' (DRY RUN)' : ''}`);
  const t = readDump(dumpFile);
  const userById = new Map((t.users ?? []).map((u) => [str(u.id), u]));
  const profileByUser = new Map((t.tutor_profiles ?? []).map((p) => [str(p.user_id), p]));
  const subjectName = new Map((t.subjects ?? []).map((s) => [str(s.id), str(s.name)]));
  const subjectsByProfile = new Map<string, string[]>();
  for (const ts of t.tutor_subjects ?? []) {
    const name = subjectName.get(str(ts.subject_id));
    if (!name) continue;
    const k = str(ts.tutor_profile_id);
    subjectsByProfile.set(k, [...(subjectsByProfile.get(k) ?? []), name]);
  }

  const tgt = await openTarget();
  try {
    const users = tgt.db.collection('users');
    const docs = await users
      .find({ legacyId: id ?? { $exists: true }, role: 'tutor' })
      .project({ legacyId: 1, kycData: 1, kycDocuments: 1 })
      .sort({ legacyId: 1 })
      .toArray();
    const todo = limit ? docs.slice(0, limit) : docs;
    log.info(`tutors: ${todo.length} of ${docs.length} migrated tutors`);

    let changed = 0;
    const noProfile: number[] = [];
    for (const doc of todo) {
      const legacy = String(doc.legacyId);
      const kyc: Record<string, any> =
        doc.kycData && typeof doc.kycData === 'object' ? doc.kycData : {};
      const profile = profileByUser.get(legacy);
      if (!profile) noProfile.push(doc.legacyId);

      const wanted = profile
        ? fromLegacy(profile, userById.get(legacy), subjectsByProfile.get(str(profile.id)) ?? [])
        : {};
      if (kyc.avatar) wanted.photoUrl = kyc.avatar;

      const kycDocs: string[] = Array.isArray(doc.kycDocuments) ? doc.kycDocuments : [];
      const legacyCerts = kycDocs.filter((u) => LEGACY_CERT.test(u));
      if (legacyCerts.length) {
        const current: string[] = Array.isArray(kyc.certifications) ? kyc.certifications : [];
        wanted.certifications = [...current, ...legacyCerts.filter((u) => !current.includes(u))];
      }

      const set: Record<string, any> = {};
      for (const [k, v] of Object.entries(wanted)) {
        // certifications is merged above; every other field only fills a gap.
        if (k === 'certifications' || isEmpty(kyc[k])) set[k] = v;
      }

      const update: Record<string, any> = {};
      if (Object.keys(set).length) {
        // kycData can be null on migrated tutors; a dotted $set into null fails.
        update.$set =
          doc.kycData && typeof doc.kycData === 'object'
            ? Object.fromEntries(Object.entries(set).map(([k, v]) => [`kycData.${k}`, v]))
            : { kycData: set };
      }
      if (legacyCerts.length) update.$pull = { kycDocuments: { $in: legacyCerts } };
      if (!Object.keys(update).length) continue;

      changed++;
      if (dryRun) {
        if (changed <= 3 || id) console.dir({ legacyId: doc.legacyId, update }, { depth: null });
        continue;
      }
      await users.updateOne({ _id: doc._id }, update);
    }

    writeErrors(
      'profiles-no-legacy-profile',
      noProfile.map((legacyId) => ({ legacyId, reason: 'never finished onboarding on the old site' })),
    );
    log.info(
      `tutors: ${changed} ${dryRun ? 'would change' : 'updated'}, ${noProfile.length} have no old profile`,
    );
  } finally {
    await tgt.close();
  }
}

main().catch((e) => {
  log.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
