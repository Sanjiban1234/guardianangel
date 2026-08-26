import { Server } from 'socket.io';
import { CrashHandler } from '../src/handlers/CrashHandler';
import { EmergencyAlertService } from '../src/services/EmergencyAlertService';
import { CrashCandidateRepository } from '../src/repositories/CrashCandidateRepository';
import { QueryRunner } from '../src/db/QueryRunner';

describe('CrashHandler identity attribution', () => {
  it('ignores a spoofed payload user_id and persists the authenticated socket user', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'room-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'candidate-1' }] });
    const repo = new CrashCandidateRepository(new QueryRunner(query));
    const socket: any = { user: { id: 'authenticated-user', name: 'Rider', role: 'rider' }, on: jest.fn(), emit: jest.fn() };
    const handler = new CrashHandler(
      { to: jest.fn() } as unknown as Server,
      socket,
      { currentGroupCode: 'RIDE123' },
      new EmergencyAlertService(new QueryRunner(query)),
      repo
    );

    handler.register();
    const candidateHandler = socket.on.mock.calls.find((call: any[]) => call[0] === 'crash:candidate')[1];
    await candidateHandler({
      user_id: 'victim-user',
      timestamp: Date.now(),
      latitude: 28.2096,
      longitude: 83.9856,
    });

    const insertCall = query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO crash_candidates');
    expect(insertCall[1][1]).toBe('authenticated-user');
    expect(insertCall[1][1]).not.toBe('victim-user');
  });
});
