# Guardian Angel — Real-Time Sync & Session Module

This is the Node.js/Express and Socket.io backend cloud layer for **Guardian Angel**, a group-ride safety app for motorcyclists. It handles session management (Ride Rooms), real-time location/telemetry broadcasts, and client re-synchronization with conflict resolution when transitioning from offline mode.

---

## Technical Features

1. **Express REST Server**: Implements user registration, authentication, room creation, joining, and location history querying.
2. **Socket.io WebSocket Layer**: Enables live telemetry exchange and broadcasts within active Ride Rooms.
3. **Robust Security & Room Isolation**: Implements JWT authorization middleware. Validates room memberships for both REST queries and WebSocket events to prevent cross-room location data leakage.
4. **Resilient Database Layer**: Features an automatic fallback to an in-memory SQL mock engine if no PostgreSQL server is available, making development, testing, and demo execution completely standalone.
5. **Bulk Re-sync & Conflict Resolution**: Automatically reconciles client SQLite offline cache backlogs using a Last-Write-Wins (LWW) resolution strategy keyed on device-generated timestamps.

---

## API Documentation

### REST Endpoints

All endpoints (except registration and login) require the header `Authorization: Bearer <JWT_TOKEN>`.

| Method | Path | Description | Request Body / Parameters | Response (200/201) |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | User Signup | `{ username, password, phone }` | `{ message, user: { id, username } }` |
| `POST` | `/api/auth/login` | User Signin | `{ username, password }` | `{ token, user: { id, username } }` |
| `POST` | `/api/rooms` | Create Ride Room | `{}` | `{ room_id, room_token, creator_id }` |
| `POST` | `/api/rooms/join` | Join Ride Room | `{ room_token }` | `{ message, room_id }` |
| `GET` | `/api/rooms/:roomId/history` | Get Room history | `roomId` (URI Param) | `[ { user_id, username, device_timestamp, latitude, longitude, accuracy, speed }, ... ]` |
| `GET` | `/api/health` | Connectivity check | None | `{ status: "healthy", timestamp }` |

---

### WebSocket Event Contract

All socket events expect an authenticated connection (JWT token passed in the `auth` payload during handshake).

| Event Name | Direction | Payload Shape | Description |
|---|---|---|---|
| `session:join` | Client -> Server | `{ room_token: string }` | Join the Ride Room WebSocket channel. |
| `session:joined` | Server -> Client | `{ room_id: string, members: Array<{ user_id, username }> }` | Success confirmation returned to the joiner. |
| `session:member_joined` | Server -> Room | `{ user_id: string, username: string }` | Emitted to existing members when a peer joins. |
| `session:leave` | Client -> Server | `{}` | Leave the Ride Room cleanly. |
| `session:member_left` | Server -> Room | `{ user_id: string, username: string }` | Emitted when a peer cleanly leaves the room. |
| `location:update` | Client -> Server | `{ timestamp: number, latitude: number, longitude: number, accuracy: number, speed: number }` | Sends single live telemetry reading (State A). |
| `location:broadcast` | Server -> Room | `{ user_id, username, timestamp, latitude, longitude, accuracy, speed }` | Broadcasts rider position to other members. |
| `telemetry:bulkSync` | Client -> Server | `{ readings: Array<{ client_reading_id, timestamp, latitude, longitude, accuracy, speed }> }` | Batch catch-up upload of offline cached readings. Supports a callback confirmation. |
| `telemetry:bulkSyncAck` | Server -> Client | `{ confirmedClientReadingIds: Array<string> }` | Acknowledgment listing successfully saved reading IDs. |
| `crash:candidate` | Client -> Server | `{ timestamp, latitude, longitude }` | Sent by client to notify that a candidate crash was detected. |
| `crash:countdownExpired`| Client -> Server | `{ timestamp, latitude, longitude }` | Sent by client when countdown expires to trigger immediate SOS. |
| `sos:broadcast` | Server -> Room | `{ alert_id, user_id, username, timestamp, latitude, longitude }` | Maximum priority alert broadcast to room and portal. |
| `peer:lastKnown` | Server -> Room | `{ user_id, username, timestamp, latitude, longitude }` | Broadcast when a member suddenly disconnects. |

---

## Verification & Standalone Testing

### Automated Unit Tests
The test suite consists of 16 tests covering registration/login validation, room creation/joining restrictions, access controls, live broadcast, and bulk sync conflict resolution.

To run tests:
```bash
npm run test
```

### Client Simulation Demo
A complete simulation script has been created to demonstrate the end-to-end flow. It executes the following actions:
1. Registers three riders (`rider_sanjiban`, `rider_utsuk`, and `rider_intruder_anonymous`).
2. Logins and retrieves JWTs for all three.
3. `rider_sanjiban` creates a Ride Room.
4. `rider_utsuk` joins the room.
5. Both open WebSockets and join the session.
6. `rider_sanjiban` sends live location updates (demonstrating real-time broadcasting to `rider_utsuk`).
7. `rider_sanjiban` goes offline, and the server broadcasts a `peer:lastKnown` notification carrying their last coordinates.
8. While offline, `rider_sanjiban` buffers telemetry with a duplicate timestamp to verify Last-Write-Wins conflict resolution.
9. `rider_sanjiban` reconnects and pushes their backlog via `telemetry:bulkSync`.
10. The server resolves conflicts, commits the data, and returns an acknowledgment array.
11. The room history is queried and printed, verifying that duplicate entries were resolved and updated according to LWW.
12. `rider_intruder_anonymous` attempts to steal the room's location history and is blocked with a `403 Forbidden`, proving room isolation security.

To run the demo:
```bash
npm run demo
```
