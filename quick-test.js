// Quick test สำหรับทดสอบ webhook หลังจากแก้ปัญหา 401
// วิธีใช้: bun run quick-test.js

const BASE_URL = 'http://localhost:3000';

console.log('🧪 Quick Test - Webhook 401 Fix...\n');

// Test data
const testData = {
  title: 'Test Song After Fix',
  artist: 'Test Artist',
  album: 'Test Album',
  duration: 240,
  connector: 'test-fix'
};

async function testWebhook() {
  try {
    console.log('📡 Testing webhook without secret (should work with BYPASS_WEBHOOK_SECRET=true)...');
    
    const response = await fetch(`${BASE_URL}/webhook/scrobble`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testData)
    });

    const responseData = await response.json();
    
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, responseData);
    
    if (response.status === 200) {
      console.log('✅ Success! Webhook is working without secret');
    } else if (response.status === 401) {
      console.log('❌ Still getting 401. Check the following:');
      console.log('   1. Server restarted after .env changes?');
      console.log('   2. BYPASS_WEBHOOK_SECRET=true in .env?');
      console.log('   3. NODE_ENV=development in .env?');
    } else {
      console.log('⚠️ Different error occurred');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

async function testWebhookWithSecret() {
  try {
    console.log('\n📡 Testing webhook with secret...');
    
    const response = await fetch(`${BASE_URL}/webhook/scrobble`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': 'test123'
      },
      body: JSON.stringify({
        ...testData,
        title: 'Test Song With Secret'
      })
    });

    const responseData = await response.json();
    
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, responseData);
    
  } catch (error) {
    console.error('❌ Test with secret failed:', error.message);
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

  await testWebhook();
  await testWebhookWithSecret();
  
  console.log('\n📋 Next steps if still getting 401:');
  console.log('   1. Restart the server: Ctrl+C, then bun run dev');
  console.log('   2. Check .env file has BYPASS_WEBHOOK_SECRET=true');
  console.log('   3. Check web-scrobbler settings');
  console.log('   4. Look at server logs for debug info');
}

main().catch(console.error);
