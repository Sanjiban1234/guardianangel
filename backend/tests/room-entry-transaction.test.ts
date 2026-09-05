import { QueryRunner } from '../src/db/QueryRunner';
import { pool } from '../src/db';

jest.mock('../src/db', () => ({ query: jest.fn(), initDb: jest.fn(), pool: { connect: jest.fn() } }));

describe('room entry transaction boundary', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  beforeEach(() => { jest.clearAllMocks(); client.query.mockResolvedValue({ rows: [] }); (pool.connect as jest.Mock).mockResolvedValue(client); });
  it('uses one connection for membership and invitation updates and commits before returning', async () => {
    const result = await new QueryRunner().transaction(async db => {
      await db.run('membership', ['room', 'user']); await db.run('invitation', ['invite']); return 'joined';
    });
    expect(result).toBe('joined');
    expect(client.query.mock.calls).toEqual([['BEGIN'], ['membership', ['room', 'user']], ['invitation', ['invite']], ['COMMIT']]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  it('rolls back a failed invitation update and releases the connection', async () => {
    const error = new Error('write failed');
    await expect(new QueryRunner().transaction(async db => { await db.run('membership'); throw error; })).rejects.toBe(error);
    expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'membership', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
