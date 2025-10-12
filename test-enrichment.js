#!/usr/bin/env node

// Test script สำหรับทดสอบ Spotify enrichment กับข้อมูลตัวอย่าง
import { config } from 'dotenv';

// Load environment variables
config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Test tracks ที่ขาดข้อมูลบางส่วน
const testTracks = [
  {
    title: "Blinding Lights",
    artist: "The Weeknd",
    // ไม่มี album, duration, year
    description: "ขาดข้อมูล: album, duration, year"
  },
  {
    title: "Shape of You", 
    artist: "Ed Sheeran",
    album: "", // album ว่าง
    // ไม่มี duration, year
    description: "ขาดข้อมูล: album (ว่าง), duration, year"
  },
  {
    title: "Bad Guy",
    artist: "Billie Eilish",
    duration: null, // duration เป็น null
    description: "ขาดข้อมูล: duration (null), album, year"
  },
  {
    title: "Someone Like You",
    artist: "Adele",
    album: "21",
    duration: 285,
    // ไม่มี year, trackNumber
    description: "ขาดข้อมูล: year, trackNumber"
  },
  {
    title: "Watermelon Sugar",
    artist: "Harry Styles",
    album: "Fine Line",
    duration: 174,
    year: 2019,
    // มีข้อมูลครบแล้ว แต่ไม่มี trackNumber
    description: "ขาดข้อมูล: trackNumber"
  }
];

async function testSpotifyEnrichment() {
  console.log('🧪 Testing Spotify Enrichment with Incomplete Data');
  console.log('===============================================\n');

  for (let i = 0; i < testTracks.length; i++) {
    const track = testTracks[i];
    console.log(`${i + 1}. Testing: ${track.artist} - ${track.title}`);
    console.log(`   ${track.description}`);
    
    try {
      // ส่งข้อมูล track ที่ขาดหายไปไปยัง webhook
      const response = await fetch(`${BASE_URL}/webhook/scrobble`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          album: track.album || undefined,
          duration: track.duration || undefined,
          year: track.year || undefined,
          trackNumber: track.trackNumber || undefined,
          connector: 'test-enrichment',
          eventType: 'scrobble'
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log(`   ✅ Track saved: ${result.trackId}`);
        console.log(`   📦 Action: ${result.action}`);
        console.log(`   🎧 Spotify configured: ${result.spotify_configured}`);
        console.log(`   🔄 Enrichment queued: ${result.spotify_enrichment_queued}`);
        
        if (result.track.spotify_data) {
          console.log(`   🎵 Already has Spotify data!`);
        }
      } else {
        console.log(`   ❌ Error: ${result.error || result.message}`);
      }
      
    } catch (error) {
      console.log(`   💥 Request failed: ${error.message}`);
    }
    
    console.log(''); // Empty line
    
    // รอสักครู่เพื่อให้ async enrichment ทำงาน
    if (i < testTracks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function checkEnrichmentResults() {
  console.log('📊 Checking Enrichment Results');
  console.log('==============================\n');

  try {
    // ดูสถิติ Spotify
    const statsResponse = await fetch(`${BASE_URL}/api/spotify/stats`);
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log('📈 Spotify Statistics:');
      console.log(`   Total tracks: ${stats.total}`);
      console.log(`   Enriched: ${stats.spotify_enriched} (${stats.enrichment_rate_percent}%)`);
      console.log(`   Search attempted: ${stats.spotify_search_attempted}`);
      console.log(`   Matches found: ${stats.spotify_match_found} (${stats.match_rate_percent}%)`);
      console.log(`   Pending: ${stats.pending_enrichment}`);
      console.log('');
    }

    // ดูข้อมูล tracks ล่าสุด
    const tracksResponse = await fetch(`${BASE_URL}/api/tracks?limit=10`);
    if (tracksResponse.ok) {
      const tracksData = await tracksResponse.json();
      console.log('🎵 Recent Tracks (showing enrichment status):');
      
      tracksData.tracks.slice(0, 5).forEach((track, index) => {
        console.log(`   ${index + 1}. ${track.artist} - ${track.title}`);
        console.log(`      Album: ${track.album || 'N/A'}`);
        console.log(`      Duration: ${track.duration || 'N/A'}s`);
        console.log(`      Connector: ${track.connector}`);
        // Note: API response อาจไม่มี spotify fields ใน select
      });
    }

  } catch (error) {
    console.log(`❌ Error checking results: ${error.message}`);
  }
}

async function manualEnrichment() {
  console.log('🔧 Triggering Manual Enrichment');
  console.log('===============================\n');

  try {
    const response = await fetch(`${BASE_URL}/api/spotify/enrich?limit=10`, {
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Manual enrichment completed:');
      console.log(`   Processed: ${result.processed} tracks`);
      console.log(`   Enriched: ${result.enriched} tracks`);
      console.log(`   Errors: ${result.errors} tracks`);
      console.log(`   Force mode: ${result.force_mode ? 'Yes' : 'No'}`);
    } else {
      const error = await response.json();
      console.log(`❌ Manual enrichment failed: ${error.error || error.message}`);
    }

  } catch (error) {
    console.log(`💥 Manual enrichment request failed: ${error.message}`);
  }
}

async function main() {
  console.log('🎵 Spotify Enrichment Test - Incomplete Data');
  console.log('===========================================\n');
  console.log(`Server: ${BASE_URL}\n`);

  // ทดสอบการส่งข้อมูลที่ขาดหายไป
  await testSpotifyEnrichment();
  
  // รอให้ async enrichment ทำงาน
  console.log('⏳ Waiting for async enrichment to complete...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // ตรวจสอบผลลัพธ์
  await checkEnrichmentResults();
  
  console.log('');
  
  // ทดสอบ manual enrichment
  await manualEnrichment();
  
  console.log('\n🎉 Test completed! Check server logs for detailed enrichment process.');
}

// เรียกใช้งาน
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
}
