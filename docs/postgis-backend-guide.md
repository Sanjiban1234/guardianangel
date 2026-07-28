# PostGIS implementation guide

This repository now includes a forward-looking normalized schema at [`backend/sql/postgis_schema.sql`](../backend/sql/postgis_schema.sql) and parameterized `node-postgres` queries in [`backend/src/repositories/PostgisTelemetryRepository.ts`](../backend/src/repositories/PostgisTelemetryRepository.ts).

They deliberately do not overwrite the current `active_riders` / `engine_heartbeat` schema. Adopt them through a planned migration after the team resolves the existing `group_code` versus `room_token` contract mismatch.

## 1. Setup and version

Run once per database, as the database owner (or a role granted permission to create extensions):

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- UUIDs and token hashing
SELECT PostGIS_Full_Version();
```

`geography`, `ST_DWithin`, `ST_Length`, and geography support for these operations have existed since **PostGIS 1.5**. That is the theoretical minimum for the features here, but it is not a sensible production baseline. Use a supported PostgreSQL release with **PostGIS 3.x**; this project should enforce **PostGIS 3.0 or later** at deployment. `ST_DWithin` gained geography performance improvements in 2.1. [PostGIS documents the geography signatures and meter-based radius behavior](https://postgis.net/docs/manual-3.0/ST_DWithin.html), and its [length documentation](https://postgis.net/docs/manual-3.0/ST_Length.html) confirms meter output for geography.

## 2. Schema decisions

The schema file creates the four requested tables plus `rider_current_locations`.

- `ride_rooms` stores a lifecycle record. The requested raw `token` has been changed to `token_hash`. Generate a high-entropy token, give it to the creator once, and store only its SHA-256 hash; an invite token is a credential and should not be recoverable from a database leak.
- `room_members` adds a `role` check for `rider` and `guardian`. The backend must use this role when authorizing live positions/history.
- `telemetry_readings` is append-only history. `device_timestamp_ms` is explicit about its unit and avoids the ambiguity of a column named `timestamp`; `received_at` is the server audit time. `client_reading_id` is required so re-sync retries are idempotent.
- `geofences` adds `is_active`, because “any active geofence” cannot otherwise be queried. It uses `ST_Covers`, which includes a point exactly on the boundary; `ST_Contains`/`ST_Within` exclude boundary-only matches and are geometry-oriented in the usual form. [ST_Covers supports geography polygon/point and uses spatial indexes](https://postgis.net/docs/ST_Covers.html).
- `rider_current_locations` is a small current-state projection maintained by a trigger. Do not derive a “current” position from millions of historic rows for every proximity request.

Coordinates must always be passed as **longitude, latitude** to `ST_MakePoint`, even though mobile clients normally send latitude first.

### Why GiST, not btree

A btree has a one-dimensional ordering, so it works well for IDs, timestamps, and equality/range predicates. It cannot efficiently answer “which two-dimensional shapes overlap this search region?” A PostGIS GiST index stores bounding boxes in an R-tree-like structure, allowing PostGIS to discard almost all distant records before it performs precise geography calculations. `ST_DWithin`, `ST_Covers`, and `ST_Intersects` include index-friendly bounding-box checks. [The PostGIS reference explicitly notes that `ST_DWithin` uses available spatial indexes](https://postgis.net/docs/manual-3.0/ST_DWithin.html).

The schema keeps both indexes because they solve separate filters:

```sql
CREATE INDEX telemetry_readings_location_gix
  ON telemetry_readings USING GIST (location);
CREATE INDEX telemetry_readings_room_user_time_idx
  ON telemetry_readings (room_id, user_id, device_timestamp_ms);
```

For large history tables, add time partitioning (for example, monthly by `received_at`) before data becomes difficult to maintain. Retention/deletion policy is also essential: raw 3–5 second points for multi-hour rides grow quickly.

## 3. Query layer (`pg`)

`PostgisTelemetryRepository` uses parameterized `node-postgres` queries—no coordinates or IDs are interpolated into SQL.

### Live insert

`insertLiveReading(roomId, userId, reading)` stores one point using:

```sql
ST_SetSRID(ST_MakePoint($longitude, $latitude), 4326)::geography
```

The unique `(user_id, client_reading_id)` key makes a retry safe. Validate latitude `[-90, 90]`, longitude `[-180, 180]`, non-negative accuracy/speed, a reasonable timestamp window, and room membership before calling it.

### Bulk re-sync

`bulkInsert(roomId, userId, readings)` does one `INSERT … SELECT` from `jsonb_to_recordset` inside `BEGIN`/`COMMIT`, returning only successfully inserted `client_reading_id` values. A retry returns no IDs for rows already accepted, so the API should treat duplicate client IDs as confirmed too if the client needs a fully idempotent acknowledgement. One robust alternative is to `ON CONFLICT ... DO UPDATE SET client_reading_id = EXCLUDED.client_reading_id RETURNING client_reading_id`, provided the immutable data has first been validated.

Keep a maximum batch size (the existing backend has 500), and chunk larger backlogs client-side. This avoids excessive request bodies, locks, and transaction time.

### Distance over a track

`totalDistanceMeters(roomId, userId, fromMs, toMs)` sorts points by device timestamp, builds a line, casts it to geography, and calls `ST_Length`:

```sql
ST_Length(ST_MakeLine(point ORDER BY device_timestamp_ms)::geography)
```

This is compact and computes the distance of the complete ordered path. Ensure the sequence has at least two points; `COALESCE` returns zero for an empty result.

The alternative is `LAG(location) OVER (ORDER BY device_timestamp_ms)` and a sum of `ST_Distance(previous, location)`. It is usually preferable when filtering implausible jumps by time, accuracy, or speed because each segment is exposed individually. `ST_MakeLine` is simpler when every stored point should count.

### Geofence membership

`activeGeofencesAt(latitude, longitude)` uses:

```sql
ST_Covers(area, ST_SetSRID(ST_MakePoint($longitude, $latitude), 4326)::geography)
```

Use `ST_Covers` here rather than `ST_Contains`: a safety boundary should normally count a rider exactly on its edge as inside. If the product intentionally treats the border as outside, use a geometry-based `ST_Contains(area::geometry, point::geometry)` after deciding that planar boundary behavior is acceptable.

Geography polygon edges are geodesic (great-circle) edges. For small local hazard polygons, this is normally fine, but validate uploaded polygons (`ST_IsValid(area::geometry)`) and be especially cautious with polygons crossing the antimeridian. [PostGIS explains why geography polygon edges can differ from a flat-map expectation](https://postgis.net/documentation/faq/geography-inside/).

### Nearby riders

`ridersWithinMeters(roomId, latitude, longitude, radiusMeters)` reads `rider_current_locations` and uses:

```sql
ST_DWithin(location, point, $radiusMeters)
```

It returns only the current location per rider, in meters, and can use the GiST index. For “fell behind” logic, compare a rider with a group leader/current centroid and also apply freshness rules (for example, do not evaluate positions older than 20 seconds).

## 4. Why the index matters beyond one million readings

Without the GiST index, a radius or geofence query has to scan every candidate telemetry row and perform an expensive geodesic comparison. At one million historical readings, a query that logically concerns a few riders near one point still trends toward a full-table sequential scan; latency and CPU rise roughly with total stored history.

With GiST, PostGIS first traverses bounding boxes and reads only records whose boxes could overlap the search area. It then performs exact geography computation only for that much smaller candidate set. The result is typically dramatically lower I/O and CPU for selective radius/geofence queries, though exact speed depends on radius, data distribution, memory, and query filters. Use `EXPLAIN (ANALYZE, BUFFERS)` against realistic data to verify the planner picks the GiST index.

An index is not free: every insert/update also updates it, consuming disk and write CPU. For this app, the read-side benefit is worth it for safety and portal queries; the separate current-location table avoids paying a historical-table scan for frequent live proximity checks.

## 5. Units and type choice

Use `GEOGRAPHY(POINT, 4326)` for the stored GPS locations. With geography on WGS84, `ST_Distance`, `ST_DWithin`, and `ST_Length` use meters by default; `ST_Length` uses geodesic calculation and defaults to a spheroid. [Official PostGIS documentation confirms this behavior](https://postgis.net/docs/manual-3.0/ST_Length.html).

`GEOMETRY(POINT, 4326)` coordinates are degrees, so planar geometry distance/length outputs are degrees—not meaningful meters. Geometry can be faster when all work is confined to a known area and data is transformed to an appropriate local projected CRS (such as a UTM zone). For Guardian Angel’s mobile GPS tracking and meter-radius safety rules, geography is the safer default; PostGIS notes that geography is more convenient for global/WGS84 data but more computationally expensive and supports a smaller function set than geometry. [See the official geometry-versus-geography guidance](https://postgis.net/documentation/faq/geometry-or-geography/).
