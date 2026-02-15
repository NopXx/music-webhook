
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import spotifyService from '../services/spotifyService.js';
import appleMusicService from '../services/appleMusicService.js';
import Cache from '../models/Cache.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/music-webhook-test';

async function verifyMusicSearch() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing cache for testing
    await Cache.deleteMany({});
    console.log('🧹 Cleared cache');

    // --- Spotify Validation ---
    console.log('\n--- Testing Spotify Search & Caching ---');
    const artist = 'Taylor Swift';
    const title = 'Cruel Summer';
    
    console.log(`🔍 Searching Spotify for: ${artist} - ${title}`);
    const startSpotify = Date.now();
    const spotifyResult = await spotifyService.searchTrack(artist, title);
    console.log(`⏱️ Spotify search took: ${Date.now() - startSpotify}ms`);
    
    if (spotifyResult) {
      console.log('✅ Spotify result found:', spotifyResult.name);
      
      // Verify cache
      const cacheKey = spotifyService.createCacheKey(artist, title);
      const cachedEntry = await Cache.findOne({ key: cacheKey });
      
      if (cachedEntry) {
        console.log('✅ Spotify result cached in MongoDB');
      } else {
        console.error('❌ Spotify result NOT cached');
      }
      
      // Test Cache Hit
      console.log('🔄 Testing Spotify Cache Hit...');
      const startCache = Date.now();
      await spotifyService.searchTrack(artist, title);
      console.log(`⏱️ Cached search took: ${Date.now() - startCache}ms (Should be much faster)`);
      
    } else {
      console.warn('⚠️ No Spotify result found (Check credentials)');
    }

    // --- Apple Music Validation ---
    console.log('\n--- Testing Apple Music Search (Parallel) & Caching ---');
    const amArtist = 'NewJeans';
    const amTitle = 'Super Shy';
    
    console.log(`🔍 Searching Apple Music for: ${amArtist} - ${amTitle}`);
    const startApple = Date.now();
    const amResult = await appleMusicService.searchAppleMusicUrl(amTitle, amArtist);
    console.log(`⏱️ Apple Music search took: ${Date.now() - startApple}ms`);
    
    if (amResult.success) {
      console.log('✅ Apple Music URL found:', amResult.url);
      
      // Verify cache
      const amCacheKey = appleMusicService.createCacheKey('url', amTitle, amArtist, '');
      const amCachedEntry = await Cache.findOne({ key: amCacheKey });
      
      if (amCachedEntry) {
        console.log('✅ Apple Music result cached in MongoDB');
      } else {
        console.error('❌ Apple Music result NOT cached');
      }
      
      // Test Animated Artwork
      console.log('\n🎨 Testing Animated Artwork...');
      const artworkResult = await appleMusicService.getAnimatedArtwork(amResult.url);
      
      if (artworkResult.success) {
        console.log('✅ Animated artwork found:', artworkResult.url);
         // Verify artwork cache
        const artCacheKey = appleMusicService.createCacheKey('artwork', amResult.url);
        const artCached = await Cache.findOne({ key: artCacheKey });
        if (artCached) console.log('✅ Artwork result cached in MongoDB');
        else console.error('❌ Artwork result NOT cached');

      } else {
        console.warn('⚠️ No animated artwork found:', artworkResult.error);
      }
      
    } else {
      console.warn('⚠️ No Apple Music result found');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit();
  }
}

verifyMusicSearch();
