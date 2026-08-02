/**
 * @file websocket-events.ts
 * @description Shared WebSocket Contract for Guardian Angel.
 * This file serves as the type-safe contract between the Node.js backend
 * and the React Native mobile client.
 *
 * IMPORTANT: SHARED CONTRACT - DO NOT MUTATE WITHOUT TEAM ALIGNMENT.
 */

/**
 * 1. session:join (Client -> Server)
 * Emitted by the client to request joining a Ride Room.
 */
export interface SessionJoinPayload {
  group_code: string;
}

/**
 * 2. session:joined (Server -> Client)
 * Emitted by the server to confirm the client has successfully joined.
 */
export interface SessionJoinedPayload {
  group_code: string;
  members: Array<{
    user_id: string;
    name: string;
  }>;
}

/**
 * 3. session:member_joined (Server -> Room Broadcast)
 * Emitted to other room members when a new rider joins.
 */
export interface SessionMemberJoinedPayload {
  user_id: string;
  name: string;
}

/**
 * 4. session:leave (Client -> Server)
 * Emitted by the client to leave the room cleanly.
 * Payload is empty: {}
 */
export type SessionLeavePayload = Record<string, never>;

/**
 * 5. session:member_left (Server -> Room Broadcast)
 * Emitted to other room members when a rider leaves cleanly.
 */
export interface SessionMemberLeftPayload {
  user_id: string;
  name: string;
}

/**
 * 6. location:update (Client -> Server)
 * Single live location update sent by a client (State A - Online).
 */
export interface LocationUpdatePayload {
  timestamp: number; // Unix epoch milliseconds on device
  latitude: number;
  longitude: number;
  accuracy: number;  // GPS accuracy in meters
  speed: number;     // Speed in meters/second
}

/**
 * 7. location:broadcast (Server -> Room Broadcast)
 * Live coordinates forwarded by the server to all other room members.
 */
export interface LocationBroadcastPayload extends LocationUpdatePayload {
  user_id: string;
  name: string;
}

/**
 * 8. telemetry:bulkSync (Client -> Server)
 * Batch of cached readings pushed upon reconnecting (State B -> A).
 */
export interface TelemetryBulkSyncPayload {
  readings: Array<{
    client_reading_id: string; // SQLite row/UUID generated locally by device
    timestamp: number;         // Device capture epoch milliseconds
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number;
  }>;
}

/**
 * 9. telemetry:bulkSyncAck (Server -> Client / WebSocket Callback Response)
 * Acknowledgment returned to confirm successfully saved database logs.
 */
export interface TelemetryBulkSyncAckPayload {
  confirmedClientReadingIds: string[]; // List of successfully synchronized IDs
}

/**
 * 10. crash:candidate (Client -> Server)
 * Candidate crash event suspected on-device (starts 15s warning grace period).
 */
export interface CrashCandidatePayload {
  timestamp: number;
  latitude: number;
  longitude: number;
}

/**
 * 11. crash:countdownExpired (Client -> Server)
 * Confirm warning countdown has expired unconfirmed (triggers immediate SOS).
 */
export interface CrashCountdownExpiredPayload {
  timestamp: number;
  latitude: number;
  longitude: number;
}

/**
 * 12. crash:cancelled (Client -> Server)
 * Rider manually dismissed the crash warning during the 15s grace period.
 * No payload needed — the server marks the most recent candidate as false_alarm.
 */
export type CrashCancelledPayload = Record<string, never>;

/**
 * 13. sos:broadcast (Server -> Room Broadcast)
 * Emergency broadcast alert forwarded to riders and family web observer portals.
 */
export interface SosBroadcastPayload {
  alarm_no: string;  // Database alert primary key
  user_id: string;   // Impacted rider ID
  name: string;      // Impacted rider name
  timestamp: number; // SOS event timestamp
  latitude: number;
  longitude: number;
}

/**
 * 13. peer:lastKnown (Server -> Room Broadcast)
 * Emitted when a rider suddenly disconnects from the socket.
 */
export interface PeerLastKnownPayload {
  user_id: string;
  name: string;
  timestamp: number;
  latitude: number;
  longitude: number;
}
