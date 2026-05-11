import Redis from 'ioredis';

let redis = null;

const url = process.env.REDIS_URL;
if (url) {
  redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 500, 3000);
    },
  });

  redis.on('connect', () => console.log('✅ Redis connected'));
  redis.on('error', (err) => {
    if (err.code !== 'ECONNREFUSED') {
      console.error('❌ Redis error:', err.message);
    }
  });

  redis.connect().catch(() => {
    console.warn('⚠️ Redis unavailable — running without cache layer');
  });
} else {
  console.log('ℹ️ REDIS_URL not set — Redis disabled');
}

export default redis;
