/**
 * QueryRunner — thin wrapper that services call via constructor injection.
 *
 * IMPORTANT: The `queryFn` parameter defaults to the `query` export from
 * `../db`, which is the module intercepted by `jest.mock('../src/db')` in
 * tests. Transactional callers use one dedicated pool client; service tests
 * can inject the transaction boundary and transaction tests mock pool.connect.
 *
 * `initSchema` is also delegated to `db.initDb` so index.ts stays clean.
 */
import { query as defaultQuery, initDb, pool } from '../db';

export type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export class QueryRunner {
  constructor(
    private readonly queryFn: QueryFn = defaultQuery
  ) {}

  run(text: string, params: any[] = []): Promise<{ rows: any[] }> {
    return this.queryFn(text, params);
  }

  async transaction<T>(action: (db: QueryRunner) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(new QueryRunner((sql, params) => client.query(sql, params)));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async initSchema(): Promise<void> {
    return initDb();
  }
}
