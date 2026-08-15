# Guardian Angel - Cloud Deployment Guide

**Quick Deploy Timeline:** 1-2 hours  
**Target:** Railway (Recommended) or Render  
**Goal:** Get backend + database running in cloud for field testing

---

## Prerequisites

- [x] GitHub repo pushed (✅ Done: `integration/full-merge` branch)
- [ ] Railway account (sign up at railway.app - free tier)
- [ ] Mobile device with test APK
- [ ] 2-3 test devices for field demo

---

## Option 1: Railway Deployment (Recommended - Fastest)

### Step 1: Sign Up (2 minutes)

1. Go to https://railway.app
2. Click "Login" → "Login with GitHub"
3. Authorize Railway to access your GitHub repos

### Step 2: Create New Project (5 minutes)

1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose: **Sanjiban1234/guardianangel**
4. Railway will ask for branch - select: `integration/full-merge`
5. Railway will detect Node.js and start deploying

### Step 3: Add PostgreSQL Database (3 minutes)

1. In your project dashboard, click "New" → "Database" → "Add PostgreSQL"
2. Railway auto-provisions PostgreSQL with PostGIS support
3. Wait for database to provision (1-2 minutes)
4. Database URL will be available as `${{Postgres.DATABASE_URL}}`

### Step 4: Configure Backend Service (5 minutes)

1. Click on the **backend** service (Node.js app)
2. Go to "Settings" → "Root Directory"
   - Set to: `backend`
3. Go to "Variables" tab
4. Click "Raw Editor" and paste:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=CHANGE_THIS_TO_RANDOM_STRING_FOR_PRODUCTION
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=*
MAX_BODY_SIZE=10mb
MAX_BULK_BATCH=500
ENABLE_AUTH_RATE_LIMIT_TEST=false
```

5. **IMPORTANT:** Generate a secure JWT secret:
   ```bash
   # On your local machine, run:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # Copy output and replace JWT_SECRET value
   ```

6. Click "Save"

### Step 5: Trigger Redeploy (2 minutes)

1. Go to "Deployments" tab
2. Click "Deploy" → "Deploy Latest"
3. Wait for build to complete (2-3 minutes)
4. Watch logs for "Server running on port 3000"

### Step 6: Get Public URL (1 minute)

1. Go to "Settings" tab
2. Scroll to "Networking"
3. Click "Generate Domain"
4. Copy the URL: `https://your-app.up.railway.app`

### Step 7: Test Backend Health (1 minute)

```bash
curl https://your-app.up.railway.app/api/health

# Expected response:
# {"status":"healthy","timestamp":1234567890}
```

**If health check passes → Backend deployment complete! ✅**

---

## Option 2: Render Deployment (Alternative)

### Step 1: Sign Up
1. Go to https://render.com
2. Sign in with GitHub

### Step 2: Create Web Service
1. Click "New +" → "Web Service"
2. Connect GitHub repo: `Sanjiban1234/guardianangel`
3. Configure:
   - **Name:** guardianangel-backend
   - **Branch:** integration/full-merge
   - **Root Directory:** backend
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

### Step 3: Add PostgreSQL Database
1. Dashboard → "New +" → "PostgreSQL"
2. **Name:** guardianangel-db
3. **Plan:** Free
4. Wait for provisioning
5. Copy "Internal Database URL"

### Step 4: Set Environment Variables
In Web Service settings → Environment:
```env
DATABASE_URL=<paste-internal-db-url>
JWT_SECRET=<generate-random-secret>
NODE_ENV=production
ALLOWED_ORIGINS=*
PORT=3000
```

### Step 5: Deploy and Test
- Render auto-deploys on push
- Get public URL from dashboard
- Test: `curl https://your-app.onrender.com/api/health`

---

## Database Schema Initialization

**Good news:** The backend auto-creates all tables on first startup!

When your backend starts, it runs `src/db.ts` which executes all `CREATE TABLE IF NOT EXISTS` statements. This includes:

- ✅ users
- ✅ ride_rooms
- ✅ room_members
- ✅ telemetry_readings
- ✅ rider_current_locations
- ✅ crash_candidates
- ✅ emergency_alarms
- ✅ vehicle_breakdowns
- ✅ medical_info
- ✅ device_tokens
- ✅ refill_notifications
- ✅ geofences

**Check logs after first deploy:**
```
Server running on port 3000
Database initialized successfully
```

If you see errors about PostGIS:
1. Railway/Render PostgreSQL includes PostGIS by default
2. If needed, connect to database and run: `CREATE EXTENSION IF NOT EXISTS postgis;`

---

## Update Mobile App Configuration

### Step 1: Update API Base URL

Edit `mobile/src/config/env.ts`:

```typescript
export function getApiBaseUrl(): string {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/+$/, '');
  }
  
  // CHANGE THIS to your Railway/Render URL
  return 'https://guardianangel-production.up.railway.app';  // <-- UPDATE THIS
}
```

### Step 2: Rebuild APK

```bash
cd mobile/android
./gradlew assembleDebug

# APK location:
# app/build/outputs/apk/debug/app-debug.apk
```

### Step 3: Install on Test Devices

```bash
# Connect device via USB or use ADB over WiFi
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Or share APK file directly to devices
```

---

## Smoke Test Checklist

**Test with 2 devices minimum:**

### Basic Connectivity
- [ ] App launches without crash
- [ ] Can reach login screen
- [ ] Backend health check passes in browser: `https://your-url.com/api/health`

### Registration/Login
- [ ] Device 1: Register new account → Success
- [ ] Device 1: Login with credentials → Success, reaches portal
- [ ] Device 2: Register different account → Success

### Room Create/Join
- [ ] Device 1: Tap "Start Ride" → Enter destination → Get 12-char group code
- [ ] Device 2: Tap "Join Ride" → Enter group code → Successfully joins
- [ ] Both devices see each other in room members list

### Location Permissions
- [ ] Both devices: Grant foreground location → Success
- [ ] Both devices: Grant background location → Success (or manual grant in settings)

### Real-Time Tracking
- [ ] Both devices: See map with own location
- [ ] Walk 10-20 meters with Device 1 → Device 2 sees movement on map
- [ ] Walk 10-20 meters with Device 2 → Device 1 sees movement on map
- [ ] Locations update within 10-20 seconds

### Crash Detection
- [ ] Shake Device 1 vigorously → 15-second countdown appears
- [ ] Tap "I'm OK" → Countdown cancels
- [ ] (Optional) Shake Device 1 → Let countdown expire → Device 2 receives SOS alert

### Pass Criteria
**9/11 tests pass = Ready for field demo**

Minor glitches acceptable:
- Location update delay (up to 30 seconds)
- Permission flow requires manual settings adjustment
- One device needs app restart after socket disconnect

---

## Common Issues and Fixes

### Issue: "Network request failed" in mobile app

**Cause:** Backend not reachable or CORS issue

**Fix:**
1. Test backend URL in browser: `https://your-url.com/api/health`
2. Check Railway logs for errors
3. Verify `ALLOWED_ORIGINS=*` is set (for testing - restrict in production)

---

### Issue: "Database connection failed" in backend logs

**Cause:** DATABASE_URL not set correctly

**Fix:**
1. Railway: Use `${{Postgres.DATABASE_URL}}` (Railway variable syntax)
2. Render: Copy "Internal Database URL" from database dashboard
3. Redeploy after fixing

---

### Issue: "No PostGIS extension" error

**Cause:** PostGIS not enabled in database

**Fix:**
```sql
-- Connect to database via Railway SQL client
CREATE EXTENSION IF NOT EXISTS postgis;
```

Or add to `backend/src/db.ts` at the top of `initializeDatabase()`:
```typescript
await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
```

---

### Issue: Mobile app can't connect to socket

**Cause:** Socket.IO endpoint mismatch

**Fix:**
Verify in `mobile/src/config/env.ts`:
```typescript
// Should NOT have trailing /socket.io
return 'https://your-url.com';  // ✅ Correct
// NOT: 'https://your-url.com/socket.io'  // ❌ Wrong
```

---

### Issue: Locations not updating after screen lock

**Cause:** Background location permission not granted

**Fix:**
1. Go to device Settings → Apps → Guardian Angel → Permissions
2. Location → Select "Allow all the time"
3. Restart app

---

### Issue: False crash alerts during normal activity

**Cause:** Thresholds unvalidated (expected)

**Fix:**
- Document as known issue
- Riders can cancel with "I'm OK" button
- Post-submission: Run crash validation protocol to tune thresholds

---

## Environment Variables Reference

### Required
| Variable | Value | Notes |
|----------|-------|-------|
| DATABASE_URL | `${{Postgres.DATABASE_URL}}` | Railway auto-provides |
| JWT_SECRET | Random 32-byte hex | Generate with `crypto.randomBytes(32).toString('hex')` |
| PORT | 3000 | Railway auto-assigns, but 3000 is default |

### Optional
| Variable | Default | Notes |
|----------|---------|-------|
| NODE_ENV | production | Should be "production" for cloud |
| ALLOWED_ORIGINS | * | Restrict to your domain in production |
| MAX_BODY_SIZE | 10mb | Telemetry batch upload limit |
| MAX_BULK_BATCH | 500 | Max telemetry readings per batch |
| ENABLE_AUTH_RATE_LIMIT_TEST | false | Keep false in production |

---

## Field Testing Preparation

### Pre-Test Checklist
- [ ] Backend deployed and health check passes
- [ ] Database initialized (check logs)
- [ ] Mobile APK updated with cloud URL
- [ ] APK installed on 2-3 test devices
- [ ] All devices have GPS enabled
- [ ] All devices have internet connection (mobile data or WiFi)
- [ ] Portable chargers ready (battery drain expected)

### Test Script (30 minutes)
1. **Setup (5 min):** All riders register accounts
2. **Create Room (2 min):** Rider 1 creates room, shares group code
3. **Join Room (3 min):** Others join using group code
4. **Grant Permissions (5 min):** All riders grant location permissions
5. **Start Ride (10 min):** Walk/ride, verify real-time tracking
6. **Safety Demo (3 min):** Trigger crash detection, cancel countdown
7. **End Ride (2 min):** View ride summary

### Expected Results
✅ Core features work (create, join, track, alert)
⚠️ Some false crash alerts (expected, document as known issue)
⚠️ Battery drains faster than normal (expected)
⚠️ Occasional GPS accuracy issues (expected in urban areas)

---

## Cost Estimate

### Railway Free Tier
- $5 credit per month (enough for testing)
- PostgreSQL: Free with limitations (1GB storage)
- Backend: Free with 500 hours/month
- **Cost for testing:** $0 (stays within free tier)

### Render Free Tier
- 750 hours/month free
- PostgreSQL: 1GB free
- **Cost for testing:** $0

**Both platforms are free for testing. Upgrade only if you exceed limits.**

---

## Next Steps After Deployment

### Immediate (Day 1)
1. ✅ Deploy backend to Railway/Render
2. ✅ Update mobile app with cloud URL
3. ✅ Run smoke test with 2 devices
4. ✅ Fix any critical blockers

### Field Test (Day 2)
1. Install APK on 3+ devices
2. Run field test (30-60 minutes)
3. Document all bugs encountered
4. Prepare demo for submission

### Post-Submission
1. Complete crash threshold validation protocol
2. Fix bugs from field testing
3. Optimize battery usage
4. Build release APK (fix path length issue)
5. Add monitoring/analytics
6. Prepare for production launch

---

## Support Resources

**Railway:**
- Docs: https://docs.railway.app
- Discord: https://discord.gg/railway

**Render:**
- Docs: https://render.com/docs
- Community: https://community.render.com

**Guardian Angel:**
- GitHub: https://github.com/Sanjiban1234/guardianangel
- Issues: https://github.com/Sanjiban1234/guardianangel/issues

---

## Deployment Status Checklist

Track your progress:

### Backend
- [ ] Railway/Render account created
- [ ] PostgreSQL database provisioned
- [ ] Backend service deployed
- [ ] Environment variables configured
- [ ] Health check passes
- [ ] Database schema initialized

### Mobile
- [ ] API_BASE_URL updated to cloud URL
- [ ] APK rebuilt with new URL
- [ ] APK installed on test devices

### Testing
- [ ] Smoke test passed (9/11 checks)
- [ ] Field test completed
- [ ] Known issues documented
- [ ] Demo script prepared

---

**Ready to deploy? Start with Railway Step 1 above!**
