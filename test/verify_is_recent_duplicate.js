
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Track from '../models/Track.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/music-webhook-test';

async function verifyIsRecentDuplicate() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Create a dummy track
    const artist = 'Test Artist';
    const title = 'Test Track';
    const now = new Date();

    await Track.create({
      artist,
      title,
      scrobbledAt: now,
      timestamp: now,
      eventType: 'scrobble'
    });
    console.log('✅ Created dummy track');

    // Test isRecentDuplicate
    const isDuplicate = await Track.isRecentDuplicate(artist, title, now, 300000);
    
    if (isDuplicate) {
      console.log('✅ isRecentDuplicate returned true for existing track');
    } else {
      console.error('❌ isRecentDuplicate returned false for existing track');
    }

    // Test non-duplicate
    const isNotDuplicate = await Track.isRecentDuplicate('Other Artist', 'Other Track', now, 300000);
    
    if (!isNotDuplicate) {
      console.log('✅ isRecentDuplicate returned false for non-existing track');
    } else {
      console.error('❌ isRecentDuplicate returned true for non-existing track');
    }

    // Cleanup
    await Track.deleteMany({ artist: 'Test Artist' });
    console.log('🧹 Cleaned up test data');

  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
}

verifyIsRecentDuplicate();
