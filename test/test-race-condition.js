#!/usr/bin/env node

// Test script สำหรับทดสอบการแก้ไข race condition
import { config } from 'dotenv';

// Load environment variables
config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testRaceConditionFix() {
  console.log('🧪 Testing Race Condition Fix');
  console.log('=============================\n');

  // Test case: ส่งข้อมูลเดียวกันหลายครั้งในเวลาเดียวกัน
  const testTrack = {
    title: "Test Race Condition Song",
    artist: "Test Artist",
    connector: "race-condition-test",
    eventType: "scrobble"
  };

  console.log('📤 Sending multiple requests simultaneously...');
  
  try {
    // ส่ง request หลายครั้งพร้อมๆ กัน
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        fetch(`${BASE_URL}/webhook/scrobble`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...testTrack,
            title: `${testTrack.title} ${i + 1}`
          })
        }).then(res => res.json())
      );
    }

    const results = await Promise.all(promises);
    
    console.log('📊 Results:');
    results.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.success ? '✅' : '❌'} ${result.message}`);
      if (result.trackId) {
        console.log(`      Track ID: ${result.trackId}`);
        console.log(`      Action: ${result.action}`);
        console.log(`      Spotify queued: ${result.spotify_enrichment_queued ? 'Yes' : 'No'}`);
      }
    });

  } catch (error) {
    console.log(`❌ Race condition test failed: ${error.message}`);
  }
}

async function testSpotifyEnrichmentRobustness() {
  console.log('\n🎵 Testing Spotify Enrichment Robustness');
  console.log('========================================\n');

  // Test ด้วยเพลงจริงที่มีใน Spotify
  const realTracks = [
    {
      title: "Bohemian Rhapsody",
      artist: "Queen",
      description: "Classic rock song - should find match"
    },
    {
      title: "Nonexistent Song 12345",
      artist: "Fake Artist XYZ",
      description: "Fake song - should not find match"
    },
    {
      title: "Shape of You",
      artist: "Ed Sheeran",
      album: "", // ข้อมูลไม่ครบ
      description: "Real song with missing data - should enrich"
    }
  ];

  for (const track of realTracks) {
    console.log(`🎵 Testing: ${track.artist} - ${track.title}`);
    console.log(`   ${track.description}`);

    try {
      const response = await fetch(`${BASE_URL}/webhook/scrobble`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: track.title,
          artist: track.artist,
          album: track.album || undefined,
          connector: 'robustness-test',
          eventType: 'scrobble'
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log(`   ✅ Track saved: ${result.trackId}`);
        console.log(`   📦 Action: ${result.action}`);
        console.log(`   🎧 Spotify configured: ${result.spotify_configured}`);
        console.log(`   🔄 Enrichment queued: ${result.spotify_enrichment_queued}`);
      } else {
        console.log(`   ❌ Error: ${result.error || result.message}`);
      }

    } catch (error) {
      console.log(`   💥 Request failed: ${error.message}`);
    }

    console.log(''); // Empty line
    
    // รอสักครู่เพื่อให้ enrichment process ทำงาน
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

async function checkEnrichmentStatus() {
  console.log('📊 Checking Enrichment Status');
  console.log('============================\n');

  try {
    // ดูสถิติ Spotify
    const response = await fetch(`${BASE_URL}/api/spotify/stats`);
    if (response.ok) {
      const stats = await response.json();
      console.log('📈 Current Spotify Statistics:');
      console.log(`   Total tracks: ${stats.total}`);
      console.log(`   Enriched: ${stats.spotify_enriched} (${stats.enrichment_rate_percent}%)`);
      console.log(`   Search attempted: ${stats.spotify_search_attempted}`);
      console.log(`   Matches found: ${stats.spotify_match_found} (${stats.match_rate_percent}%)`);
      console.log(`   Pending: ${stats.pending_enrichment}`);
      
      if (stats.pending_enrichment > 0) {
        console.log(`\n⏳ ${stats.pending_enrichment} tracks are pending enrichment...`);
      }
    } else {
      console.log('❌ Failed to get Spotify stats');
    }

  } catch (error) {
    console.log(`❌ Error checking status: ${error.message}`);
  }
}

async function testManualEnrichment() {
  console.log('\n🔧 Testing Manual Enrichment');
  console.log('===========================\n');

  try {
    console.log('🚀 Triggering manual enrichment for pending tracks...');
    
    const response = await fetch(`${BASE_URL}/api/spotify/enrich?limit=5`, {
      method: 'POST'
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Manual enrichment completed:');
      console.log(`   Processed: ${result.processed} tracks`);
      console.log(`   Enriched: ${result.enriched} tracks`);
      console.log(`   Errors: ${result.errors} tracks`);
      
      if (result.errors > 0) {
        console.log('⚠️  Some tracks had errors during enrichment');
      }
    } else {
      const error = await response.json();
      console.log(`❌ Manual enrichment failed: ${error.error || error.message}`);
    }

  } catch (error) {
    console.log(`💥 Manual enrichment request failed: ${error.message}`);
  }
}

async function main() {
  console.log('🎵 Music Webhook - Race Condition & Robustness Test');
  console.log('==================================================\n');
  console.log(`Server: ${BASE_URL}\n`);

  // 1. ทดสอบ race condition fix
  await testRaceConditionFix();
  
  // 2. ทดสอบ Spotify enrichment robustness
  await testSpotifyEnrichmentRobustness();
  
  // รอให้ async enrichment ทำงาน
  console.log('⏳ Waiting for async enrichment to complete...\n');
  await new Promise(resolve => setTimeout(resolve, 8000));
  
  // 3. ตรวจสอบสถานะ
  await checkEnrichmentStatus();
  
  // 4. ทดสอบ manual enrichment
  await testManualEnrichment();
  
  console.log('\n🎉 All tests completed! Check server logs for detailed enrichment process.');
  console.log('💡 Tips:');
  console.log('   - Check for any duplicate key errors in logs');
  console.log('   - Verify that enrichment completed without race conditions');
  console.log('   - Monitor Spotify API rate limits');
}

// เรียกใช้งาน
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });
}
