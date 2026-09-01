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
    role: string;
    vehicle_model?: string;
    plate_number?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    device_timestamp?: number;
    last_updated_at?: number;
    connection_state: 'CONNECTED' | 'DISCONNECTED';
    location_freshness: 'FRESH' | 'STALE';
  }>;
}

/**
 * 3. session:member_joined (Server -> Room Broadcast)
 * Emitted to other room members when a new rider joins.
 */
export interface SessionMemberJoinedPayload {
  user_id: string;
  name: string;
  vehicle_model?: string;
  plate_number?: string;
  connection_state: 'CONNECTED';
  location_freshness: 'STALE';
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
  speed: number | null; // Native speed in m/s; may be unavailable
}

/**
 * 7. location:broadcast (Server -> Room Broadcast)
 * Live coordinates forwarded by the server to all other room members.
 */
export interface LocationBroadcastPayload extends LocationUpdatePayload {
  user_id: string;
  name: string;
  last_updated_at: number;
  connection_state: 'CONNECTED';
  location_freshness: 'FRESH';
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
    speed: number | null;
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

export interface MedicalInfoSnapshot {
  blood_group?: string;
  allergies?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  notes?: string;
}

/**
 * 13. sos:broadcast (Server -> Room Broadcast)
 * Emergency broadcast alert forwarded to riders and family web observer portals.
 */
export interface SosBroadcastPayload {
  alarm_no: string;  // Database alert primary key
  user_id: string;   // Impacted rider ID
  name: string;      // Impacted rider name
  vehicle_model?: string;
  plate_number?: string;
  timestamp: number; // SOS event timestamp
  latitude: number;
  longitude: number;
  medical_info?: MedicalInfoSnapshot;
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
  connection_state: 'DISCONNECTED';
  location_freshness: 'STALE';
}

/**
 * 15. group:separationAlert (Server -> Room Broadcast)
 * Emitted when a rider is detected as separated from the ride group.
 */
export interface GroupSeparationAlertPayload {
  separated_rider: {
    user_id: string;
    name: string;
    vehicle_model?: string;
    plate_number?: string;
    current_speed: number;
    recommended_speed: number | null;
    distance_from_nearest_meters: number;
  };
  meeting_point: {
    latitude: number;
    longitude: number;
    is_approximate: boolean;
  };
  group_recommendation: {
    recommended_speed: number | null;
  };
  timestamp: number;
}

/**
 * 16. group:reunited (Server -> Room Broadcast)
 * Emitted when a previously separated rider has reunited with the group.
 */
export interface GroupReunitedPayload {
  user_id: string;
  name: string;
  timestamp: number;
}

export type VehicleBreakdownReason =
  | 'flat_tire'
  | 'mechanical_failure'
  | 'fuel'
  | 'other';

/**
 * 17. vehicle:breakdown (Client -> Server)
 * Emitted when a rider manually reports a vehicle breakdown.
 */
export interface VehicleBreakdownPayload {
  reason?: VehicleBreakdownReason;
  note?: string;
}

/**
 * 18. vehicle:breakdownReported (Server -> Room Broadcast)
 * Emitted to room members when a rider has reported a breakdown.
 */
export interface VehicleBreakdownReportedPayload {
  breakdown_id: string;
  user_id: string;
  name: string;
  vehicle_model?: string;
  plate_number?: string;
  reason?: VehicleBreakdownReason;
  note?: string;
  latitude: number;
  longitude: number;
  reported_at: number;
  medical_info?: MedicalInfoSnapshot;
}

/**
 * 19. vehicle:breakdownResolved (Server -> Room Broadcast)
 * Emitted when a rider marks their breakdown as resolved.
 */
export interface VehicleBreakdownResolvedPayload {
  breakdown_id: string;
  user_id: string;
  name: string;
  resolved_at: number;
}

/** 20. refill:requested (Client -> Server), a manual petrol-refill request. */
export interface RefillRequestedPayload {
  group_code: string;
  note?: string;
}

/** 21. refill:notified (Server -> Room Broadcast), informational only. */
export interface RefillNotifiedPayload {
  refill_id: string;
  user_id: string;
  name: string;
  group_code: string;
  note?: string;
  timestamp: number;
}

/**
 * 22. ride:start (Client -> Server)
 * Emitted by the room host to start the ride. Only the owner can start.
 * Empty payload — the server identifies the rider from the socket auth.
 */
export type RideStartPayload = Record<string, never>;

/**
 * 23. ride:started (Server -> Room Broadcast)
 * Broadcast to all room members when the host starts the ride.
 * Clients should navigate to the map screen upon receiving this event.
 */
export interface RideStartedPayload {
  group_code: string;
  started_at: number; // Server timestamp (epoch ms)
}

/** Social notifications are advisory only; REST/database state is authoritative. */
export interface FriendNotificationPayload { userId: string; displayName?: string; username?: string; requestId?: string; }
export interface RideInvitationNotificationPayload { invitationId: string; roomId: string; inviterName?: string; destinationLabel?: string; }
export interface RideInvitationResponseNotificationPayload { invitationId: string; invitee: FriendNotificationPayload | null; }


