import { QueryRunner } from '../src/db/QueryRunner';
import { MedicalInfoService } from '../src/services/MedicalInfoService';
import { LocationHandler } from '../src/handlers/LocationHandler';
import { BulkSyncHandler } from '../src/handlers/BulkSyncHandler';

describe('GA-11 boundary validation', () => {
  it.each([null, 1, [], {}])('rejects non-string allergies (%p)', async (allergies) => {
    const service = new MedicalInfoService(new QueryRunner(jest.fn().mockResolvedValue({ rows: [{ updated_at: new Date().toISOString() }] })));
    if (allergies === null) await expect(service.upsertMedicalInfo('u1', { allergies })).resolves.toBeDefined();
    else await expect(service.upsertMedicalInfo('u1', { allergies } as any)).rejects.toThrow('Invalid allergies');
  });
  it.each([
    [{ allergies: 'a'.repeat(501) }], [{ notes: 'n'.repeat(1001) }], [{ emergency_contact_name: 'n'.repeat(101) }], [{ emergency_contact_phone: '+'.concat('1'.repeat(20)) }], [{ unexpected: true }],
  ])('rejects oversized or unknown medical fields', async (data) => {
    await expect(new MedicalInfoService(new QueryRunner(jest.fn())).upsertMedicalInfo('u1', data as any)).rejects.toThrow();
  });
  it.each([
    [{ timestamp: Date.now(), latitude: NaN, longitude: 0, accuracy: 1, speed: 1 }],
    [{ timestamp: Date.now(), latitude: 0, longitude: Infinity, accuracy: 1, speed: 1 }],
    [{ timestamp: 'now', latitude: 0, longitude: 0, accuracy: 1, speed: 1 }],
    [{ timestamp: Date.now(), latitude: 91, longitude: 0, accuracy: 1, speed: 1 }],
    [{ timestamp: Date.now(), latitude: 0, longitude: 181, accuracy: 1, speed: 1 }],
  ])('rejects malformed telemetry without saving it', async (reading) => {
    const socket: any = { user: { id: 'u1', name: 'Rider' }, on: jest.fn(), emit: jest.fn(), to: jest.fn(), nsp: { to: jest.fn() } };
    const telemetry = { saveTelemetry: jest.fn() };
    new LocationHandler(socket, { currentGroupCode: 'GROUP' }, telemetry as any).register();
    await socket.on.mock.calls.find((call: any[]) => call[0] === 'location:update')[1](reading);
    expect(telemetry.saveTelemetry).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite bulk telemetry values (%p)', async (invalidValue) => {
    const socket: any = { user: { id: 'u1', name: 'Rider' }, on: jest.fn(), emit: jest.fn() };
    const telemetry = { bulkSyncTelemetry: jest.fn() };
    new BulkSyncHandler(socket, { currentGroupCode: 'GROUP' }, telemetry as any).register();
    await socket.on.mock.calls.find((call: any[]) => call[0] === 'telemetry:bulkSync')[1]({
      readings: [{ client_reading_id: 'a', timestamp: Date.now(), latitude: invalidValue, longitude: 0, accuracy: 1, speed: 1 }],
    });
    expect(telemetry.bulkSyncTelemetry).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.any(Object));
  });
});
