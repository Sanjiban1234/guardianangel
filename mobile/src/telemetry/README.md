# Telemetry Ingestion & Local Cache Module — Guardian Angel Mobile

This module owns continuous background GPS sampling, offline SQLite caching, reachability monitoring, and bulk re-sync for Guardian Angel group rides.

---

## Developer Guide for Person 2 (Crash Detection) & Person 4 (Live Map UI)

### 1. Import & Instantiate

```typescript
import { TelemetryModule } from './src/telemetry';

// Instantiate telemetry module
const telemetry = new TelemetryModule();

// Start telemetry for a ride session
await telemetry.start({
  socketUrl: 'https://api.guardianangel.app',
  authToken: userJwtToken,
  groupCode: 'RIDE11ABCDEF1234',
  healthEndpointUrl: 'https://api.guardianangel.app/api/health',
});
```

### 2. Subscribe to Telemetry Readings (Person 2 & Person 4)

```typescript
// Subscribable stream of raw GPS samples (fires online AND offline)
const unsubscribeReadings = telemetry.onReading((reading) => {
  console.log('GPS sample:', reading.latitude, reading.longitude, reading.speed);
  // Person 2: Feed sample to crash detection algorithm buffer
  // Person 4: Update rider's own map marker
});
```

### 3. Subscribe to Connectivity State (Person 4 UI Banner)

```typescript
// Subscribable online/offline status stream
const unsubscribeStatus = telemetry.onConnectivityChange((status) => {
  if (status === 'online') {
    // UI: Display green "Live" badge
  } else {
    // UI: Display amber "Offline — Local Cache Active" banner
  }
});
```

### 4. Stop Session

```typescript
// Stop background sampling cleanly when ride ends
await telemetry.stop();
```

---

## Library Selection Justification & Platform Setup Guide

### 1. Background GPS Sampling (`react-native-background-geolocation`)
Chosen over simple `react-native-location` / JS-level timers because standard timers freeze when iOS/Android background or lock the phone during multi-hour motorcycling rides.

#### Android Setup (`android/app/src/main/AndroidManifest.xml`)
Required permissions:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" /> <!-- Android 14+ -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />           <!-- Android 13+ -->
```

Persistent notification configuration is handled inside `BackgroundGeolocationProvider.ts` with sticky title *"Guardian Angel Active Ride Safety"*.

#### iOS Setup (`ios/GuardianAngelMobile/Info.plist`)
Required background keys and descriptions:
```xml
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Guardian Angel tracks your location during group rides to ensure safety and detect crashes.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Guardian Angel uses your location for group ride navigation.</string>
<key>NSLocationAlwaysUsageDescription</key>
<string>Guardian Angel requires location access in the background during rides.</string>
```

---

### 2. Local Cache (`op-sqlite`)
Chosen for synchronous C++ JSI speed (~10x faster execution than traditional bridge SQLite) and ACID transaction support (`db.transaction()`).

#### Table Schema (`telemetry_cache`)
```sql
CREATE TABLE IF NOT EXISTS telemetry_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_reading_id TEXT UNIQUE NOT NULL,
  timestamp INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL NOT NULL,
  speed REAL NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_synced_ts ON telemetry_cache (synced, timestamp ASC);
```

---

## Contract Alignment Verification Report

The WebSocket contract in `contracts/websocket-events.ts` and `contracts/websocket-events.md` was audited against this implementation:

1. **Authentication**: `auth: { token }` passed at connection time. **[Matched]**
2. **`session:join`**: `{ group_code }` sent upon starting. **[Matched]**
3. **`location:update`**: Payload shape `{ timestamp, latitude, longitude, accuracy, speed }`. **[Matched]**
4. **`telemetry:bulkSync`**: Batch payload `{ readings: [{ client_reading_id, timestamp, latitude, longitude, accuracy, speed }] }`, capped at 500 readings per batch. `client_reading_id` generates standard RFC4122 v4 UUID strings to satisfy backend PostgreSQL `uuid` column type casting (`jsonb_to_recordset`). **[Matched]**
5. **`telemetry:bulkSyncAck`**: Response `{ confirmedClientReadingIds: string[] }`. Local SQLite rows marked synced ONLY for IDs in `confirmedClientReadingIds`. **[Matched]**
