import redis from '../config/redis.js';
import Cache from '../models/Cache.js';

const NULL_SENTINEL = '__NULL__';

async function get(key) {
  if (redis?.status === 'ready') {
    try {
      const val = await redis.get(key);
      if (val !== null) {
        return val === NULL_SENTINEL ? null : JSON.parse(val);
      }
    } catch {
      // fall through to Mongo
    }
  }

  try {
    const doc = await Cache.findOne({ key });
    if (doc) {
      if (redis?.status === 'ready') {
        const ttlMs = doc.expiresAt
          ? Math.max(doc.expiresAt.getTime() - Date.now(), 1000)
          : 30 * 24 * 60 * 60 * 1000;
        const payload = doc.data === null ? NULL_SENTINEL : JSON.stringify(doc.data);
        redis.set(key, payload, 'PX', ttlMs).catch(() => {});
      }
      return doc.data;
    }
  } catch {
    // Mongo down too
  }

  return undefined;
}

async function set(key, data, ttlMs) {
  const ttlSec = Math.ceil(ttlMs / 1000);

  if (redis?.status === 'ready') {
    try {
      const payload = data === null ? NULL_SENTINEL : JSON.stringify(data);
      await redis.set(key, payload, 'EX', ttlSec);
    } catch {
      // continue to Mongo write-through
    }
  }

  try {
    await Cache.findOneAndUpdate(
      { key },
      { data, expiresAt: new Date(Date.now() + ttlMs) },
      { upsert: true, new: true },
    );
  } catch {
    // best effort
  }
}

async function del(pattern) {
  if (redis?.status === 'ready') {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // best effort
    }
  }

  try {
    const regexStr = pattern.replace(/\*/g, '.*');
    await Cache.deleteMany({ key: new RegExp(`^${regexStr}$`) });
  } catch {
    // best effort
  }
}

async function count(pattern) {
  let total = 0;
  try {
    const regexStr = pattern.replace(/\*/g, '.*');
    total = await Cache.countDocuments({ key: new RegExp(`^${regexStr}$`) });
  } catch {
    // ignore
  }
  return total;
}

export default { get, set, del, count };
