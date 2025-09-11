#!/usr/bin/env node

// Test script for Spotify integration
import { config } from 'dotenv';

// Load environment variables
config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

class SpotifyIntegrationTester {
  constructor() {
    this.testResults = [];
  }

  async runTests() {
    console.log('🧪 Testing Spotify Integration...\n');

    try {
      await this.testSpotifyStatus();
      await this.testSpotifyStats();
      await this.testSpotifyEnrichment();
      await this.testSpotifyCache();

      this.printSummary();
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    }
  }

  async testSpotifyStatus() {
    console.log('📋 Testing Spotify Status...');
    
    try {
      const response = await fetch(`${BASE_URL}/api/spotify/status`);
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Spotify Status:', data.configured ? 'Configured' : 'Not Configured');
        console.log(`   Client ID: ${data.client_id_set ? 'Set' : 'Not Set'}`);
        console.log(`   Client Secret: ${data.client_secret_set ? 'Set' : 'Not Set'}`);
        console.log(`   Cache Size: ${data.cache?.size || 0} entries`);
        
        this.testResults.push({ test: 'Spotify Status', status: 'PASS' });
      } else {
        throw new Error(`HTTP ${response.status}: ${data.message}`);
      }
    } catch (error) {
      console.log('❌ Spotify Status test failed:', error.message);
      this.testResults.push({ test: 'Spotify Status', status: 'FAIL', error: error.message });
    }
    
    console.log('');
  }

  async testSpotifyStats() {
    console.log('📊 Testing Spotify Statistics...');
    
    try {
      const response = await fetch(`${BASE_URL}/api/spotify/stats`);
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Spotify Statistics retrieved successfully');
        console.log(`   Total tracks: ${data.total}`);
        console.log(`   Spotify enriched: ${data.spotify_enriched} (${data.enrichment_rate_percent}%)`);
        console.log(`   Search attempted: ${data.spotify_search_attempted}`);
        console.log(`   Matches found: ${data.spotify_match_found} (${data.match_rate_percent}%)`);
        console.log(`   Pending enrichment: ${data.pending_enrichment}`);
        
        this.testResults.push({ test: 'Spotify Stats', status: 'PASS' });
      } else {
        throw new Error(`HTTP ${response.status}: ${data.message}`);
      }
    } catch (error) {
      console.log('❌ Spotify Stats test failed:', error.message);
      this.testResults.push({ test: 'Spotify Stats', status: 'FAIL', error: error.message });
    }
    
    console.log('');
  }

  async testSpotifyEnrichment() {
    console.log('🔍 Testing Spotify Enrichment...');
    
    try {
      // Test with limit parameter
      const response = await fetch(`${BASE_URL}/api/spotify/enrich?limit=5&dryRun=true`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Spotify Enrichment test completed');
        console.log(`   Processed: ${data.processed || 0} tracks`);
        console.log(`   Enriched: ${data.enriched || 0} tracks`);
        console.log(`   Errors: ${data.errors || 0} tracks`);
        console.log(`   Force mode: ${data.force_mode ? 'Yes' : 'No'}`);
        
        this.testResults.push({ test: 'Spotify Enrichment', status: 'PASS' });
      } else if (response.status === 400 && data.error === 'Spotify not configured') {
        console.log('⚠️  Spotify not configured - skipping enrichment test');
        this.testResults.push({ test: 'Spotify Enrichment', status: 'SKIP', reason: 'Not configured' });
      } else {
        throw new Error(`HTTP ${response.status}: ${data.message}`);
      }
    } catch (error) {
      console.log('❌ Spotify Enrichment test failed:', error.message);
      this.testResults.push({ test: 'Spotify Enrichment', status: 'FAIL', error: error.message });
    }
    
    console.log('');
  }

  async testSpotifyCache() {
    console.log('🗑️ Testing Spotify Cache Management...');
    
    try {
      const response = await fetch(`${BASE_URL}/api/spotify/cache`, {
        method: 'DELETE'
      });
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Spotify Cache cleared successfully');
        console.log(`   Cleared entries: ${data.cleared_entries}`);
        
        this.testResults.push({ test: 'Spotify Cache', status: 'PASS' });
      } else {
        throw new Error(`HTTP ${response.status}: ${data.message}`);
      }
    } catch (error) {
      console.log('❌ Spotify Cache test failed:', error.message);
      this.testResults.push({ test: 'Spotify Cache', status: 'FAIL', error: error.message });
    }
    
    console.log('');
  }

  async testSpotifySearch() {
    // This would be an integration test that requires actual Spotify credentials
    // We'll skip it in the basic test suite
    console.log('🔍 Testing Spotify Search (Integration Test)...');
    console.log('⚠️  Skipping Spotify Search test - requires valid credentials');
    console.log('   To test manually: ensure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are set');
    console.log('   Then trigger enrichment via: POST /api/spotify/enrich\n');
  }

  printSummary() {
    console.log('📋 Test Summary:');
    console.log('================');
    
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const skipped = this.testResults.filter(r => r.status === 'SKIP').length;
    
    this.testResults.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
      console.log(`${icon} ${result.test}: ${result.status}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      if (result.reason) {
        console.log(`   Reason: ${result.reason}`);
      }
    });
    
    console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    
    if (failed > 0) {
      console.log('\n❌ Some tests failed. Check your server configuration and try again.');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed successfully!');
    }
  }
}

// Helper function to test individual components
async function testBasicAPI() {
  console.log('🔧 Testing Basic API Endpoints...\n');
  
  try {
    // Test root endpoint
    const rootResponse = await fetch(`${BASE_URL}/`);
    if (rootResponse.ok) {
      console.log('✅ Root endpoint working');
    } else {
      console.log('❌ Root endpoint failed');
    }
    
    // Test health endpoint
    const healthResponse = await fetch(`${BASE_URL}/api/health`);
    if (healthResponse.ok) {
      console.log('✅ Health endpoint working');
    } else {
      console.log('❌ Health endpoint failed');
    }
    
    // Test stats endpoint
    const statsResponse = await fetch(`${BASE_URL}/api/stats`);
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log('✅ Stats endpoint working');
      console.log(`   Total tracks: ${stats.totalTracks}`);
      console.log(`   Spotify configured: ${stats.spotify?.configured ? 'Yes' : 'No'}`);
    } else {
      console.log('❌ Stats endpoint failed');
    }
    
  } catch (error) {
    console.log('❌ Basic API test failed:', error.message);
    console.log('   Make sure the server is running on', BASE_URL);
    process.exit(1);
  }
  
  console.log('');
}

// Run tests
async function main() {
  console.log('🎵 Music Webhook - Spotify Integration Tests');
  console.log('===========================================\n');
  console.log(`Testing server at: ${BASE_URL}\n`);
  
  await testBasicAPI();
  
  const tester = new SpotifyIntegrationTester();
  await tester.runTests();
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Test runner crashed:', error);
    process.exit(1);
  });
}
