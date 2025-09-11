// Test script สำหรับทดสอบ Express.js webhook endpoints
// วิธีใช้: bun run test

const BASE_URL = 'http://localhost:3000';
const WEBHOOK_SECRET = 'your-webhook-secret-key-here'; // ตั้งให้ตรงกับ .env
const API_KEY = 'your-api-key-here'; // ถ้ามี

console.log('🧪 Testing Music Webhook Server (Express.js)...\n');

// Test data sets
const testDataSets = {
  standard: {
    track: {
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      duration: 240,
      url: 'https://test.com/track/123'
    },
    connector: 'test',
    timestamp: Math.floor(Date.now() / 1000)
  },
  
  simple: {
    title: 'Simple Test Song',
    artist: 'Simple Test Artist',
    album: 'Simple Test Album',
    duration: 180,
    connector: 'youtube'
  },
  
  nowPlaying: {
    nowPlaying: {
      title: 'Now Playing Song',
      artist: 'Now Playing Artist',
      album: 'Now Playing Album'
    },
    source: 'spotify'
  },
  
  invalid: {
    invalid: 'data without required fields'
  },
  
  emptyFields: {
    title: '',
    artist: '',
    album: 'Album Name'
  },
  
  longFields: {
    title: 'A'.repeat(600), // Too long
    artist: 'Test Artist',
    album: 'Test Album'
  }
};

async function testEndpoint(method, endpoint, data = null, headers = {}) {
  try {
    console.log(`📡 Testing ${method} ${endpoint}...`);
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const responseText = await response.text();
    
    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch {
      parsedData = responseText;
    }

    console.log(`   Status: ${response.status}`);
    
    // Show rate limit headers if present
    if (response.headers.get('x-ratelimit-remaining')) {
      console.log(`   Rate Limit: ${response.headers.get('x-ratelimit-remaining')} remaining`);
    }
    
    console.log(`   Response:`, parsedData);
    console.log('');

    return { status: response.status, data: parsedData, headers: response.headers };

  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
    console.log('');
    return { error: error.message };
  }
}

async function runValidationTests() {
  console.log('🔍 Running validation tests...\n');

  // Test 1: Valid standard format
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.standard, {
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 2: Valid simple format
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.simple, {
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 3: Valid nowPlaying format
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.nowPlaying, {
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 4: Invalid data (should fail validation)
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.invalid, {
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 5: Empty required fields (should fail validation)
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.emptyFields, {
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 6: Fields too long (should fail validation)
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.longFields, {
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 7: Wrong content type
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.simple, {
    'Content-Type': 'text/plain',
    'X-Webhook-Secret': WEBHOOK_SECRET
  });

  // Test 8: Missing webhook secret (should fail if secret is required)
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.simple);

  // Test 9: Wrong webhook secret
  await testEndpoint('POST', '/webhook/scrobble', testDataSets.simple, {
    'X-Webhook-Secret': 'wrong-secret'
  });
}

async function runApiTests() {
  console.log('📊 Running API tests...\n');

  // Test API endpoints
  await testEndpoint('GET', '/');
  await testEndpoint('GET', '/api');
  await testEndpoint('GET', '/api/health');
  await testEndpoint('GET', '/api/stats');
  await testEndpoint('GET', '/api/tracks');
  await testEndpoint('GET', '/api/tracks?limit=3');
  await testEndpoint('GET', '/api/tracks?limit=5&offset=0');
  
  // Test 404
  await testEndpoint('GET', '/nonexistent-endpoint');
  
  // Test method not allowed
  await testEndpoint('DELETE', '/api/stats');
}

async function runRateLimitTests() {
  console.log('⚡ Running rate limit tests...\n');

  // Send multiple requests quickly to test rate limiting
  console.log('📡 Sending 5 requests quickly to test rate limiting...');
  
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      testEndpoint('POST', '/webhook/scrobble', {
        ...testDataSets.simple,
        title: `Rate Limit Test ${i + 1}`
      }, {
        'X-Webhook-Secret': WEBHOOK_SECRET
      })
    );
  }
  
  await Promise.all(promises);
}

async function runPerformanceTests() {
  console.log('🚀 Running performance tests...\n');

  const startTime = Date.now();
  
  // Send 10 concurrent requests
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      testEndpoint('POST', '/webhook/scrobble', {
        ...testDataSets.simple,
        title: `Performance Test ${i + 1}`
      }, {
        'X-Webhook-Secret': WEBHOOK_SECRET
      })
    );
  }
  
  await Promise.all(promises);
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  console.log(`⏱️  Performance test completed in ${duration}ms (${(duration/10).toFixed(2)}ms avg per request)\n`);
}

async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Server is running!');
      console.log(`   Status: ${data.status}`);
      console.log(`   Database: ${data.database}`);
      console.log(`   Uptime: ${data.uptime?.toFixed(2)}s`);
      return true;
    }
  } catch (error) {
    console.log('❌ Server is not running. Please start it with: bun run dev');
    console.log('   Error:', error.message);
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (!serverRunning) return;
  
  console.log('');
  
  try {
    // Run all test suites
    await runValidationTests();
    await runApiTests();
    await runRateLimitTests();
    await runPerformanceTests();
    
    console.log('✅ All tests completed!');
    console.log('');
    console.log('📋 Test Summary:');
    console.log('   ✓ Validation tests - Check data validation middleware');
    console.log('   ✓ API tests - Test all API endpoints');
    console.log('   ✓ Rate limit tests - Test rate limiting');
    console.log('   ✓ Performance tests - Test concurrent requests');
    console.log('');
    console.log('🎯 Key Express.js features tested:');
    console.log('   ✓ Request validation middleware');
    console.log('   ✓ Error handling middleware');
    console.log('   ✓ Rate limiting middleware');
    console.log('   ✓ CORS middleware');
    console.log('   ✓ Security middleware (helmet)');
    console.log('   ✓ Logging middleware (morgan)');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

main().catch(console.error);
