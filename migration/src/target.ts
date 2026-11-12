import { MongoClient, Db } from 'mongodb';
import { env } from './env';

/**
 * Connects to the target MongoDB and hands back the raw driver `Db`.
 *
 * The migration writes through the native driver (not Mongoose models) so it
 * fully controls the document shape and can `bulkWrite` idempotent upserts
 * keyed on `legacyId`. Collection names match Mongoose's pluralisation:
 * User → `users`, Product → `products`.
 */
export interface Target {
  db: Db;
  close(): Promise<void>;
}

export async function openTarget(): Promise<Target> {
  const client = new MongoClient(env.mongo.uri);
  await client.connect();
  const db = client.db(env.mongo.db);
  return {
    db,
    async close() {
      await client.close();
    },
  };
}
