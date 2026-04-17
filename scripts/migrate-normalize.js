#!/usr/bin/env node
/**
 * migrate-normalize.js
 *
 * One-time migration script that transforms the monolithic `tracks` collection
 * into the normalized 4-collection schema:
 *   tracks  →  artists + albums + trackmetas + scrobbles
 *
 * Usage:
 *   node scripts/migrate-normalize.js             # Perform migration
 *   node scripts/migrate-normalize.js --dry-run    # Preview without writing
 *
 * Prerequisites:
 *   - MONGODB_URI (or MONGO_URI) must be set in .env or environment
 *   - Back up your database before running!
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import Artist from '../models/Artist.js';
import Album from '../models/Album.js';
import TrackMeta from '../models/TrackMeta.js';
import Scrobble from '../models/Scrobble.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200;

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/music-webhook';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

const stats = {
  total: 0,
  processed: 0,
  artistsCreated: 0,
  albumsCreated: 0,
  trackMetasCreated: 0,
  scrobblesCreated: 0,
  errors: 0,
};

const artistCache = new Map();  // nameLower → doc
const albumCache = new Map();   // `${nameLower}|${artistId}` → doc
const trackCache = new Map();   // `${titleLower}|${artistId}` → doc

async function getOrCreateArtist(name, extra = {}) {
  if (!name || !name.trim()) return null;
  const lower = name.trim().toLowerCase();

  if (artistCache.has(lower)) return artistCache.get(lower);

  if (DRY_RUN) {
    const fake = { _id: new mongoose.Types.ObjectId(), name: name.trim(), nameLower: lower };
    artistCache.set(lower, fake);
    stats.artistsCreated++;
    return fake;
  }

  const doc = await Artist.findOrCreateByName(name.trim(), extra);
  artistCache.set(lower, doc);
  stats.artistsCreated++;
  return doc;
}

async function getOrCreateAlbum(name, artistId, extra = {}) {
  if (!name || !name.trim() || !artistId) return null;
  const lower = name.trim().toLowerCase();
  const key = `${lower}|${artistId}`;

  if (albumCache.has(key)) return albumCache.get(key);

  if (DRY_RUN) {
    const fake = { _id: new mongoose.Types.ObjectId(), name: name.trim(), nameLower: lower, artist: artistId };
    albumCache.set(key, fake);
    stats.albumsCreated++;
    return fake;
  }

  const doc = await Album.findOrCreateByNameAndArtist(name.trim(), artistId, extra);
  albumCache.set(key, doc);
  stats.albumsCreated++;
  return doc;
}

async function getOrCreateTrackMeta(title, artistId, albumId, extra = {}) {
  if (!title || !title.trim() || !artistId) return null;
  const lower = title.trim().toLowerCase();
  const key = `${lower}|${artistId}`;

  if (trackCache.has(key)) return trackCache.get(key);

  if (DRY_RUN) {
    const fake = { _id: new mongoose.Types.ObjectId(), title: title.trim(), titleLower: lower, artist: artistId, album: albumId };
    trackCache.set(key, fake);
    stats.trackMetasCreated++;
    return fake;
  }

  const doc = await TrackMeta.findOrCreateByIdentity(title.trim(), artistId, albumId, extra);
  trackCache.set(key, doc);
  stats.trackMetasCreated++;
  return doc;
}

// ──────────────────────────────────────────────
// Main migration
// ──────────────────────────────────────────────

async function migrate() {
  console.log(`\n🔄 Starting migration${DRY_RUN ? ' (DRY RUN)' : ''}...`);
  console.log(`📦 Connecting to: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}\n`);

  await mongoose.connect(MONGO_URI);

  // Access the old 'tracks' collection directly
  const db = mongoose.connection.db;
  const oldTracks = db.collection('tracks');

  stats.total = await oldTracks.countDocuments();
  console.log(`📊 Found ${stats.total} documents in the 'tracks' collection.\n`);

  if (stats.total === 0) {
    console.log('Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  const cursor = oldTracks.find().sort({ scrobbledAt: 1 }).batchSize(BATCH_SIZE);
  let batchCount = 0;

  for await (const doc of cursor) {
    batchCount++;
    stats.processed++;

    try {
      // Skip non-scrobble events
      if (doc.eventType && doc.eventType !== 'scrobble') {
        continue;
      }

      const artistName = doc.artist;
      const albumName = doc.album;
      const trackTitle = doc.title;

      if (!artistName || !trackTitle) {
        stats.errors++;
        continue;
      }

      // 1. Artist
      const artistDoc = await getOrCreateArtist(artistName, {
        artistUrl: doc.artistUrl || undefined,
        lastfmMbid: doc.lastfmMbid || undefined,
      });
      if (!artistDoc) { stats.errors++; continue; }

      // 2. Album (optional)
      let albumDoc = null;
      if (albumName && albumName.trim()) {
        albumDoc = await getOrCreateAlbum(albumName, artistDoc._id, {
          year: doc.year || undefined,
          trackArtUrl: doc.trackArtUrl || undefined,
          albumUrl: doc.albumUrl || undefined,
          appleMusicUrl: doc.appleMusicUrl || undefined,
        });
      }

      // 3. TrackMeta
      const trackMetaExtra = {
        duration: doc.duration || undefined,
        trackNumber: doc.trackNumber || undefined,
        genre: doc.genre || undefined,
        trackUrl: doc.trackUrl || undefined,
        trackArtUrl: doc.trackArtUrl || undefined,
        lastfmMbid: doc.lastfmMbid || undefined,
        lastfmTrackId: doc.lastfmTrackId || undefined,
      };

      // Copy Spotify data to TrackMeta
      if (doc.spotify) {
        trackMetaExtra.spotify = doc.spotify;
        trackMetaExtra.spotify_enriched = doc.spotify_enriched;
        trackMetaExtra.spotify_search_attempted = doc.spotify_search_attempted;
        trackMetaExtra.spotify_match_found = doc.spotify_match_found;
      }

      // Copy Apple Music data to TrackMeta
      if (doc.animationUrl) trackMetaExtra.animationUrl = doc.animationUrl;
      if (doc.masterTallUrl) trackMetaExtra.masterTallUrl = doc.masterTallUrl;
      if (doc.primaryMediaUrl) trackMetaExtra.primaryMediaUrl = doc.primaryMediaUrl;
      if (doc.primaryMediaType) trackMetaExtra.primaryMediaType = doc.primaryMediaType;
      if (doc.animation_search_attempted !== undefined) trackMetaExtra.animation_search_attempted = doc.animation_search_attempted;
      if (doc.animation_match_found !== undefined) trackMetaExtra.animation_match_found = doc.animation_match_found;
      if (doc.appleMusicUrl) trackMetaExtra.appleMusicUrl = doc.appleMusicUrl;

      const trackMeta = await getOrCreateTrackMeta(
        trackTitle,
        artistDoc._id,
        albumDoc?._id || null,
        trackMetaExtra
      );
      if (!trackMeta) { stats.errors++; continue; }

      // 4. Create Scrobble
      if (!DRY_RUN) {
        await Scrobble.create({
          track: trackMeta._id,
          timestamp: doc.timestamp || doc.scrobbledAt || new Date(),
          scrobbledAt: doc.scrobbledAt || doc.timestamp || new Date(),
          source: doc.source || 'web-scrobbler',
          connector: doc.connector,
          originalUrl: doc.originalUrl,
          eventType: doc.eventType || 'scrobble',
          isLoved: doc.isLoved || false,
          isLovedInService: doc.isLovedInService,
          playCount: doc.playCount || 1,
          userPlayCount: doc.userPlayCount,
          metadataLabel: doc.metadataLabel,
          albumArtist: doc.albumArtist,
          isScrobbled: doc.isScrobbled !== false,
          isCorrectedByUser: doc.isCorrectedByUser || false,
          isValid: doc.isValid !== false,
          startTimestamp: doc.startTimestamp,
          currentTime: doc.currentTime,
          userAgent: doc.userAgent,
          ipAddress: doc.ipAddress,
          rawData: doc.rawData,
        });
      }
      stats.scrobblesCreated++;

    } catch (err) {
      stats.errors++;
      console.error(`  ❌ Error processing doc ${doc._id}: ${err.message}`);
    }

    // Progress logging
    if (batchCount % 500 === 0) {
      const pct = ((stats.processed / stats.total) * 100).toFixed(1);
      console.log(`  📈 Progress: ${stats.processed}/${stats.total} (${pct}%) | Artists: ${stats.artistsCreated} | Albums: ${stats.albumsCreated} | Tracks: ${stats.trackMetasCreated} | Scrobbles: ${stats.scrobblesCreated}`);
    }
  }

  console.log('\n✅ Migration complete!\n');
  console.log('── Summary ─────────────────────────');
  console.log(`  Total documents:     ${stats.total}`);
  console.log(`  Processed:           ${stats.processed}`);
  console.log(`  Artists created:     ${stats.artistsCreated}`);
  console.log(`  Albums created:      ${stats.albumsCreated}`);
  console.log(`  TrackMetas created:  ${stats.trackMetasCreated}`);
  console.log(`  Scrobbles created:   ${stats.scrobblesCreated}`);
  console.log(`  Errors:              ${stats.errors}`);
  console.log(`  Mode:                ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('─────────────────────────────────────\n');

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
