/**
 * The unique index on `shoporders.stripePaymentIntentId` was created without a
 * partial filter, back when every order carried a Stripe intent id directly.
 * Orders now reference the payment ledger through `paymentId` and leave
 * `stripePaymentIntentId` null, so with the old index the SECOND order ever
 * created fails with a duplicate-key error on null:
 *
 *   E11000 duplicate key error collection: shoporders
 *   index: stripePaymentIntentId_1 dup key: { stripePaymentIntentId: null }
 *
 * The schema already declares the correct partial index, but Mongoose will not
 * alter an index that already exists — it only creates missing ones. So the old
 * one has to be dropped and recreated once, per environment. Safe to re-run.
 *
 * This is the same fault, and the same fix, as scripts/fix-material-purchase-index.mjs.
 *
 *   node scripts/fix-shop-order-index.mjs          # report only
 *   node scripts/fix-shop-order-index.mjs --apply  # rebuild it
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const apply = process.argv.includes('--apply');
const NAME = 'stripePaymentIntentId_1';
const COLLECTION = 'shoporders';

function mongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('MONGODB_URI='));
  if (!line) throw new Error('MONGODB_URI not found in env or .env');
  return line.slice('MONGODB_URI='.length).trim();
}

const client = await new MongoClient(mongoUri()).connect();
try {
  const col = client
    .db(process.env.MONGODB_DB || 'test')
    .collection(COLLECTION);
  const existing = (await col.indexes()).find((i) => i.name === NAME);

  if (!existing) {
    console.log(`${NAME} does not exist — nothing to do.`);
  } else if (existing.partialFilterExpression || existing.sparse) {
    console.log(`${NAME} already skips nulls — nothing to do.`);
  } else {
    const nulls = await col.countDocuments({
      stripePaymentIntentId: { $in: [null, undefined] },
    });
    console.log(`${NAME} is unique but indexes nulls.`);
    console.log(
      `${nulls} order(s) already hold a null — the next one will collide.`,
    );
    if (!apply) {
      console.log('\nDry run. Re-run with --apply to drop and recreate it.');
    } else {
      await col.dropIndex(NAME);
      await col.createIndex(
        { stripePaymentIntentId: 1 },
        {
          unique: true,
          partialFilterExpression: { stripePaymentIntentId: { $type: 'string' } },
          name: NAME,
        },
      );
      console.log('\nrebuilt with partialFilterExpression on string values');
    }
  }
} finally {
  await client.close();
}
