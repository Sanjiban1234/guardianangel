import { Server } from 'socket.io';
import { CrashHandler } from '../src/handlers/CrashHandler';

describe('GA-04 crash/SOS security controls', () => {
  const user = { id: 'crash-user', name: 'Crash Rider' };
  const roomId = 'room-1';
  const groupCode = 'CRASHGROUP';

  const createHarness = () => {
    const socket: any = { user, on: jest.fn(), emit: jest.fn() };
    const roomEmitter = { emit: jest.fn() };
    const io: any = { to: jest.fn().mockReturnValue(roomEmitter) };
    const alert = { createAlert: jest.fn().mockResolvedValue({ alarm_no: 'alarm-1' }) };
    const repo: any = {
      resolveRoomId: jest.fn().mockResolvedValue(roomId),
      findLatestForUserInRoom: jest.fn(), getLatestTelemetry: jest.fn().mockResolvedValue(null),
      distanceFromLatestTelemetry: jest.fn(), updateOutcome: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue({ id: 'candidate-1' }),
    };
    const handler = new CrashHandler(io as Server, socket, { currentGroupCode: groupCode }, alert as any, repo);
    handler.register();
    return { socket, repo, alert, roomEmitter };
  };
  const listener = (socket: any, event: string) => socket.on.mock.calls.find((call: any[]) => call[0] === event)[1];
  const candidate = (timestamp = Date.now()) => ({ id: 'candidate-1', outcome: null, device_timestamp_ms: timestamp });
  const event = (timestamp = Date.now(), latitude = 28.2, longitude = 83.9) => ({ timestamp, latitude, longitude });

  beforeEach(() => CrashHandler.resetRateLimits());

  it.each([
    ['NaN latitude', NaN, 83.9], ['infinite longitude', 28.2, Infinity], ['latitude below range', -90.1, 83.9],
    ['latitude above range', 90.1, 83.9], ['longitude below range', 28.2, -180.1], ['longitude above range', 28.2, 180.1],
  ])('rejects %s', async (_name, latitude, longitude) => {
    const { socket, repo } = createHarness();
    await listener(socket, 'crash:candidate')(event(Date.now(), latitude, longitude));
    expect(repo.resolveRoomId).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Invalid or stale crash payload' }));
  });

  it.each([['stale', Date.now() - 10 * 60_000 - 1], ['far future', Date.now() + 10 * 60_000], ['invalid type', 'now' as any]])('rejects %s timestamp', async (_name, timestamp) => {
    const { socket, repo } = createHarness();
    await listener(socket, 'crash:candidate')({ ...event(), timestamp });
    expect(repo.resolveRoomId).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it('rejects SOS without a valid preceding candidate', async () => {
    const { socket, repo, alert } = createHarness();
    repo.findLatestForUserInRoom.mockResolvedValue(null);
    await listener(socket, 'crash:countdownExpired')(event());
    expect(alert.createAlert).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('recent crash candidate') }));
  });

  it('accepts one candidate confirmation and prevents a duplicate SOS', async () => {
    const { socket, repo, alert } = createHarness();
    const timestamp = Date.now();
    repo.findLatestForUserInRoom.mockResolvedValueOnce(candidate(timestamp)).mockResolvedValueOnce({ ...candidate(timestamp), outcome: 'confirmed' });
    await listener(socket, 'crash:countdownExpired')(event(timestamp));
    await listener(socket, 'crash:countdownExpired')(event(timestamp));
    expect(alert.createAlert).toHaveBeenCalledTimes(1);
    expect(repo.updateOutcome).toHaveBeenCalledWith('candidate-1', 'confirmed');
  });

  it('enforces the three-event crash candidate limit', async () => {
    const { socket, repo } = createHarness();
    const handler = listener(socket, 'crash:candidate');
    await handler(event()); await handler(event()); await handler(event()); await handler(event());
    expect(repo.insert).toHaveBeenCalledTimes(3);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('Rate limit exceeded') }));
  });

  it.each([
    ['small GPS drift', 0, 99, true], ['reasonable movement at 10 seconds', 10_000, 700, true], ['impossible jump beyond formula', 10_000, 701, false],
  ])('applies telemetry allowance for %s', async (_name, delta, distance, accepted) => {
    const { socket, repo, alert } = createHarness();
    const timestamp = Date.now();
    repo.findLatestForUserInRoom.mockResolvedValue(candidate(timestamp));
    repo.getLatestTelemetry.mockResolvedValue({ timestamp: timestamp - delta, latitude: 28.2, longitude: 83.9 });
    repo.distanceFromLatestTelemetry.mockResolvedValue(distance);
    await listener(socket, 'crash:countdownExpired')(event(timestamp));
    expect(alert.createAlert).toHaveBeenCalledTimes(accepted ? 1 : 0);
    if (!accepted) expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('inconsistent') }));
  });

  it('falls back to candidate controls when telemetry is missing or older than five minutes', async () => {
    for (const telemetry of [null, { timestamp: Date.now() - 5 * 60_000 - 1, latitude: 0, longitude: 0 }]) {
      CrashHandler.resetRateLimits();
      const { socket, repo, alert } = createHarness();
      const timestamp = Date.now();
      repo.findLatestForUserInRoom.mockResolvedValue(candidate(timestamp));
      repo.getLatestTelemetry.mockResolvedValue(telemetry);
      await listener(socket, 'crash:countdownExpired')(event(timestamp));
      expect(alert.createAlert).toHaveBeenCalledTimes(1);
      expect(repo.distanceFromLatestTelemetry).not.toHaveBeenCalled();
    }
  });
});
