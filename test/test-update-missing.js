#!/usr/bin/env node
/**
 * Test script for the new /api/spotify/update-missing endpoint
 * Usage: node test-update-missing.js [options]
 */

import axios from 'axios';

const BASE_URL = process.env.WEBHOOK_URL || 'http://localhost:3000';

// Test configurations
const testConfigs = {
  // Test 1: Update only tracks missing basic data (recommended)
  missingOnly: {
    url: `${BASE_URL}/api/spotify/update-missing?missingOnly=true&limit=10`,
    description: 'Update tracks missing basic data (duration, album, year)'
  },
  
  // Test 2: Update tracks that haven't been searched yet
  noSpotifyData: {
    url: `${BASE_URL}/api/spotify/update-missing?limit=10`,
    description: 'Update tracks without any Spotify search attempt'
  },
  
  // Test 3: Force update (use carefully)
  forceUpdate: {
    url: `${BASE_URL}/api/spotify/update-missing?force=true&limit=5`,
    description: 'Force update all tracks (WARNING: May take long time)'
  },
  
  // Test 4: Specific priority fields
  durationOnly: {
    url: `${BASE_URL}/api/spotify/update-missing?missingOnly=true&priority=duration&limit=15`,
    description: 'Update only tracks missing duration'
  }
};

async function testEndpoint(config) {
  console.log(`\n🧪 Testing: ${config.description}`);
  console.log(`📡 URL: ${config.url}`);
  console.log('⏳ Sending request...\n');
  
  try {
    const startTime = Date.now();
    const response = await axios.post(config.url);
    const endTime = Date.now();
    
    console.log('✅ Success!');
    console.log(`⏱️  Time taken: ${endTime - startTime}ms`);
    console.log('📊 Response:');
    console.log(JSON.stringify(response.data, null, 2));
    
    return { success: true, data: response.data, time: endTime - startTime };
    
  } catch (error) {
    console.log('❌ Error!');
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log('Response:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('Error:', error.message);
    }
    
    return { success: false, error: error.message };
  }
}

async function checkServerStatus() {
  console.log('🔍 Checking server status...');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/health`);
    console.log('✅ Server is healthy');
    
    // Check Spotify status
    const spotifyResponse = await axios.get(`${BASE_URL}/api/spotify/status`);
    if (spotifyResponse.data.configured) {
      console.log('✅ Spotify is configured');
    } else {
      console.log('⚠️  Spotify is not configured');
      console.log('   Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET');
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.log('❌ Server is not accessible');
    console.log('   Make sure the server is running on', BASE_URL);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Music Webhook - Spotify Update Missing Data Test');
  console.log('='.repeat(60));
  
  // Check server status first
  const serverOk = await checkServerStatus();
  if (!serverOk) {
    process.exit(1);
  }
  
  // Get test selection from command line args
  const testName = process.argv[2];
  
  if (testName && testConfigs[testName]) {
    // Run specific test
    await testEndpoint(testConfigs[testName]);
  } else if (testName === 'all') {
    // Run all tests
    console.log('\n🔄 Running all tests...');
    
    for (const [name, config] of Object.entries(testConfigs)) {
      await testEndpoint(config);
      
      // Wait between tests to avoid overwhelming the server
      if (name !== Object.keys(testConfigs).slice(-1)[0]) {
        console.log('\n⏳ Waiting 2 seconds before next test...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } else {
    // Show available tests
    console.log('\n📋 Available tests:');
    for (const [name, config] of Object.entries(testConfigs)) {
      console.log(`   ${name}: ${config.description}`);
    }
    
    console.log('\n💡 Usage:');
    console.log('   node test-update-missing.js <test-name>');
    console.log('   node test-update-missing.js all');
    console.log('\n   Examples:');
    console.log('   node test-update-missing.js missingOnly');
    console.log('   node test-update-missing.js durationOnly');
    console.log('   node test-update-missing.js all');
  }
  
  console.log('\n✨ Test completed');
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Test runner failed:', error.message);
  process.exit(1);
});
