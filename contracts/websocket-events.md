# WebSocket Event Contract — Guardian Angel

> [!WARNING]
> **SHARED CONTRACT — FLAG BEFORE CHANGING**
> This file is a shared contract that multiple modules (telemetry, crash detection, UI/weather) depend on. Any changes to event names, directions, or payload structures must be discussed and flagged with the team before merging.

This contract defines the real-time communication events between the Guardian Angel mobile client and the Node.js backend server.

---

## Event Registry

### 1. `session:join` (Client → Server)
- **Description:** Join a live Ride Room session using the cryptographic join token.
- **Payload Shape:**
```json
{
  "room_token": "cryptographic-short-token"
}
```

### 2. `session:joined` (Server → Client)
- **Description:** Server confirms the client has successfully joined the Ride Room.
- **Payload Shape:**
```json
{
  "room_id": "uuid-string",
  "members": [
    {
      "user_id": "uuid-string",
      "username": "sanjiban"
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
  "username": "sanjiban"
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
  "username": "sanjiban"
}
```

### 6. `location:update` (Client → Server)
- **Description:** Send single live location telemetry point (State A).
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
  "username": "sanjiban",
  "timestamp": 1720958400000,
  "latitude": 28.2096,
  "longitude": 83.9856,
  "accuracy": 8.0,
  "speed": 12.5
}
```

### 8. `telemetry:bulkSync` (Client → Server)
- **Description:** Batch push of telemetry cached on device during offline mode (State B).
- **Payload Shape:**
```json
{
  "readings": [
    {
      "client_reading_id": "uuid-or-local-id",
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
- **Description:** Acknowledgment containing client reading IDs successfully written/resolved by the server.
- **Payload Shape:**
```json
{
  "confirmedClientReadingIds": [
    "uuid-or-local-id"
  ]
}
```

### 10. `crash:candidate` (Client → Server)
- **Description:** Candidate crash event detected on-device. This starts a 15-second grace period timer on the backend before broadcasting an SOS.
- **Payload Shape:**
```json
{
  "timestamp": 1720958405000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```

### 11. `crash:countdownExpired` (Client → Server)
- **Description:** Emitter when the 15-second crash warning countdown expires on-device without manual cancel. Tells the server to broadcast SOS immediately.
- **Payload Shape:**
```json
{
  "timestamp": 1720958420000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```

### 12. `sos:broadcast` (Server → Room Broadcast)
- **Description:** Maximum priority emergency SOS broadcast sent to all members in the Ride Room and observers.
- **Payload Shape:**
```json
{
  "alert_id": "uuid-string",
  "user_id": "uuid-string",
  "username": "sanjiban",
  "timestamp": 1720958420000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```

### 13. `peer:lastKnown` (Server → Room Broadcast)
- **Description:** Broadcast when a rider suddenly disconnects from the WebSocket connection, supplying their last known location coordinates.
- **Payload Shape:**
```json
{
  "user_id": "uuid-string",
  "username": "sanjiban",
  "timestamp": 1720958400000,
  "latitude": 28.2096,
  "longitude": 83.9856
}
```
