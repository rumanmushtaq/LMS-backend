/**
 * The unique index on `stripePaymentIntentId` was created non-sparse, back when
 * every purchase carried a fabricated `pi_mock_…` id. Real sales have no intent
 * id at all, so with the old index the SECOND real purchase ever created fails
 * with a duplicate-key error on null.
 *
 * Mongoose will not alter an existing index, so it has to be dropped and
 * recreated once. Safe to run more than once.
 *
 *   node scripts/fix-material-purchase-index.mjs          # report only
 *   node scripts/fix-material-purchase-index.mjs --apply  # rebuild it
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const apply = process.argv.includes('--apply');
const NAME = 'stripePaymentIntentId_1';

function mongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('MONGODB_URI='));
  if (!line) throw new Error('MONGODB_URI not found in env or .env');
  return line.slice('MONGODB_URI='.length).trim();
}

const client = await new MongoClient(mongoUri()).connect();
try {
  const col = client.db(process.env.MONGODB_DB || 'test').collection('materialpurchases');
  const existing = (await col.indexes()).find((i) => i.name === NAME);

  if (!existing) {
    console.log(`${NAME} does not exist — nothing to do.`);
  } else if (existing.sparse) {
    console.log(`${NAME} is already sparse — nothing to do.`);
  } else {
    console.log(`${NAME} is unique but NOT sparse.`);
    console.log('Rows whose field is null/absent would collide on insert.');
    if (!apply) {
      console.log('\nDry run. Re-run with --apply to drop and recreate it.');
    } else {
      await col.dropIndex(NAME);
      await col.createIndex(
        { stripePaymentIntentId: 1 },
        { unique: true, sparse: true, name: NAME },
      );
      console.log('\nrebuilt as { unique: true, sparse: true }');
    }
  }
} finally {
  await client.close();
}
