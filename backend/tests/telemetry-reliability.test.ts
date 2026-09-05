import { TelemetryService } from '../src/services/TelemetryService';
import { QueryRunner } from '../src/db/QueryRunner';
import { LocationHandler } from '../src/handlers/LocationHandler';
import { BulkSyncHandler } from '../src/handlers/BulkSyncHandler';
import fs from 'fs';
import path from 'path';

const reading = () => ({ client_reading_id: '11111111-1111-4111-8111-111111111111', timestamp: Date.now(), latitude: 27, longitude: 85, speed: 1, accuracy: 5 });

describe('durable telemetry server boundary', () => {
  it('inserts stable identity with measurement timestamp and server-default receive clock', async () => {
    const r = reading();
    const run = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'row' }] }).mockResolvedValueOnce({ rows: [{ device_timestamp_ms: r.timestamp }] });
    expect(await new TelemetryService(new QueryRunner(run)).saveTelemetry('ROOM', 'u', r)).toEqual({ accepted: true, live: true });
    expect(run.mock.calls[0][1]).toEqual(expect.arrayContaining([r.timestamp, r.client_reading_id]));
    expect(run.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
    expect(run.mock.calls[0][0]).not.toContain('received_at');
  });
  it('accepts duplicate identity without repeating live processing', async () => {
    const run = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    expect(await new TelemetryService(new QueryRunner(run)).saveTelemetry('ROOM', 'u', reading())).toEqual({ accepted: true, live: false });
  });
  it('stores delayed samples as history and does not read/update live state', async () => {
    const run = jest.fn().mockResolvedValue({ rows: [{ id: 'row' }] });
    expect(await new TelemetryService(new QueryRunner(run)).saveTelemetry('ROOM', 'u', { ...reading(), timestamp: Date.now() - 120000 })).toEqual({ accepted: true, live: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1][8]).toBe(true);
  });
  it('does not broadcast a fresh but out-of-order sample', async () => {
    const r = reading();
    const run = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'row' }] }).mockResolvedValueOnce({ rows: [{ device_timestamp_ms: r.timestamp + 1 }] });
    expect((await new TelemetryService(new QueryRunner(run)).saveTelemetry('ROOM', 'u', r)).live).toBe(false);
  });
  it('ACKs lost-ACK retries from committed history, including ended ride membership', async () => {
    const r = reading();
    const run = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'ended-room' }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ client_reading_id: r.client_reading_id, device_timestamp_ms: r.timestamp }] });
    expect(await new TelemetryService(new QueryRunner(run)).bulkSyncTelemetry('OLD', 'u', [r])).toEqual([r.client_reading_id]);
    expect(run.mock.calls[0][0]).toContain('room_members');
    expect(run.mock.calls[0][0]).not.toContain("status = 'active'");
    expect(run.mock.calls[1][1][0]).toBe('ended-room');
    expect(run.mock.calls[1][0]).toContain('r.client_reading_id, true');
  });
  it('does not acknowledge database failures', async () => {
    const service = new TelemetryService(new QueryRunner(jest.fn().mockRejectedValue(new Error('db'))));
    expect(await service.saveTelemetry('ROOM', 'u', reading())).toEqual({ accepted: false, live: false });
    expect(await service.bulkSyncTelemetry('ROOM', 'u', [reading()])).toEqual([]);
  });
  it.each([false, true])('runs safety and Portal only for live accepted samples (%s)', async live => {
    const emit = jest.fn();
    const socket: any = { user: { id: 'u', name: 'Rider' }, on: jest.fn(), emit, to: () => ({ emit }), nsp: { to: () => ({ emit }) }, data: {} };
    const coherence = { evaluateRoomCoherence: jest.fn().mockResolvedValue({ alerts: [], reunions: [] }) };
    const portal = { location: jest.fn() };
    new LocationHandler(socket, { currentGroupCode: 'ROOM' }, { saveTelemetry: jest.fn().mockResolvedValue({ accepted: true, live }) } as any, coherence as any, undefined, portal as any).register();
    const ack = jest.fn();
    await socket.on.mock.calls[0][1](reading(), ack);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }));
    expect(coherence.evaluateRoomCoherence).toHaveBeenCalledTimes(live ? 1 : 0);
    expect(portal.location).toHaveBeenCalledTimes(live ? 1 : 0);
    expect(emit).toHaveBeenCalledTimes(live ? 1 : 0);
  });
  it('authorizes history using explicit old room without rejoining current room', async () => {
    const socket: any = { user: { id: 'u' }, on: jest.fn(), emit: jest.fn() };
    const service = { bulkSyncTelemetry: jest.fn().mockResolvedValue([]) };
    new BulkSyncHandler(socket, { currentGroupCode: 'NEW' }, service as any).register();
    await socket.on.mock.calls[0][1]({ groupCode: 'OLD', readings: [reading()] }, jest.fn());
    expect(service.bulkSyncTelemetry).toHaveBeenCalledWith('OLD', 'u', expect.any(Array));
  });
  it('migration retains database ordering and excludes history from trigger', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../src/db.ts'), 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS is_historical');
    expect(sql).toContain('IF NEW.is_historical');
    expect(sql).toContain('EXCLUDED.device_timestamp_ms > rider_current_locations.device_timestamp_ms');
  });
  it('does not ACK an identity collision that did not store the requested ride/time', async () => {
    const run = jest.fn().mockResolvedValue({ rows: [] });
    expect(await new TelemetryService(new QueryRunner(run)).saveTelemetry('ROOM', 'u', reading())).toEqual({ accepted: false, live: false });
  });

  it('keeps live coherence evaluation when a Portal delivery fails', async () => {
    const socket: any = { user: { id: 'u', name: 'Rider' }, on: jest.fn(), emit: jest.fn(), to: () => ({ emit: jest.fn() }), data: {} };
    const coherence = { evaluateRoomCoherence: jest.fn().mockResolvedValue({ alerts: [], reunions: [] }) };
    new LocationHandler(socket, { currentGroupCode: 'ROOM' }, { saveTelemetry: jest.fn().mockResolvedValue({ accepted: true, live: true }) } as any, coherence as any, { activeSharesForRoom: jest.fn().mockRejectedValue(new Error('unavailable')) } as any).register();
    const ack = jest.fn();
    await socket.on.mock.calls[0][1](reading(), ack);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(coherence.evaluateRoomCoherence).toHaveBeenCalledTimes(1);
  });

});
