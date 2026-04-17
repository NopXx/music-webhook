// Test script สำหรับทดสอบ Web-scrobbler format ใหม่
// วิธีใช้: bun run test-new-format.js

const BASE_URL = 'http://localhost:3000';

console.log('🧪 Testing Web-scrobbler New Format...\n');

// Test data ในรูปแบบใหม่ที่ส่งมาจริง
const webScrobblerNewFormat = {
  "eventName": "nowplaying",
  "time": 1757319841607,
  "data": {
    "song": {
      "parsed": {
        "track": "XOXZ",
        "artist": "IVE",
        "albumArtist": null,
        "album": null,
        "duration": 157,
        "uniqueID": "B1ShLiq3EVc",
        "currentTime": 4,
        "isPlaying": true,
        "trackArt": null,
        "isPodcast": false,
        "originUrl": "https://youtu.be/B1ShLiq3EVc",
        "scrobblingDisallowedReason": null
      },
      "processed": {
        "track": "XOXZ",
        "artist": "IVE",
        "albumArtist": null,
        "album": null,
        "duration": 157
      },
      "connector": {
        "label": "YouTube",
        "id": "youtube"
      }
    }
  }
};

// Test scrobble event
const scrobbleEvent = {
  "eventName": "scrobble",
  "time": Date.now(),
  "data": {
    "song": {
      "parsed": {
        "track": "Love Dive",
        "artist": "IVE",
        "album": "Love Dive",
        "duration": 197,
        "originUrl": "https://youtu.be/Y8JFxS1HlDo"
      },
      "processed": {
        "track": "Love Dive", 
        "artist": "IVE",
        "album": "Love Dive",
        "duration": 197
      },
      "connector": {
        "label": "YouTube",
        "id": "youtube"
      }
    }
  }
};

// Test with missing data
const invalidFormat = {
  "eventName": "nowplaying",
  "time": Date.now(),
  "data": {
    "song": {
      "parsed": {
        // Missing track and artist
        "duration": 180
      }
    }
  }
};

async function testWebhook(testName, data) {
  try {
    console.log(`📡 Testing: ${testName}`);
    
    const response = await fetch(`${BASE_URL}/webhook/scrobble`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const responseData = await response.json();
    
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(responseData, null, 2));
    
    if (response.status === 200) {
      console.log('✅ Success!');
    } else {
      console.log('❌ Failed');
    }
    
    console.log('');
    return { success: response.status === 200, data: responseData };

  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
    console.log('');
    return { success: false, error: error.message };
  }
}

async function main() {
  // Check if server is running
  try {
    const healthResponse = await fetch(`${BASE_URL}/api/health`);
    if (!healthResponse.ok) {
      console.log('❌ Server is not responding. Please start it with: bun run dev');
      return;
    }
    console.log('✅ Server is running!\n');
  } catch (error) {
    console.log('❌ Cannot connect to server. Please start it with: bun run dev');
    return;
  }

  const results = [];

  // Test 1: Now playing event
  results.push(await testWebhook('Now Playing Event (New Format)', webScrobblerNewFormat));

  // Test 2: Scrobble event  
  results.push(await testWebhook('Scrobble Event (New Format)', scrobbleEvent));

  // Test 3: Invalid format (missing required fields)
  results.push(await testWebhook('Invalid Format (Missing Fields)', invalidFormat));

  // Summary
  const successful = results.filter(r => r.success).length;
  const total = results.length;
  
  console.log('📊 Test Summary:');
  console.log(`   Successful: ${successful}/${total}`);
  console.log(`   Failed: ${total - successful}/${total}`);
  
  if (successful > 0) {
    console.log('\n✅ Web-scrobbler new format is working!');
    console.log('🎵 Your server can now receive scrobbles from the latest Web Scrobbler extension');
  }
  
  // Get recent tracks to verify data was saved
  console.log('\n📋 Checking saved tracks...');
  try {
    const tracksResponse = await fetch(`${BASE_URL}/api/tracks?limit=3`);
    const tracksData = await tracksResponse.json();
    
    if (tracksData.tracks && tracksData.tracks.length > 0) {
      console.log('   Recent tracks:');
      tracksData.tracks.forEach((track, index) => {
        console.log(`   ${index + 1}. ${track.artist} - ${track.title} (${track.connector})`);
      });
    }
  } catch (error) {
    console.log('   Could not fetch recent tracks');
  }
}

main().catch(console.error);
