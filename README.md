# Guardian Angel

Real-time safety platform for group motorcycle rides with crash detection, live tracking, and emergency SOS alerts.

## Tech Stack

- **Mobile**: React Native 0.86 + TypeScript (iOS & Android)
- **Backend**: Node.js + Express + Socket.IO + TypeScript
- **Database**: PostgreSQL with PostGIS
- **Maps**: Google Maps SDK
- **Auth**: JWT with bcryptjs

## Quick Start

### Backend

```bash
cd backend
npm install
npm run dev
```

Create `.env`:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/guardian_angel
JWT_SECRET=your-secret-key
PORT=3000
```

**Requirement**: PostgreSQL with PostGIS extension enabled.

### Mobile

```bash
cd mobile
npm install
npm run android  # or: npm run ios
```

Create `.env`:
```env
API_BASE_URL=http://10.0.2.2:3000
GOOGLE_MAPS_API_KEY=your-google-maps-key
```

## Project Structure

```
backend/          # Node.js server (REST API + WebSocket)
mobile/           # React Native app (telemetry + crash detection)
contracts/        # Shared TypeScript interfaces
docs/             # Architecture docs & ER diagrams
```

## Key Features

- **Crash Detection**: On-device accelerometer/gyroscope monitoring
- **Live Tracking**: Real-time GPS sharing via Socket.IO
- **Group Rooms**: Invite-based ride sessions with 12-hex group codes
- **Medical ID**: Optional emergency medical info (blood group, allergies, contacts)
- **Vehicle Breakdown**: Manual breakdown reporting with reason selection
- **Weather**: Real-time weather data for active ride locations
- **Group Coherence**: Separation detection with reunion guidance
- **Post-Ride Summary**: Distance, duration, and telemetry export

## Testing

```bash
cd backend && npm test  # Backend tests
cd mobile && npm test   # Mobile tests
```

## Physical Device Testing

For WiFi testing on physical devices:

1. Update `mobile/.env`:
   ```env
   API_BASE_URL=http://192.168.1.X:3000  # Your computer's local IP
   ```

2. Allow port 3000 through firewall

3. Connect device and run `npm run android`

## Documentation

- **CLAUDE.md**: Complete project documentation
- **guardian_angel_backend_architecture.md**: Backend architecture details
- **docs/**: ER diagrams, architecture docs, audit reports

## License

MIT License
