
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import mongoose from 'mongoose';
import Cache from '../models/Cache.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/music-webhook-test';

describe('Cache Model', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI);
  });

  afterAll(async () => {
    await Cache.deleteMany({ key: /^test:/ });
    await mongoose.disconnect();
  });

  it('should save and retrieve data', async () => {
    const key = 'test:key1';
    const data = { foo: 'bar' };
    
    await Cache.create({ key, data, expiresAt: new Date(Date.now() + 10000) });
    
    const cached = await Cache.findOne({ key });
    expect(cached).not.toBeNull();
    expect(cached.data).toEqual(data);
  });

  it('should update existing key', async () => {
    const key = 'test:key2';
    await Cache.create({ key, data: { val: 1 }, expiresAt: new Date(Date.now() + 10000) });
    
    await Cache.findOneAndUpdate(
      { key },
      { data: { val: 2 } }
    );
    
    const cached = await Cache.findOne({ key });
    expect(cached.data.val).toBe(2);
  });
});
