import crypto from 'crypto';

/**
 * In-memory tables used when no PostgreSQL database is available.
 */
interface InMemoryStore {
  users: any[];
  ride_rooms: any[];
  room_members: any[];
  telemetry_readings: any[];
  emergency_alerts: any[];
  weather_reports: any[];
}

/**
 * MockDatabase — a fully self-contained in-memory SQL mock engine.
 * Failure of any mock handler returns an empty row set and logs a warning.
 * It never throws; the QueryRunner's try/catch therefore never needs to
 * worry about cascading failures from here.
 */
export class MockDatabase {
  private store: InMemoryStore = {
    users: [],
    ride_rooms: [],
    room_members: [],
    telemetry_readings: [],
    emergency_alerts: [],
    weather_reports: [],
  };

  /** Main dispatcher — maps a SQL string to the correct in-memory handler */
  handle(text: string, params: any[]): { rows: any[] } {
    const q = text.replace(/\s+/g, ' ').trim();
    try {
      return this.dispatch(q, params);
    } catch (err) {
      // Surface unique-constraint violations as real errors; swallow the rest
      if (err instanceof Error && err.message.includes('duplicate key')) {
        throw err;
      }
      console.warn('MockDatabase: unhandled query structure →', q);
      return { rows: [] };
    }
  }

  // ─── Private dispatch ────────────────────────────────────────────────────

  private dispatch(q: string, params: any[]): { rows: any[] } {
    // Users
    if (q.startsWith('SELECT id FROM users WHERE username ='))
      return this.selectUserIdByUsername(params);
    if (q.startsWith('INSERT INTO users'))
      return this.insertUser(params);
    if (q.startsWith('SELECT * FROM users WHERE username ='))
      return this.selectUserByUsername(params);

    // Ride Rooms
    if (q.startsWith('INSERT INTO ride_rooms'))
      return this.insertRideRoom(params);
    if (q.startsWith('SELECT id, status FROM ride_rooms WHERE room_token ='))
      return this.selectRoomByToken(params);

    // Room Members
    if (q.startsWith('INSERT INTO room_members'))
      return this.insertRoomMember(params);
    if (q.startsWith('SELECT 1 FROM room_members WHERE room_id ='))
      return this.checkMembership(params);
    if (q.includes('FROM ride_rooms r JOIN room_members m') && q.includes('r.room_token = $1 AND m.user_id = $2'))
      return this.selectRoomWithMembership(params);
    if (q.includes('FROM room_members m JOIN users u') && q.includes('m.room_id = $1'))
      return this.selectRoomMembers(params);

    // Telemetry
    if (q.startsWith('INSERT INTO telemetry_readings'))
      return this.upsertTelemetry(params);
    if (q.includes('FROM telemetry_readings t JOIN users u') && q.includes('t.room_id = $1'))
      return this.selectRoomTelemetry(params);
    if (q.includes('FROM telemetry_readings WHERE user_id =') && q.includes('ORDER BY device_timestamp DESC LIMIT 1'))
      return this.selectLastTelemetry(params);

    // Emergency Alerts
    if (q.startsWith('INSERT INTO emergency_alerts'))
      return this.insertEmergencyAlert(params);

    console.warn('MockDatabase: unrecognised query →', q);
    return { rows: [] };
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  private selectUserIdByUsername(params: any[]): { rows: any[] } {
    const user = this.store.users.find((u) => u.username === params[0]);
    return { rows: user ? [{ id: user.id }] : [] };
  }

  private insertUser(params: any[]): { rows: any[] } {
    const [username, password_hash, phone] = params;
    if (this.store.users.some((u) => u.username === username)) {
      throw new Error('duplicate key value violates unique constraint "users_username_key"');
    }
    const newUser = {
      id: crypto.randomUUID(),
      username,
      password_hash,
      phone,
      created_at: new Date(),
    };
    this.store.users.push(newUser);
    return { rows: [{ id: newUser.id, username: newUser.username }] };
  }

  private selectUserByUsername(params: any[]): { rows: any[] } {
    const user = this.store.users.find((u) => u.username === params[0]);
    return { rows: user ? [user] : [] };
  }

  // ─── Ride Rooms ──────────────────────────────────────────────────────────

  private insertRideRoom(params: any[]): { rows: any[] } {
    const newRoom = {
      id: crypto.randomUUID(),
      room_token: params[0],
      creator_id: params[1],
      status: 'active',
      created_at: new Date(),
      ended_at: null,
    };
    this.store.ride_rooms.push(newRoom);
    return { rows: [newRoom] };
  }

  private selectRoomByToken(params: any[]): { rows: any[] } {
    const room = this.store.ride_rooms.find((r) => r.room_token === params[0]);
    return { rows: room ? [room] : [] };
  }

  // ─── Room Members ─────────────────────────────────────────────────────────

  private insertRoomMember(params: any[]): { rows: any[] } {
    const [room_id, user_id] = params;
    const exists = this.store.room_members.some(
      (m) => m.room_id === room_id && m.user_id === user_id
    );
    if (!exists) {
      this.store.room_members.push({ room_id, user_id, joined_at: new Date() });
    }
    return { rows: [] };
  }

  private checkMembership(params: any[]): { rows: any[] } {
    const [room_id, user_id] = params;
    const isMember = this.store.room_members.some(
      (m) => m.room_id === room_id && m.user_id === user_id
    );
    return { rows: isMember ? [{ '1': 1 }] : [] };
  }

  private selectRoomWithMembership(params: any[]): { rows: any[] } {
    const [roomToken, userId] = params;
    const room = this.store.ride_rooms.find((r) => r.room_token === roomToken);
    if (!room) return { rows: [] };
    const isMember = this.store.room_members.some(
      (m) => m.room_id === room.id && m.user_id === userId
    );
    return { rows: isMember ? [room] : [] };
  }

  private selectRoomMembers(params: any[]): { rows: any[] } {
    const room_id = params[0];
    const members = this.store.room_members
      .filter((m) => m.room_id === room_id)
      .map((m) => {
        const u = this.store.users.find((user) => user.id === m.user_id);
        return { user_id: m.user_id, username: u?.username ?? 'Unknown' };
      });
    return { rows: members };
  }

  // ─── Telemetry ───────────────────────────────────────────────────────────

  private upsertTelemetry(params: any[]): { rows: any[] } {
    const [room_id, user_id, device_timestamp, latitude, longitude, accuracy, speed] = params;
    const idx = this.store.telemetry_readings.findIndex(
      (t) => t.user_id === user_id && Number(t.device_timestamp) === Number(device_timestamp)
    );
    if (idx !== -1) {
      this.store.telemetry_readings[idx] = {
        ...this.store.telemetry_readings[idx],
        room_id, latitude, longitude, accuracy, speed,
      };
    } else {
      this.store.telemetry_readings.push({
        id: crypto.randomUUID(),
        room_id, user_id, device_timestamp, latitude, longitude, accuracy, speed,
      });
    }
    return { rows: [] };
  }

  private selectRoomTelemetry(params: any[]): { rows: any[] } {
    const room_id = params[0];
    const rows = this.store.telemetry_readings
      .filter((t) => t.room_id === room_id)
      .map((t) => {
        const u = this.store.users.find((user) => user.id === t.user_id);
        return {
          user_id: t.user_id,
          username: u?.username ?? 'Unknown',
          device_timestamp: String(t.device_timestamp),
          latitude: t.latitude,
          longitude: t.longitude,
          accuracy: t.accuracy,
          speed: t.speed,
        };
      })
      .sort((a, b) => Number(a.device_timestamp) - Number(b.device_timestamp));
    return { rows };
  }

  private selectLastTelemetry(params: any[]): { rows: any[] } {
    const user_id = params[0];
    const list = this.store.telemetry_readings
      .filter((t) => t.user_id === user_id)
      .sort((a, b) => Number(b.device_timestamp) - Number(a.device_timestamp));
    return {
      rows: list.length > 0
        ? [{ ...list[0], device_timestamp: String(list[0].device_timestamp) }]
        : [],
    };
  }

  // ─── Emergency Alerts ─────────────────────────────────────────────────────

  private insertEmergencyAlert(params: any[]): { rows: any[] } {
    const [room_id, user_id, timestamp, latitude, longitude] = params;
    const alert = {
      id: crypto.randomUUID(),
      room_id, user_id, timestamp,
      status: 'active',
      latitude, longitude,
    };
    this.store.emergency_alerts.push(alert);
    return { rows: [alert] };
  }
}
