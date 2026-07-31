# Guardian Angel — Backend Architecture Reference

Extracted from the project proposal (Chapter 3, ENCT-654) and organized
specifically for backend development (Person 3's module: Real-Time
Synchronization and Session Module, Cloud Layer). Includes notes on
what the proposal specifies clearly vs. what still needs to be decided
before building, since parts of the original document were flagged as
inconsistent or incomplete during proposal review.

---

## 1. Where the backend sits in the overall system

The proposal defines a **two-state client-server architecture**:

- **State A — Online Channel:** mobile client holds a live, persistent
  WebSocket connection (Socket.io) to the backend. All telemetry,
  group sync, and emergency broadcasts flow through this channel in
  real time.
- **State B — Offline Channel:** mobile client caches data locally
  (SQLite) when it can't reach the backend. The backend has no
  involvement during this state, it simply isn't in the loop until
  the client reconnects.
- **Re-sync / Catch-up:** when the client regains connectivity, it
  bulk-pushes everything cached during State B back to the backend in
  one batch operation. The backend is responsible for **conflict
  resolution** during this step, this is explicitly the backend's job
  per the proposal, not the client's.

**Backend implication:** the server has to support two distinct data
ingestion patterns, single live pushes (State A) and bulk batch
pushes with acknowledgment (re-sync), not just one generic "receive
location update" endpoint.

---

## 2. Core responsibilities of the backend (per Functional Module 3)

From the proposal's Section 3.1.3, the "Real-Time Synchronization and
Session Module" is responsible for:

1. **Token-generation for session/room creation.** Generating a
   unique access token when a rider creates a Ride Room, used by
   other riders to join.
2. **Multi-client group session management** over WebSocket
   connections (the "Ride Room" concept, all riders in one group
   session see each other's live positions).
3. **Driving the cloud relational database.**
4. **Bulk synchronization and conflict resolution logic** for clients
   catching up after being offline.
5. Per Section 3.1.2's Emergency Broadcast Routine: on receiving a
   crash-confirmed signal from a client (after the 15-second countdown
   expires unconfirmed), broadcasting a max-priority SOS packet to
   **both** the Ride Room (other riders in the group) and the
   **Guardian Web Portal** (family/observer dashboard).

---

## 3. Session lifecycle (from the proposal's workflow, Layer 1-2)

1. Client authenticates (login/profile setup).
2. Client checks connectivity, if online, syncs any pending
   profile/log data to the backend before proceeding.
3. Client chooses **Create Session** or **Join Session**:
   - **Create:** backend generates a cryptographic access token,
     instantiates a new Ride Room record.
   - **Join:** client submits an existing token, backend attaches the
     rider's device/session state to the existing Ride Room record.
4. Both paths hand the client into the live tracking runtime (State A
   / State B loop described above).
5. On session end, backend should expect the client to close its
   WebSocket connection and stop expecting further live updates for
   that rider.

---

## 4. WebSocket event contract (draft, needs finalizing)

The proposal does not specify exact event names or payload shapes,
this is something Person 3 needs to define and then communicate to
the rest of the team (Person 1 and Person 2 both build against these
event contracts on the client side). Below is a starting draft based
on what the architecture requires; treat this as a proposal to refine,
not a spec handed down from the document itself.

| Event | Direction | Purpose |
|---|---|---|
| `session:create` | client → server | Create a new Ride Room, returns a room token |
| `session:join` | client → server | Join an existing Ride Room via token |
| `location:update` | client → server | Single live telemetry push (State A) |
| `location:update` | server → clients in room | Broadcast a rider's position to the rest of the group |
| `telemetry:bulkSync` | client → server (with ack) | Batch push of cached readings after reconnect |
| `peer:lastKnown` | server → clients in room | Notify group that a rider has gone offline, carries their last confirmed position |
| `sos:broadcast` | client → server | Sent when the 15-second countdown expires unconfirmed |
| `sos:alert` | server → clients in room + Guardian Portal | Max-priority emergency broadcast |

**Payload shape for a single telemetry reading** (matches what Person
1's client module already assumes, confirm before changing):
```json
{
  "timestamp": 1720958400000,
  "latitude": 28.2096,
  "longitude": 83.9856,
  "accuracy": 8.0,
  "speed": 12.5
}
```

**Bulk sync payload/ack pattern** (needed so the client knows exactly
which cached rows are safe to delete locally):
```json
// client -> server
{
  "readings": [ /* array of readings as above */ ],
  "clientIds": [101, 102, 103]
}
// server -> client (ack)
{
  "confirmedClientIds": [101, 102, 103]
}
```

This client-id/confirm pattern matters: don't design the backend to
just say "sync successful," the client needs to know precisely which
local rows were received so it never deletes unconfirmed data if the
batch is only partially processed.

---

## 5. Database design

**What the proposal specifies:** a relational data model (Figure 3.3,
ER diagram) covering Users/Riders, Groups, Notification Subdivision,
Emergency Alarm, Engine Heartbeat, and Transaction History entities.
PostgreSQL + PostGIS is the specified database (Section 3.3), chosen
for geospatial indexing and bounding queries across multi-rider
tracking data.

**Known issue, flag before building from it directly:** the proposal's
ER diagram as drawn has unclear or inconsistent fields (e.g. "Macseps,"
"TakeOfcl," "TaksnoYD," "TypeArea") and does not have a clean, explicit
Session/RideRoom entity despite sessions being central to the whole
app. **Do not implement the schema as literally drawn.** Use it only
as a rough starting point for what entities need to exist, then design
the actual schema properly. A reasonable real schema, inferred from
what the architecture actually needs to function, would include at
minimum:

- **Users** (id, name, phone, auth info)
- **RideRooms / Sessions** (id, token, creator, created_at, status)
- **RoomMembers** (room_id, user_id, joined_at) — many-to-many between
  Users and RideRooms
- **TelemetryReadings** (id, room_id, user_id, timestamp, lat, lng,
  accuracy, speed) — indexed via PostGIS for geospatial queries
- **EmergencyAlerts** (id, room_id, user_id, timestamp, location,
  status) — the "Emergency Alarm" entity, tracking SOS events and
  whether they were confirmed/false-alarm/broadcast
- **RideSummaries** (id, room_id, user_id, distance, duration,
  max_speed, pct_online) — for the ride-summary screen data

This is a suggested normalization based on the architecture's stated
requirements, not something to treat as final without the whole team
reviewing it, particularly since Person 4's ride-summary and SOS
confirmation screens (Section 4.1) both depend on specific data being
queryable from here.

---

## 6. Security requirements (from the proposal's Testing Strategy, 4.3)

The backend explicitly needs to support, and should be testable
against:

1. **TLS on all WebSocket and REST traffic**, no plaintext transport
   anywhere.
2. **Session/token authentication**, a rider must not be able to join
   or view a Ride Room without a valid token. This means every
   WebSocket event handler that touches room data needs to verify the
   caller's token/session before acting, not just at connection time.
3. **Access isolation between groups**, the Guardian Portal (web
   dashboard) must not allow someone outside a given ride to pull that
   group's location history. This needs to be enforced server-side,
   not assumed from the client only requesting its own room's data.

---

## 7. Tools and technologies specified in the proposal (Section 3.3)

| Category | Tool |
|---|---|
| Backend server logic | Node.js / Express |
| Real-time transport | Socket.io |
| Cloud database | PostgreSQL + PostGIS |
| (Mobile client, for reference) | Flutter (per team decision, see framework notes) |

Note: if the team decides to build the backend in Python instead
(FastAPI + `python-socketio`), that's a valid substitution discussed
separately, `python-socketio` is protocol-compatible with the
Socket.io client, so this wouldn't require any changes on the mobile
side, only the backend implementation language changes.

---

## 8. What's NOT specified in the proposal and needs a team decision

Be aware these are gaps in the original document, not settled
architecture, don't assume answers exist for these without checking
with the team first:

- Exact WebSocket event names/payloads (Section 4 above is a draft
  starting point only).
- Exact conflict-resolution algorithm for bulk re-sync (what happens
  if two riders' offline caches overlap in time, or if a rider's
  cached track conflicts with data already received live).
- Rate limiting / abuse protection on the WebSocket layer.
- What "connectivity health check" endpoint the mobile client's
  `ConnectivityWatcher` should ping to confirm real reachability
  (currently a placeholder on the client side, per Person 1's module).
- Retention/deletion policy for historical telemetry data.
