# WebSocket Event Contract — Guardian Angel

> [!WARNING]
> **SHARED CONTRACT — FLAG BEFORE CHANGING**
> This file is a shared contract that multiple modules (telemetry, crash detection, UI/weather, breakdown, medical ID) depend on. Any changes to event names, directions, or payload structures must be discussed and flagged with the team before merging.

This contract defines the real-time communication events between the Guardian Angel mobile client and the Node.js backend server.

---

## Event Registry

### 1. `session:join` (Client → Server)
- **Description:** Join a live Ride Room session using the group code.
- **Payload Shape:**
```json
{
  "group_code": "RIDE11ABCDEF1234"
}
```

### 2. `session:joined` (Server → Client)
- **Description:** Server confirms the client has successfully joined the Ride Room.
- **Payload Shape:**
```json
{
  "group_code": "RIDE11ABCDEF1234",
  "members": [
    {
      "user_id": "uuid-string",
      "name": "sanjiban"
    }
  ]
}
```

### 3. `session:member_joined` (Server → Room Broadcast)
- **Description:** Broadcast to all riders in the room when a new member joins.
- **Payload Shape:**
```json
{
  "user_id": "uuid-string",
  "name": "sanjiban"
}
```

### 4. `session:leave` (Client → Server)
- **Description:** Client leaves the room cleanly.
- **Payload Shape:** `{}`

### 5. `session:member_left` (Server → Room Broadcast)
- **Description:** Broadcast to all riders in the room when a member leaves cleanly.
- **Payload Shape:**
```json
{
  "user_id": "uuid-string",
  "name": "sanjiban"
}
```

### 6. `location:update` (Client → Server)
- **Description:** Send one durably saved location point. New clients include `client_reading_id` (stable UUID) and `groupCode`. Persistence callback: `{ accepted, sampleId, permanent }`. Delete locally only after matching accepted ACK or explicit permanent invalid rejection. Missing/temporary ACKs retain the sample. Delayed or out-of-order samples do not broadcast or trigger live safety.
- **Payload Shape:**
```json
{
  "timestamp": 1720958400000,
  "latitude": 28.2096,
  "longitude": 83.9856,
  "accuracy": 8.0,
  "speed": 12.5
}
```

### 7. `location:broadcast` (Server → Room Broadcast)
- **Description:** Broadcasts a rider's location update to all other room members.
- **Payload Shape:**
```json
{
  "user_id": "uuid-string",
  "name": "sanjiban",
  "timestamp": 1720958400000,
  "latitude": 28.2096,
  "longitude": 83.9856,
  "accuracy": 8.0,
  "speed": 12.5
}
```

### 8. `telemetry:bulkSync` (Client → Server)
- **Description:** Historical upload with explicit `groupCode` (legacy clients may omit it). The server verifies authenticated membership in that original room, including ended rides; the batch never updates live state. New clients send at most 100 timestamp-ordered readings per batch, one batch in flight and at least 12 seconds between sends.
- **Payload Shape:**
```json
{
  "readings": [
    {
      "client_reading_id": "00000000-0000-4000-8000-000000000001",
      "timestamp": 1720958400000,
      "latitude": 28.2096,
      "longitude": 83.9856,
      "accuracy": 8.0,
      "speed": 12.5
    }
  ]
}
```

### 9. `telemetry:bulkSyncAck` (Server → Client)
- **Description:** Callback containing `confirmedClientReadingIds` for committed rows, including retries. Optional `rejectedClientReadingIds` names permanently invalid samples only; temporary storage/authorization failures are not deletion instructions.
- **Payload Shape:**
```json
{
  "confirmedClientReadingIds": [
    "00000000-0000-4000-8000-000000000001"
  ]
}
```

### 10. `crash:candidate` (Client → Server)
- **Description:** Candidate crash event detected on-device. This starts a 15-second grace period timer on the backend before broadcasting an SOS.
- **Identity:** The backend always attributes this event to the authenticated socket's JWT user. A client-supplied `user_id`, if present, is ignored.
- **Payload Shape:**
```json
{
  "timestamp": 1720958405000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```

### 11. `crash:countdownExpired` (Client → Server)
- **Description:** Emitted when the 15-second crash warning countdown expires on-device without manual cancel. Tells the server to broadcast SOS immediately.
- **Identity:** The backend always attributes this event to the authenticated socket's JWT user. A client-supplied `user_id`, if present, is ignored.
- **Payload Shape:**
```json
{
  "timestamp": 1720958420000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```

### 12. `crash:cancelled` (Client → Server)
- **Description:** Emitted when the rider manually dismisses the crash warning during the 15-second grace period. No payload — the server marks the most recent candidate in this room as `false_alarm`.
- **Identity:** Cancellation always applies to the authenticated socket's JWT user.
- **Payload Shape:** _(empty object)_

### 13. `sos:broadcast` (Server → Room Broadcast)
- **Description:** Maximum priority emergency SOS broadcast sent to all members in the Ride Room and observers. Includes optional rider `medical_info` snapshot.
- **Payload Shape:**
```json
{
  "alarm_no": "uuid-string",
  "user_id": "uuid-string",
  "name": "sanjiban",
  "timestamp": 1720958420000,
  "latitude": 28.2096,
  "longitude": 83.9856,
  "medical_info": {
    "blood_group": "O+",
    "allergies": "Penicillin",
    "emergency_contact_name": "Jane Doe",
    "emergency_contact_phone": "+1234567890"
  }
}
```

### 14. `peer:lastKnown` (Server → Room Broadcast)
- **Description:** Broadcast when a rider suddenly disconnects from the WebSocket connection, supplying their last known location coordinates.
- **Payload Shape:**
```json
{
  "user_id": "uuid-string",
  "name": "sanjiban",
  "timestamp": 1720958400000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```

### 15. `group:separationAlert` (Server → Room Broadcast)
- **Description:** Emitted when a rider's distance to the nearest other group member exceeds threshold (500m) for over 30 seconds. Includes approximate straight-line meeting point and safe speed adjustment recommendations.
- **Payload Shape:**
```json
{
  "separated_rider": {
    "user_id": "uuid-string",
    "name": "utsuk",
    "current_speed": 15.0,
    "recommended_speed": 17.25,
    "distance_from_nearest_meters": 650.0
  },
  "meeting_point": {
    "latitude": 28.2120,
    "longitude": 83.9870,
    "is_approximate": true
  },
  "group_recommendation": {
    "recommended_speed": 13.5
  },
  "timestamp": 1720958430000
}
```

### 16. `group:reunited` (Server → Room Broadcast)
- **Description:** Emitted when a previously separated rider's distance to the nearest group member drops below 300m for 15 seconds.
- **Payload Shape:**
```json
{
  "user_id": "uuid-string",
  "name": "utsuk",
  "timestamp": 1720958460000
}
```

### 17. `vehicle:breakdown` (Client → Server)
- **Description:** Emitted when a rider manually reports a vehicle breakdown mid-ride.
- **Payload Shape:**
```json
{
  "reason": "flat_tire",
  "note": "Rear tire punctured near petrol station"
}
```

### 18. `vehicle:breakdownReported` (Server → Room Broadcast)
- **Description:** Broadcast to room members when a rider has reported a breakdown. Includes optional rider `medical_info` snapshot.
- **Payload Shape:**
```json
{
  "breakdown_id": "uuid-string",
  "user_id": "uuid-string",
  "name": "utsuk",
  "reason": "flat_tire",
  "note": "Rear tire punctured near petrol station",
  "latitude": 28.2096,
  "longitude": 83.9856,
  "reported_at": 1720958460000,
  "medical_info": {
    "blood_group": "O+",
    "allergies": "Penicillin",
    "emergency_contact_name": "Jane Doe",
    "emergency_contact_phone": "+1234567890"
  }
}
```

### 19. `vehicle:breakdownResolved` (Server → Room Broadcast)
- **Description:** Broadcast to room members when a rider marks their breakdown as resolved.
- **Payload Shape:**
```json
{
  "breakdown_id": "uuid-string",
  "user_id": "uuid-string",
  "name": "utsuk",
  "resolved_at": 1720958500000
}
```

### 20. `refill:requested` (Client → Server)
- **Description:** A manual, informational petrol-refill request. It has no fuel sensor data, escalation, or alert-suppression effect.
- **Identity:** The backend uses the authenticated socket identity; client-supplied user IDs are ignored.
- **Payload Shape:**
```json
{ "group_code": "RIDE11ABCDEF", "note": "Stopping for fuel" }
```

### 21. `refill:notified` (Server → Room Broadcast)
- **Description:** One-shot notification to the room after membership validation and logging.
- **Payload Shape:**
```json
{ "refill_id": "uuid-string", "user_id": "uuid-string", "name": "sanjiban", "group_code": "RIDE11ABCDEF", "note": "Stopping for fuel", "timestamp": 1720958500000 }
```

### 22. `ride:pause` (Client → Server)
- **Description:** Self-service request by an active rider to temporarily pause their ride participation.
- **Payload Shape:**
```json
{ "group_code": "RIDE11ABCDEF" }
```

### 23. `ride:paused` (Server → Room Broadcast)
- **Description:** Broadcast to room members when a rider temporarily pauses.
- **Payload Shape:**
```json
{ "user_id": "uuid-string", "name": "utsuk", "group_code": "RIDE11ABCDEF", "timestamp": 1720958500000 }
```

### 24. `ride:resume` (Client → Server)
- **Description:** Self-service request by a paused rider to resume active participation.
- **Payload Shape:**
```json
{ "group_code": "RIDE11ABCDEF" }
```

### 25. `ride:resumed` (Server → Room Broadcast)
- **Description:** Broadcast to room members when a rider resumes active participation.
- **Payload Shape:**
```json
{ "user_id": "uuid-string", "name": "utsuk", "group_code": "RIDE11ABCDEF", "timestamp": 1720958500000 }
```

