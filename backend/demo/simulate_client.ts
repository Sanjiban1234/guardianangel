import { io as ClientIO } from 'socket.io-client';

// Ensure the server starts in development mode so it listens on the port
process.env.NODE_ENV = 'development';
process.env.PORT = '3000';
process.env.DATABASE_URL = ''; // Force in-memory database mock for standalone demo execution

// Dynamically import server to run it
import '../src/index';

const BASE_URL = 'http://localhost:3000';

// Sleep utility function
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runDemo() {
  console.log('\n======================================================');
  console.log('      STARTING GUARDIAN ANGEL SYNC DEMO SIMULATION    ');
  console.log('======================================================\n');

  await sleep(1500); // Wait for Express & Socket.io server to boot

  // 1. REGISTER TWO RIDERS
  console.log('[Step 1] Registering riders via REST...');
  
  const registerRider = async (username: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password: 'securepassword123',
        phone: '+9779800000000'
      })
    });
    const data = (await res.json()) as any;
    console.log(`  - Register ${username}: status ${res.status}`, data);
    return data;
  };

  await registerRider('rider_sanjiban');
  await registerRider('rider_utsuk');
  await registerRider('rider_intruder_anonymous');

  // 2. LOGIN TO ACQUIRE JWTS
  console.log('\n[Step 2] Logging in riders to fetch authorization JWTs...');
  
  const loginRider = async (username: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'securepassword123' })
    });
    const data = (await res.json()) as any;
    console.log(`  - Login ${username} token:`, data.token ? `${data.token.substring(0, 20)}...` : 'FAILED');
    return data.token;
  };

  const tokenSanjiban = await loginRider('rider_sanjiban');
  const tokenUtsuk = await loginRider('rider_utsuk');
  const tokenIntruder = await loginRider('rider_intruder_anonymous');

  // 3. CREATE A RIDE ROOM (RIDER SANJIBAN)
  console.log('\n[Step 3] rider_sanjiban creates a Ride Room via REST...');
  const createRoomRes = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenSanjiban}`
    }
  });
  const roomData = (await createRoomRes.json()) as any;
  const { room_id, room_token } = roomData;
  console.log(`  - Created Room Token: ${room_token} | Room ID: ${room_id}`);

  // 4. JOIN ROOM REST-SIDE (RIDER UTSUK)
  console.log(`\n[Step 4] rider_utsuk joins Room ${room_token} via REST...`);
  const joinRoomRes = await fetch(`${BASE_URL}/api/rooms/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${tokenUtsuk}`
    },
    body: JSON.stringify({ room_token })
  });
  const joinData = (await joinRoomRes.json()) as any;
  console.log(`  - Join Result:`, joinData);

  // 5. ESTABLISH WEBSOCKET CONNECTIONS (STATE A - ONLINE)
  console.log('\n[Step 5] Connecting WebSockets for both riders...');
  
  const socketSanjiban = ClientIO(BASE_URL, { auth: { token: tokenSanjiban } });
  const socketUtsuk = ClientIO(BASE_URL, { auth: { token: tokenUtsuk } });

  // Listeners for rider_utsuk to prove live broadcasts are received
  socketUtsuk.on('location:broadcast', (data) => {
    console.log(`  ⚡ [LIVE BROADCAST -> rider_utsuk] Position received from ${data.username}:`, {
      lat: data.latitude,
      lng: data.longitude,
      speed: data.speed,
      timestamp: data.timestamp
    });
  });

  socketUtsuk.on('session:member_joined', (data) => {
    console.log(`  👥 [GROUP ALERT] Member joined room: ${data.username}`);
  });

  socketUtsuk.on('peer:lastKnown', (data) => {
    console.log(`  ⚠️ [DISCONNECT ALERT] Member ${data.username} went offline! Last known:`, {
      lat: data.latitude,
      lng: data.longitude
    });
  });

  // Perform socket joins
  await new Promise<void>((resolve) => {
    let joined = 0;
    const checkJoin = () => {
      joined++;
      if (joined === 2) resolve();
    };

    socketSanjiban.on('session:joined', (data) => {
      console.log('  - Socket connected: rider_sanjiban joined room channel');
      checkJoin();
    });

    socketUtsuk.on('session:joined', (data) => {
      console.log('  - Socket connected: rider_utsuk joined room channel');
      checkJoin();
    });

    socketSanjiban.emit('session:join', { room_token });
    socketUtsuk.emit('session:join', { room_token });
  });

  // 6. LIVE TELEMETRY UPDATES (STATE A)
  console.log('\n[Step 6] Simulating live telemetry updates (State A)...');
  
  console.log('  - rider_sanjiban sending position update 1...');
  socketSanjiban.emit('location:update', {
    timestamp: 1720958410000,
    latitude: 27.7007,
    longitude: 85.3001,
    accuracy: 6.2,
    speed: 12.4
  });
  await sleep(400);

  console.log('  - rider_sanjiban sending position update 2...');
  socketSanjiban.emit('location:update', {
    timestamp: 1720958420000,
    latitude: 27.7010,
    longitude: 85.3005,
    accuracy: 5.5,
    speed: 14.8
  });
  await sleep(400);

  // 7. rider_sanjiban DISCONNECTED / GOES OFFLINE (STATE B)
  console.log('\n[Step 7] rider_sanjiban drops offline (State B). Disconnecting socket...');
  socketSanjiban.disconnect();
  await sleep(800); // Allow peer lastKnown broadcast to arrive

  // 8. OFFLINE CACHING BUFFER (STATE B CACHE)
  console.log('\n[Step 8] rider_sanjiban buffers locations locally in SQLite cache (offline mode)...');
  
  // Backlog contains:
  // - Pos 1: timestamp 1720958430000
  // - Pos 2: timestamp 1720958440000
  // - Pos 3: timestamp 1720958440000 (Duplicate timestamp conflict with Pos 2, carries updated coords for LWW conflict validation)
  // - Pos 4: timestamp 1720958450000 (Out-of-order sequence check)
  const localCacheBacklog = [
    { client_reading_id: 'local-read-1', timestamp: 1720958430000, latitude: 27.7015, longitude: 85.3012, accuracy: 5.0, speed: 15.2 },
    { client_reading_id: 'local-read-2', timestamp: 1720958440000, latitude: 27.7020, longitude: 85.3020, accuracy: 4.8, speed: 16.5 },
    { client_reading_id: 'local-read-3', timestamp: 1720958440000, latitude: 27.7022, longitude: 85.3025, accuracy: 4.5, speed: 17.0 }, // Duplicate timestamp conflict, LWW should replace
    { client_reading_id: 'local-read-4', timestamp: 1720958450000, latitude: 27.7028, longitude: 85.3030, accuracy: 4.0, speed: 18.1 }
  ];
  console.log(`  - Generated local cache backlog with ${localCacheBacklog.length} coordinates.`);
  console.log('  - Note: "local-read-3" shares timestamp 1720958440000 with "local-read-2" (tests Last-Write-Wins conflict resolution).');

  // 9. RECONNECT AND BULK SYNC (STATE B -> A)
  console.log('\n[Step 9] rider_sanjiban reconnects online. Syncing backlog...');
  socketSanjiban.connect();

  await new Promise<void>((resolve) => {
    socketSanjiban.on('session:joined', async () => {
      console.log('  - Socket reconnected. Triggering bulk re-sync batch...');
      
      socketSanjiban.emit('telemetry:bulkSync', { readings: localCacheBacklog }, (ack: { confirmedClientReadingIds: string[] }) => {
        console.log('  ✅ [BULK SYNC ACK RECEIVED] Server acknowledged synced ids:', ack.confirmedClientReadingIds);
        resolve();
      });
    });
    
    socketSanjiban.emit('session:join', { room_token });
  });

  await sleep(500);

  // 10. RETRIEVE ROOM HISTORY REST-SIDE & VERIFY CONFLICT RESOLUTION
  console.log('\n[Step 10] Querying room telemetry history via REST to prove synchronization & conflict resolution...');
  const historyRes = await fetch(`${BASE_URL}/api/rooms/${room_id}/history`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${tokenSanjiban}`
    }
  });

  const history = (await historyRes.json()) as any[];
  console.log(`  - Telemetry logs saved on server (sorted chronologically):`);
  
  history.forEach((point: any, idx: number) => {
    console.log(`    [${idx + 1}] User: ${point.username} | Lat: ${point.latitude} | Lng: ${point.longitude} | Speed: ${point.speed} m/s | Time: ${point.device_timestamp}`);
  });

  // Verify Conflict Resolution correctness
  console.log('\n[Verification Check]');
  const t1720958440 = history.filter((p: any) => p.device_timestamp === '1720958440000' && p.username === 'rider_sanjiban');
  
  console.log(`  - Readings at timestamp 1720958440000 found on server: ${t1720958440.length}`);
  if (t1720958440.length === 1) {
    console.log('  ✅ SUCCESS: Duplicate timestamp resolved to a single entry.');
    const resolvedPoint = t1720958440[0];
    console.log(`  - Latitude stored: ${resolvedPoint.latitude} (Expected: 27.7022 from local-read-3)`);
    if (resolvedPoint.latitude === 27.7022) {
      console.log('  ✅ SUCCESS: Conflict resolved correctly using Last-Write-Wins (LWW) by device timestamp!');
    } else {
      console.log('  ❌ FAILURE: Conflict resolved to incorrect coordinates.');
    }
  } else {
    console.log('  ❌ FAILURE: Server stored duplicate rows for identical timestamp.');
  }

  // 11. SECURITY ENFORCEMENT PROOF (NON-MEMBER RETRIEVAL ATTEMPT)
  console.log('\n[Step 11] Proving group-ride isolation security...');
  
  // Generate random room ID simulating an attacker trying to query other room history
  const intruderToken = tokenIntruder;
  const attackRes = await fetch(`${BASE_URL}/api/rooms/${room_id}/history`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${intruderToken}`
    }
  });
  
  console.log(`  - Intruder request status: ${attackRes.status} (Expected: 403 Forbidden)`);
  const attackData = (await attackRes.json()) as any;
  console.log(`  - Intruder response body:`, attackData);
  if (attackRes.status === 403) {
    console.log('  ✅ SUCCESS: Room isolation security verified. Non-members cannot read room data.');
  } else {
    console.log('  ❌ FAILURE: Security leak! Room history accessible to non-members.');
  }

  // CLEANUP AND EXIT
  console.log('\n[Cleanup] Disconnecting sockets and shutting down...');
  socketSanjiban.disconnect();
  socketUtsuk.disconnect();
  await sleep(1000);
  
  console.log('Demo finished successfully.');
  process.exit(0);
}

runDemo().catch(err => {
  console.error('Demo simulation error:', err);
  process.exit(1);
});
