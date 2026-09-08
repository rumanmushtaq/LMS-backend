/**
 * One-off backfill: label every existing conversation as a private chat or a
 * class Q&A room.
 *
 * Conversations predate the `type` field, so a class room and a DM are
 * indistinguishable in old data — except that a class stores the room it
 * created in `liveSession.conversationId`. That reference is the only
 * evidence, so it is what this reads.
 *
 * Order matters: everything is marked 'dm' first, then the rooms a class
 * points at are corrected to 'class'. Anything not referenced by a class was
 * created by the DM endpoint and is a private chat.
 *
 * Safe to run more than once.
 *
 *   node scripts/backfill-conversation-types.mjs          # report only
 *   node scripts/backfill-conversation-types.mjs --apply  # write
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const apply = process.argv.includes('--apply');

function mongoUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('MONGODB_URI='));
  if (!line) throw new Error('MONGODB_URI not found in env or .env');
  return line.slice('MONGODB_URI='.length).trim();
}

const client = await new MongoClient(mongoUri()).connect();
try {
  const db = client.db(process.env.MONGODB_DB || 'test');
  const conversations = db.collection('conversations');
  const classes = db.collection('classsessions');

  // Every room a class owns, by conversation id.
  const roomIds = await classes.distinct('liveSession.conversationId', {
    'liveSession.conversationId': { $ne: null },
  });

  const untyped = await conversations.countDocuments({
    type: { $exists: false },
  });
  const willBeClass = await conversations.countDocuments({
    _id: { $in: roomIds },
  });

  console.log(`conversations without a type : ${untyped}`);
  console.log(`class Q&A rooms to label      : ${willBeClass}`);
  console.log(`remaining as private chats    : ${untyped - willBeClass}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write these changes.');
  } else {
    const dm = await conversations.updateMany(
      { type: { $exists: false } },
      { $set: { type: 'dm', classId: null } },
    );
    console.log(`\nlabelled as dm    : ${dm.modifiedCount}`);

    let classCount = 0;
    for (const id of roomIds) {
      const cls = await classes.findOne(
        { 'liveSession.conversationId': id },
        { projection: { _id: 1 } },
      );
      if (!cls) continue;
      const r = await conversations.updateOne(
        { _id: id },
        { $set: { type: 'class', classId: cls._id } },
      );
      classCount += r.modifiedCount;
    }
    console.log(`corrected to class: ${classCount}`);
  }
} finally {
  await client.close();
}
