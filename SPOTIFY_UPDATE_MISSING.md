# Spotify Missing Data Update Endpoint

## อธิบาย
Endpoint ใหม่ `/api/spotify/update-missing` ถูกสร้างขึ้นเพื่อจัดการการอัพเดทข้อมูล Spotify สำหรับเพลงที่มีอยู่แล้วในฐานข้อมูลแต่ยังขาดข้อมูลบางส่วน

## Endpoint
```
POST /api/spotify/update-missing
```

## Parameters (Query String)

### `limit` (ตัวเลข, ไม่บังคับ)
- **Default**: `50`
- **Maximum**: `100`
- **คำอธิบาย**: จำนวนเพลงที่ต้องการประมวลผลในครั้งหนึ่ง

### `missingOnly` (boolean, ไม่บังคับ)
- **Default**: `false`
- **ค่าที่ใช้ได้**: `true`, `false`
- **คำอธิบาย**: 
  - `true` = ประมวลผลเฉพาะเพลงที่ขาดข้อมูลพื้นฐาน (duration, album, year)
  - `false` = ประมวลผลเพลงทั้งหมดที่ยังไม่ได้ค้นหาใน Spotify

### `force` (boolean, ไม่บังคับ)
- **Default**: `false`
- **ค่าที่ใช้ได้**: `true`, `false`
- **คำอธิบาย**: 
  - `true` = บังคับ update ทุกเพลงแม้ว่าจะเคยค้นหาแล้ว
  - `false` = ประมวลผลเฉพาะที่ยังไม่เคยค้นหา

### `priority` (string, ไม่บังคับ)
- **Default**: `"duration,album,year"`
- **คำอธิบาย**: กำหนด fields ที่ต้องการให้ความสำคัญ (คั่นด้วยจุลภาค)
- **ตัวเลือก**: `duration`, `album`, `year`, `trackNumber`

## ตัวอย่างการใช้งาน

### 1. อัพเดทเพลงที่ขาดข้อมูลพื้นฐาน (แนะนำ)
```bash
curl -X POST "http://localhost:3000/api/spotify/update-missing?missingOnly=true&limit=30"
```

### 2. อัพเดทเพลงใหม่ที่ยังไม่ได้ค้นหา Spotify
```bash
curl -X POST "http://localhost:3000/api/spotify/update-missing?limit=50"
```

### 3. บังคับ update ทุกเพลง (ใช้ระวัง - อาจใช้เวลานาน)
```bash
curl -X POST "http://localhost:3000/api/spotify/update-missing?force=true&limit=10"
```

### 4. เฉพาะเพลงที่ขาด duration
```bash
curl -X POST "http://localhost:3000/api/spotify/update-missing?missingOnly=true&priority=duration&limit=50"
```

## Response Format

### สำเร็จ (200 OK)
```json
{
  "success": true,
  "message": "Spotify data update completed",
  "processed": 30,
  "enriched": 25,
  "no_match": 3,
  "errors": 2,
  "fields_updated": {
    "duration": 20,
    "album": 15,
    "year": 18,
    "trackNumber": 12
  },
  "updated_fields_summary": "duration: 20, album: 15, year: 18, trackNumber: 12",
  "query_options": {
    "limit": 30,
    "missing_data_only": true,
    "force_update": false,
    "priority_fields": "duration,album,year"
  }
}
```

### ไม่มีเพลงที่ต้อง update (200 OK)
```json
{
  "message": "No tracks need Spotify data update",
  "query_type": "missing_basic_data",
  "processed": 0
}
```

### ข้อผิดพลาด (400 Bad Request)
```json
{
  "error": "Spotify not configured",
  "message": "Please configure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET"
}
```

## การทำงานภายใน

1. **Query Building**: สร้าง MongoDB query ตาม parameters ที่ส่งมา
2. **Track Selection**: เลือกเพลงที่ตรงตามเงื่อนไข เรียงตามวันที่ scrobble ล่าสุด
3. **Spotify Enrichment**: เรียกใช้ `enrichWithSpotifyData()` สำหรับแต่ละเพลง
4. **Field Tracking**: ติดตามว่า field ไหนถูกเพิ่มข้อมูล
5. **Rate Limiting**: ระหว่างแต่ละเพลงจะหน่วงเวลา 200ms เพื่อไม่ให้ Spotify API เกินขิด
6. **Statistics**: รวบรวมสถิติและส่งกลับ

## ข้อแตกต่างจาก `/api/spotify/enrich`

| Feature | `/api/spotify/enrich` | `/api/spotify/update-missing` |
|---------|----------------------|------------------------------|
| **วัตถุประสงค์** | Enrich เพลงใหม่ | อัพเดทข้อมูลเดิมที่ขาดหายไป |
| **การเลือกเพลง** | ยังไม่ได้ Spotify data | ขาดข้อมูลพื้นฐาน หรือยังไม่ค้นหา |
| **Field Tracking** | ไม่มี | มีการติดตามว่า field ไหนถูกเพิ่ม |
| **Query Options** | Basic | ละเอียด (missingOnly, priority) |
| **Rate Limiting** | 100ms | 200ms |
| **Statistics** | Basic | ครอบคลุม |

## Best Practices

1. **เริ่มต้นด้วย missingOnly=true**: เพื่อเติมข้อมูลพื้นฐานที่ขาดหายไป
2. **ใช้ limit เหมาะสม**: 30-50 เพลงต่อครั้งเพื่อไม่ให้ใช้เวลานาน
3. **ตรวจสอบ Spotify quota**: ถ้าใช้บ่อยให้ระวังการเกิน rate limit
4. **ใช้ force=true ระวัง**: เพราะจะประมวลผลทุกเพลงซ้ำ

## Monitoring

ตรวจสอบ logs ใน console สำหรับ:
- `🔄 Starting Spotify data update...`
- `🎵 Found X tracks that need Spotify data update`
- `🔍 Processing: Artist - Title`
- `✅ Successfully enriched` / `❌ No Spotify match`
- `🎉 Spotify update completed`

## Environment Variables ที่จำเป็น

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_FETCH_AUDIO_FEATURES=true  # ไม่บังคับ
```
