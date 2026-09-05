import { DurableTelemetryDatabase } from '../src/telemetry/database/DurableTelemetryDatabase';
import { TelemetryModule } from '../src/telemetry/TelemetryModule';
import { MockSocketClient } from '../src/telemetry/socket/SocketClient';
import { MockLocationProvider } from '../src/telemetry/location/LocationProvider';
import { TelemetryReading } from '../src/telemetry/types';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const sample = (timestamp: number, groupCode = 'ROOM', userId = 'u'): TelemetryReading => ({ timestamp, groupCode, userId, client_reading_id: `id-${timestamp}`, latitude: 27, longitude: 85, accuracy: 5, speed: 1 });
function storageAdapter() {
  const values = new Map<string, string>();
  return {
    values,
    setItem: jest.fn(async (k: string, v: string) => { values.set(k, v); }),
    getAllKeys: jest.fn(async () => [...values.keys()]),
    getMany: jest.fn(async (keys: string[]) => Object.fromEntries(keys.map(k => [k, values.get(k) ?? null]))),
    removeMany: jest.fn(async (keys: string[]) => { keys.forEach(k => values.delete(k)); }),
  };
}
describe('durable mobile store and forward', () => {
  let storage: ReturnType<typeof storageAdapter>;
  let db: DurableTelemetryDatabase;
  let socket: MockSocketClient;
  let module: TelemetryModule;
  beforeEach(() => {
    jest.useFakeTimers();
    storage = storageAdapter(); db = new DurableTelemetryDatabase(storage as any);
    socket = new MockSocketClient();
    module = new TelemetryModule({ db, socketClient: socket, locationProvider: new MockLocationProvider() });
    module.restoreDelivery('u');
  });
  afterEach(() => { module.restoreDelivery(undefined); jest.clearAllTimers(); jest.useRealTimers(); });
  it('persists before connected send and deletes only after positive ACK', async () => {
    socket.triggerConnect();
    let ack: any;
    socket.emitLocationUpdate = jest.fn((r, callback) => { expect(storage.values.size).toBe(1); ack = callback; });
    await module.recordLocation(sample(1), 'ROOM', 'u');
    expect(storage.values.size).toBe(1);
    const queued = (await db.getUnsyncedReadings(100, 'u'))[0];
    ack({ accepted: true, sampleId: queued.client_reading_id }); await settle();
    expect(storage.values.size).toBe(0);
  });
  it('does not send if durable persistence fails', async () => {
    socket.triggerConnect(); storage.setItem.mockRejectedValueOnce(new Error('full'));
    await expect(module.recordLocation(sample(1), 'ROOM', 'u')).rejects.toThrow('full');
    expect(socket.locationUpdatesEmitted).toHaveLength(0);
  });
  it('offline samples stay pending and recover oldest first after a new database/module instance', async () => {
    await module.recordLocation(sample(3), 'ROOM', 'u'); await module.recordLocation(sample(1), 'ROOM', 'u');
    const restartedDb = new DurableTelemetryDatabase(storage as any);
    module = new TelemetryModule({ db: restartedDb, socketClient: socket });
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    expect(socket.bulkSyncsEmitted[0].map(r => r.timestamp)).toEqual([1, 3]);
    expect(storage.values.size).toBe(0);
  });
  it('lost ACK retries the same sample identity without client duplicates across reconnect cycles', async () => {
    await module.recordLocation(sample(1), 'ROOM', 'u');
    socket.ackHandlerOverride = async () => { throw new Error('ACK lost'); };
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    const id = socket.bulkSyncsEmitted[0][0].client_reading_id;
    expect(storage.values.size).toBe(1);
    socket.triggerDisconnect(); socket.triggerConnect();
    await jest.advanceTimersByTimeAsync(24000); await settle();
    expect(socket.bulkSyncsEmitted[1][0].client_reading_id).toBe(id);
    socket.ackHandlerOverride = null;
    socket.triggerDisconnect(); socket.triggerConnect();
    await jest.advanceTimersByTimeAsync(48000); await settle();
    expect(storage.values.size).toBe(0);
    await jest.advanceTimersByTimeAsync(24000);
    expect(socket.bulkSyncsEmitted).toHaveLength(3);
  });
  it('keeps room/user scope and can deliver ended history without attaching it to a new room', async () => {
    await db.insertReading(sample(1, 'OLD')); await db.insertReading(sample(2, 'NEW')); await db.insertReading(sample(3, 'OTHER', 'other-user'));
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    expect(socket.bulkSyncsEmitted[0].map(r => r.groupCode)).toEqual(['OLD']);
    await jest.advanceTimersByTimeAsync(12000); await settle();
    expect(socket.bulkSyncsEmitted[1].map(r => r.groupCode)).toEqual(['NEW']);
    expect(await db.getUnsyncedReadings(100, 'other-user')).toHaveLength(1);
  });
  it('logout suspends recovery without deleting queued history', async () => {
    await db.insertReading(sample(1)); module.restoreDelivery('u'); await settle();
    module.restoreDelivery(undefined); socket.triggerConnect();
    await jest.advanceTimersByTimeAsync(120000);
    expect(socket.bulkSyncsEmitted).toHaveLength(0);
    expect(storage.values.size).toBe(1);
  });
  it('fresh telemetry continues while a 400-sample backlog is in flight; concurrency is one batch', async () => {
    for (let i = 0; i < 400; i++) await db.insertReading(sample(i));
    let release: any;
    socket.ackHandlerOverride = readings => new Promise(resolve => { release = () => resolve({ confirmedClientReadingIds: readings.map(r => r.client_reading_id) }); });
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    await module.recordLocation(sample(1000), 'ROOM', 'u'); await settle();
    expect(socket.locationUpdatesEmitted).toHaveLength(1);
    expect(socket.bulkSyncsEmitted).toHaveLength(1);
    expect(socket.bulkSyncsEmitted[0]).toHaveLength(100);
    release(); await settle(); socket.ackHandlerOverride = null;
    await jest.advanceTimersByTimeAsync(36000); await settle();
    expect(socket.bulkSyncsEmitted.map(b => b.length)).toEqual([100, 100, 100, 100]);
    expect(socket.bulkSyncsEmitted.flat().map(r => r.timestamp)).toEqual(Array.from({ length: 400 }, (_, i) => i));
    expect(storage.values.size).toBe(0);
  });
  it('ignores foreign ACK ids and retains temporary failures', async () => {
    await db.insertReading(sample(1));
    socket.ackHandlerOverride = async () => ({ confirmedClientReadingIds: ['foreign'] });
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    expect(storage.values.size).toBe(1);
  });
  it('terminal invalid ACK removes only the identified rejected sample', async () => {
    await db.insertReading(sample(1)); await db.insertReading(sample(2));
    socket.ackHandlerOverride = async () => ({ confirmedClientReadingIds: [], rejectedClientReadingIds: ['id-1', 'foreign'] });
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    expect((await db.getUnsyncedReadings(100, 'u')).map(r => r.timestamp)).toEqual([2]);
  });
  it('reserves a persisted live fix against a concurrent backlog scan', async () => {
    module.restoreDelivery('u'); await settle(); socket.triggerConnect();
    let release: any;
    storage.setItem.mockImplementationOnce(async (k, v) => {
      storage.values.set(k, v);
      await new Promise<void>(resolve => { release = resolve; });
    });
    const recording = module.recordLocation(sample(1), 'ROOM', 'u'); await settle();
    await module.triggerResync();
    expect(socket.bulkSyncsEmitted).toHaveLength(0);
    release(); await recording; await settle();
    expect(socket.locationUpdatesEmitted).toHaveLength(1);
    expect(storage.values.size).toBe(0);
  });
  it('retains inaccessible old rooms without starving a different room', async () => {
    await db.insertReading(sample(1, 'OLD')); await db.insertReading(sample(2, 'NEW'));
    socket.ackHandlerOverride = async readings => ({ confirmedClientReadingIds: readings[0].groupCode === 'OLD' ? [] : readings.map(r => r.client_reading_id) });
    socket.triggerConnect(); module.restoreDelivery('u'); await settle();
    await jest.advanceTimersByTimeAsync(12000); await settle();
    expect(socket.bulkSyncsEmitted.map(b => b[0].groupCode)).toEqual(['OLD', 'NEW']);
    expect((await db.getUnsyncedReadings(100, 'u')).map(r => r.groupCode)).toEqual(['OLD']);
  });
  it('serializes native stop/start and captures ride scope across room changes', async () => {
    const provider = new MockLocationProvider();
    const start = jest.spyOn(provider, 'start');
    module = new TelemetryModule({ db, socketClient: socket, locationProvider: provider,
      connectivityManager: { start() {}, stop() {}, getStatus: () => 'offline', checkReachability: async () => false, onStatusChange: () => () => {} } });
    const options = { userId: 'u', groupCode: 'OLD', socketUrl: '', authToken: '', healthEndpointUrl: '' };
    await module.start(options);
    let release: any;
    const originalStop = provider.stop.bind(provider);
    jest.spyOn(provider, 'stop').mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); await originalStop(); });
    const stopping = module.stop();
    const starting = module.start({ ...options, groupCode: 'NEW' }); await settle();
    expect(start).toHaveBeenCalledTimes(1);
    release(); await stopping; await starting;
    provider.emitLocation(sample(1)); await settle();
    expect((await db.getUnsyncedReadings(100, 'u'))[0].groupCode).toBe('NEW');
    await module.stop();
  });

  it('never sends a captured fix under another authenticated user', async () => {
    socket.triggerConnect();
    await module.recordLocation(sample(1), 'OLD', 'other-user'); await settle();
    expect(socket.locationUpdatesEmitted).toHaveLength(0);
    expect(await db.getUnsyncedReadings(100, 'other-user')).toHaveLength(1);
  });

});
