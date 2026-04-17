// Quick test สำหรับทดสอบ webhook หลังจากแก้ปัญหา 401
// วิธีใช้: bun run quick-test.js

const BASE_URL = 'http://localhost:3000';

console.log('🧪 Quick Test - Webhook Endpoint...\n');

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
    console.log('📡 Sending webhook payload...');
    
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
    
    if (response.ok) {
      console.log('✅ Success! Webhook accepted the payload');
    } else {
      console.log('⚠️ Webhook responded with an error status');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
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
  
  console.log('\n📋 Next steps if requests fail:');
  console.log('   1. Restart the server: Ctrl+C, then bun run dev');
  console.log('   2. Double-check request payload structure');
  console.log('   3. Verify MongoDB connection and server logs for details');
}

main().catch(console.error);
