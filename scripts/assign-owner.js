/**
 * Backfill `user` on existing Scrobble docs that predate per-user ownership.
 *
 * Assigns every owner-less scrobble to the admin user (resolved from
 * ADMIN_EMAIL, else the oldest admin). Idempotent — re-running only touches
 * docs that still lack an owner.
 *
 * Usage:
 *   bun run scripts/assign-owner.js --dry-run   # preview count
 *   bun run scripts/assign-owner.js             # apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Scrobble from '../models/Scrobble.js';
import User from '../models/User.js';
import authService from '../services/authService.js';

const DRY_RUN = process.argv.includes('--dry-run');
const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/music-webhook';

async function run() {
  console.log(`\n🔄 Assign-owner backfill${DRY_RUN ? ' (DRY RUN)' : ''}`);
  // Respect DB_NAME like the app's connector — otherwise the URI has no path
  // and mongoose falls back to the `test` database.
  const options = process.env.DB_NAME ? { dbName: process.env.DB_NAME } : {};
  await mongoose.connect(MONGO_URI, options);
  console.log(`🔗 ${MONGO_URI}${process.env.DB_NAME ? ` (db: ${process.env.DB_NAME})` : ''}`);

  // Seed the admin from env if it doesn't exist yet (server boot also does this)
  await authService.seedAdmin();

  const admin = (process.env.ADMIN_EMAIL && await User.findByEmail(process.env.ADMIN_EMAIL))
    || await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });

  if (!admin) {
    console.error('❌ No admin user found. Set ADMIN_EMAIL/ADMIN_PASSWORD in .env, then re-run.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const filter = { $or: [{ user: { $exists: false } }, { user: null }] };
  const count = await Scrobble.countDocuments(filter);
  console.log(`📊 ${count} scrobble(s) without an owner → would assign to ${admin.email}`);

  if (!DRY_RUN && count > 0) {
    const res = await Scrobble.updateMany(filter, { $set: { user: admin._id } });
    console.log(`✅ Updated ${res.modifiedCount} scrobble(s).`);
  } else if (DRY_RUN) {
    console.log('ℹ️ Dry run — no writes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
