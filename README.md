# Music Webhook Server (Express.js + Bun.js)

Webhook server สำหรับรับข้อมูลจาก web-scrobbler และบันทึกลง MongoDB โดยใช้ Express.js framework บน Bun.js runtime

## Features

- 🎵 รับข้อมูลการเล่นเพลงจาก web-scrobbler
- 💾 บันทึกข้อมูลลง MongoDB
- 🎧 **Spotify API Integration** - เพิ่มข้อมูลเพลงจาก Spotify อัตโนมัติ
- 📊 API สำหรับดูสถิติและข้อมูลเพลง
- 🚀 ใช้ Express.js framework บน Bun.js runtime
- 🔒 รองรับ webhook secret สำหรับความปลอดภัย
- 🌐 CORS support
- 🛡️ Security middleware (Helmet)
- ⚡ Rate limiting
- 📝 Request logging (Morgan)
- ✅ Data validation middleware
- 🔄 Error handling middleware
- 📈 Performance monitoring
- 🗂️ Intelligent duplicate prevention
- 🔍 Smart search matching
- 💿 Album artwork และ metadata enrichment

## Installation

1. Clone หรือ download โปรเจค
2. ติดตั้ง dependencies:
```bash
cd music-webhook
bun install
```

3. ตั้งค่า environment variables ในไฟล์ `.env` (คัดลอกจาก .env.example):
```env
# Server Configuration
PORT=3000
HOST=localhost

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/music-scrobbler

# API Configuration
WEBHOOK_SECRET=your-webhook-secret-key-here
API_KEY=your-api-key-here

# Environment
NODE_ENV=development

# Spotify API Configuration (ส่วนเสริม - ดูตัวอย่างข้างล่าง)
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
SPOTIFY_FETCH_AUDIO_FEATURES=false
```

4. (เสริม) ตั้งค่า Spotify API:
   - ไปที่ [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - สร้าง App ใหม่
   - คัดลอก Client ID และ Client Secret มาใส่ใน .env

5. ตรวจสอบว่า MongoDB ทำงานอยู่

## Usage

### เริ่มต้น Development Server
```bash
bun run dev
```

### เริ่มต้น Production Server
```bash
bun run start
```

### ทดสอบ Webhook
```bash
bun run test
```

### ทดสอบ Spotify Update Missing Data
```bash
# ทดสอบ endpoint ใหม่
 bun run test:update-missing

# ทดสอบแบบต่างๆ
 bun run test:update-missing missingOnly  # เฉพาะที่ขาดข้อมูล
 bun run test:update-missing durationOnly # เฉพาะที่ขาด duration
 bun run test:update-missing all         # ทดสอบทุกรูปแบบ
```

## API Endpoints

### Webhook Endpoints
- `POST /webhook/scrobble` - รับข้อมูลจาก web-scrobbler
- `POST /webhook` - alternative endpoint

### API Endpoints
- `GET /api/stats` - ดู statistics และ Spotify enrichment stats
- `GET /api/tracks` - ดูเพลงล่าสุด (supports ?limit=50&offset=0)
- `GET /api/health` - health check
- `GET /api` - API information
- `GET /` - API documentation

### Spotify Integration Endpoints
- `GET /api/spotify/status` - ดูสถานะ Spotify integration
- `GET /api/spotify/stats` - สถิติ Spotify enrichment
- `POST /api/spotify/enrich` - enrichment ข้อมูลด้วยตัวเอง (?limit=10&force=true)
- `POST /api/spotify/update-missing` - อัพเดทข้อมูลเดิมที่ยังขาดข้อมูล (?limit=50&missingOnly=true&priority=duration,album,year)
- `DELETE /api/spotify/cache` - ล้าง Spotify search cache

### Duplicate Management Endpoints
- `GET /api/duplicates` - ดูสถิติ duplicate tracks
- `DELETE /api/duplicates` - ลบ duplicate tracks (?dryRun=true สำหรับ preview)

## Express.js Middleware Stack

Server ใช้ middleware หลายชั้นเพื่อความปลอดภัยและประสิทธิภาพ:

### Security Middleware
- **Helmet**: ป้องกัน security vulnerabilities
- **CORS**: จัดการ Cross-Origin Resource Sharing
- **Rate Limiting**: จำกัดการเรียก API ต่อหน่วยเวลา

### Validation Middleware
- **Content-Type Validation**: ตรวจสอบ request format
- **Track Data Validation**: ตรวจสอบข้อมูลเพลงที่จำเป็น
- **Field Length Validation**: ตรวจสอบความยาวของข้อมูล

### Logging Middleware
- **Morgan**: HTTP request logging
- **Custom Request Logger**: ติดตาม request และ response time
- **Rate Limit Info**: แสดงข้อมูล rate limit

### Error Handling
- **Global Error Handler**: จัดการ errors ทั้งหมด
- **404 Handler**: จัดการ endpoints ที่ไม่มี
- **Async Error Handler**: จัดการ async function errors

## Spotify Integration

### ความสามารถ
- ค้นหาข้อมูลเพลงจาก Spotify API อัตโนมัติ
- เพิ่มข้อมูล: album artwork, release date, popularity, preview URL
- Smart search matching ด้วย fuzzy matching algorithm
- Search result caching เพื่อลดการเรียก API ซ้ำ
- สนับสนุน audio features (ส่วนเสริม)

### การตั้งค่า
1. ไปที่ [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. กด "Create app"
3. ตั้งชื่อและคำอธิบายสำหรับ app
4. คัดลอก **Client ID** และ **Client Secret**
5. ใส่ในไฟล์ .env:
```env
SPOTIFY_CLIENT_ID=your_actual_client_id
SPOTIFY_CLIENT_SECRET=your_actual_client_secret
SPOTIFY_FETCH_AUDIO_FEATURES=false  # true สำหรับ audio features
```

### การทำงาน
- Enrichment ทำงานอัตโนมัติเมื่อมี track ใหม่เข้ามา
- สามารถ enrichment ด้วยตัวเองผ่าน API: `POST /api/spotify/enrich`
- ดูสถิติการ enrichment: `GET /api/spotify/stats`

### ตัวอย่างการใช้งาน
```bash
# ดูสถานะ Spotify integration
curl http://localhost:3000/api/spotify/status

# Enrichment ข้อมูล 10 tracks ล่าสุด
curl -X POST "http://localhost:3000/api/spotify/enrich?limit=10"

# อัพเดทข้อมูลเดิมที่ขาดข้อมูลพื้นฐาน (แนะนำ)
curl -X POST "http://localhost:3000/api/spotify/update-missing?missingOnly=true&limit=30"

# ดูสถิติ Spotify
curl http://localhost:3000/api/spotify/stats
```

## Web-Scrobbler Configuration

1. ติดตั้ง web-scrobbler extension
2. ไปที่ settings > Connectors
3. เพิ่ม webhook URL: `http://localhost:3000/webhook/scrobble`
4. ตั้งค่า secret key ใน header `X-Webhook-Secret`

## ตัวอย่างข้อมูลที่ส่งมา

### จาก web-scrobbler (Standard format):
```json
{
  "track": {
    "title": "Song Title",
    "artist": "Artist Name",
    "album": "Album Name",
    "duration": 240,
    "url": "https://music.platform.com/track/123"
  },
  "connector": "spotify",
  "timestamp": 1645123456
}
```

### แบบง่าย (Simple format):
```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 240,
  "connector": "youtube"
}
```

### Now Playing format:
```json
{
  "nowPlaying": {
    "title": "Now Playing Song",
    "artist": "Artist Name",
    "album": "Album Name"
  },
  "source": "spotify"
}
```

## API Response Examples

### POST /webhook/scrobble (พร้อม Spotify enrichment)
```json
{
  "success": true,
  "message": "Track saved successfully",
  "trackId": "60f1b2b3c4d5e6f7a8b9c0d1",
  "action": "created",
  "spotify_configured": true,
  "spotify_enrichment_queued": true,
  "track": {
    "artist": "Artist Name",
    "title": "Song Title",
    "album": "Album Name",
    "timestamp": "2023-07-10T10:30:00.000Z",
    "spotify_enriched": false,
    "spotify_data": null
  }
}
```

### GET /api/stats (รวม Spotify statistics)
```json
{
  "totalTracks": 1250,
  "topArtists": [
    { "artist": "Artist 1", "playCount": 45 },
    { "artist": "Artist 2", "playCount": 32 }
  ],
  "recentActivity": [...],
  "lastScrobble": "2023-07-10T10:30:00.000Z",
  "spotify": {
    "configured": true,
    "total": 1250,
    "spotify_enriched": 892,
    "spotify_search_attempted": 1100,
    "spotify_match_found": 892,
    "enrichment_rate": 71,
    "match_rate": 81,
    "pending": 150
  }
}
```

### GET /api/spotify/status
```json
{
  "configured": true,
  "client_id_set": true,
  "client_secret_set": true,
  "audio_features_enabled": false,
  "cache": {
    "size": 128,
    "cacheTimeout": 1800000,
    "isConfigured": true,
    "hasValidToken": true
  },
  "message": "Spotify integration is configured and ready"
}
```

### GET /api/spotify/stats
```json
{
  "total": 1250,
  "spotify_enriched": 892,
  "spotify_search_attempted": 1100,
  "spotify_match_found": 892,
  "enrichment_rate_percent": 71,
  "match_rate_percent": 81,
  "pending_enrichment": 150,
  "cache_stats": {
    "size": 128,
    "cacheTimeout": 1800000
  }
}
```

### POST /api/spotify/enrich
```json
{
  "message": "Spotify enrichment completed",
  "processed": 10,
  "enriched": 8,
  "errors": 2,
  "force_mode": false
}
```

## MongoDB Schema

ข้อมูลเพลงจะถูกเก็บใน MongoDB ด้วย schema ต่อไปนี้:

```javascript
{
  // ข้อมูลพื้นฐาน
  title: String,        // ชื่อเพลง
  artist: String,       // ชื่อศิลปิน  
  album: String,        // ชื่ออัลบั้ม
  albumArtist: String,  // ศิลปินอัลบั้ม
  genre: String,        // ประเภทเพลง
  year: Number,         // ปีที่ออก
  trackNumber: Number,  // หมายเลขเพลงในอัลบั้ม
  duration: Number,     // ความยาว (วินาที)
  timestamp: Date,      // เวลาที่เล่น
  source: String,       // แหล่งที่มา (web-scrobbler, spotify, etc.)
  connector: String,    // platform (youtube, spotify, etc.)
  originalUrl: String,  // URL ต้นฉบับ
  isLoved: Boolean,     // เพลงที่ชอบ
  playCount: Number,    // จำนวนครั้งที่เล่น
  userAgent: String,    // User agent ของ client
  ipAddress: String,    // IP address ของ client
  rawData: Object,      // ข้อมูลดิบที่ได้รับ
  
  // ข้อมูลจาก Spotify API
  spotify: {
    id: String,                    // Spotify track ID
    uri: String,                   // Spotify URI
    url: String,                   // Spotify URL
    popularity: Number,            // ความนิยม (0-100)
    preview_url: String,           // URL สำหรับฟังตัวอย่าง
    duration_ms: Number,           // ความยาว (มิลลิวินาที)
    explicit: Boolean,             // มีเนื้อหาไม่เหมาะ
    track_number: Number,          // ลำดับเพลงในอัลบั้ม
    
    // ข้อมูลศิลปิน
    artist: {
      id: String,                  // Spotify artist ID
      name: String,                // ชื่อศิลปิน
      uri: String,                 // Spotify artist URI
      url: String                  // Spotify artist URL
    },
    
    // ข้อมูลอัลบั้ม
    album: {
      id: String,                  // Spotify album ID
      name: String,                // ชื่ออัลบั้ม
      uri: String,                 // Spotify album URI
      url: String,                 // Spotify album URL
      release_date: String,        // วันที่ออก
      total_tracks: Number,        // จำนวนเพลงในอัลบั้ม
      album_type: String,          // ประเภทอัลบั้ม (album, single, compilation)
      images: [{                   // รูปภาพปกอัลบั้ม
        url: String,
        height: Number,
        width: Number
      }]
    },
    
    // Audio features (ส่วนเสริม)
    audio_features: {
      danceability: Number,        // ความเหมาะสำหรับเต้นรำ (0-1)
      energy: Number,              // พลังงาน (0-1)
      valence: Number,             // ความเป็นบวก/เศร้า (0-1)
      tempo: Number,               // BPM
      // ... audio features อื่นๆ
    },
    
    search_confidence: Number,     // คะแนนความตรง (0-1)
    fetched_at: Date              // เวลาที่ดึงข้อมูล
  },
  
  // Spotify enrichment status
  spotify_enriched: Boolean,       // มีข้อมูล Spotify แล้ว
  spotify_search_attempted: Boolean, // เคยค้นหาแล้ว
  spotify_match_found: Boolean     // เจอข้อมูลใน Spotify
}
```

## Security

### Webhook Security
- ใช้ `WEBHOOK_SECRET` ในการยืนยันตัวตน
- ส่ง secret ใน header `X-Webhook-Secret` หรือ `Authorization`
- Server จะตรวจสอบ secret ก่อนประมวลผลข้อมูล

### API Security
- Rate limiting: 1000 requests ต่อ 15 นาที
- Webhook rate limiting: 100 requests ต่อนาที
- Helmet middleware สำหรับ security headers
- Input validation และ sanitization

### Environment Variables
```env
# Server Configuration
PORT=3000
HOST=localhost

# Database
MONGODB_URI=mongodb://localhost:27017/music-scrobbler

# Security
WEBHOOK_SECRET=your-secure-secret-here
API_KEY=your-api-key-here

# CORS (optional)
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

## Development

### โครงสร้างโปรเจค
```
music-webhook/
├── config/
│   └── database.js      # MongoDB connection
├── models/
│   └── Track.js         # Track schema และ methods
├── routes/
│   └── webhook.js       # API routes และ handlers
├── middleware/
│   └── validation.js    # Custom middleware
├── index.js             # Main Express application
├── test-webhook.js      # Test script
└── README.md           # Documentation
```

### การ Debug
- ข้อมูลที่เข้ามาจะแสดงใน console
- Morgan middleware สำหรับ HTTP request logging
- Custom logging สำหรับ response times และ rate limits

### การเพิ่ม Features
- เพิ่ม routes ใหม่ใน `routes/webhook.js`
- สร้าง middleware ใหม่ใน `middleware/`
- แก้ไข MongoDB schema ใน `models/Track.js`
- เพิ่ม validation rules ใน `middleware/validation.js`

### การทดสอบ
```bash
# ทดสอบทั้งหมด
bun run test

# ทดสอบเฉพาะ validation
curl -X POST http://localhost:3000/webhook/scrobble \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{"title":"Test","artist":"Test Artist"}'
```

## Troubleshooting

### MongoDB Connection Issues
```bash
# ตรวจสอบว่า MongoDB ทำงาน
mongosh
# หรือ
brew services start mongodb-community
```

### Port Already in Use
```bash
# หา process ที่ใช้ port
lsof -i :3000
# ปิด process
kill -9 <PID>
```

### Rate Limit Issues
- ตรวจสอบ headers `X-RateLimit-Remaining`
- รอให้ window ผ่านไป (15 นาทีสำหรับ general API, 1 นาทีสำหรับ webhook)

### Validation Errors
- ตรวจสอบว่าส่ง `title` และ `artist` มา
- ตรวจสอบ Content-Type header
- ตรวจสอบความยาวของข้อมูล (title < 500, artist < 200 chars)

### Spotify Integration Issues

#### Spotify API Credentials
```bash
# ตรวจสอบสถานะ Spotify integration
curl http://localhost:3000/api/spotify/status

# ตรวจสอบ environment variables
echo $SPOTIFY_CLIENT_ID
echo $SPOTIFY_CLIENT_SECRET
```

**ปัญหาที่พบบ่อย:**
- `"configured": false` - ตั้งค่า SPOTIFY_CLIENT_ID และ SPOTIFY_CLIENT_SECRET
- `"client_id_set": false` - ตรวจสอบ environment variable
- `"hasValidToken": false` - Credentials ไม่ถูกต้องหรือหมดอายุ

#### Spotify API Rate Limiting
ถ้าเจอ error เกี่ยวกับ rate limiting:
```bash
# ล้าง cache และรอสักครู่
curl -X DELETE http://localhost:3000/api/spotify/cache

# ลดจำนวน tracks ที่ enrich ในแต่ละครั้ง
curl -X POST "http://localhost:3000/api/spotify/enrich?limit=5"
```

#### Spotify Search Not Finding Matches
สาเหตุที่อาจไม่เจอข้อมูล:
- ชื่อเพลงหรือศิลปินไม่ตรงกับ Spotify database
- มีตัวอักษรพิเศษหรือ characters ที่เป็นปัญหา
- ชื่อเพลงมี variations หรือ remixes ที่คล้ายกัน

#### Performance Issues
ถ้า enrichment ช้าเกินไป:
```bash
# ลดจำนวน tracks ที่ process ในแต่ละครั้ง
curl -X POST "http://localhost:3000/api/spotify/enrich?limit=5"

# ปิด audio features (ถ้าเปิดอยู่)
SPOTIFY_FETCH_AUDIO_FEATURES=false
```

### Debug Tips

#### เปิด Debug Mode
ในไฟล์ .env:
```env
NODE_ENV=development
DEBUG_WEBHOOKS=true
DEBUG_VALIDATION=true
```

#### ตรวจสอบ Logs
```bash
# ดู server logs ใน real-time
tail -f logs/access.log  # ถ้ามี

# หรือดูจาก console ถ้ารัน server ด้วย terminal
```

#### ทดสอบ Endpoints
```bash
# ทดสอบ Spotify integration
bun run test:spotify

# ทดสอบ webhook ทั้งหมด
bun run test:all

# ทดสอบด้วยตัวเอง
curl -X POST http://localhost:3000/webhook/scrobble \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{"title":"Test Song","artist":"Test Artist"}'
```

## Dependencies

### Core Dependencies
- **express**: Web framework
- **mongoose**: MongoDB ODM
- **cors**: CORS middleware  
- **dotenv**: Environment variables
- **morgan**: HTTP request logger
- **helmet**: Security middleware
- **express-rate-limit**: Rate limiting

### Runtime
- **Bun.js**: JavaScript runtime (fast performance)

## Performance

### Optimizations
- Express.js มี built-in performance optimizations
- MongoDB indexing สำหรับ queries ที่ใช้บ่อย
- Rate limiting เพื่อป้องกัน overload
- Efficient error handling
- Connection pooling สำหรับ MongoDB

### Monitoring
- Request/response time logging
- Rate limit monitoring
- Error tracking
- Database connection health checks

## License

MIT License
