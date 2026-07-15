/**
 * QueryRunner — thin wrapper that services call via constructor injection.
 *
 * IMPORTANT: The `queryFn` parameter defaults to the `query` export from
 * `../db`, which is the module intercepted by `jest.mock('../src/db')` in
 * tests. This means ALL service calls go through the same mockable surface
 * without any test needing to change.
 *
 * In production, `queryFn` is `db.query` which handles the pool→mock fallback
 * chain internally.
 *
 * `initSchema` is also delegated to `db.initDb` so index.ts stays clean.
 */
import { query as defaultQuery, initDb } from '../db';

export type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export class QueryRunner {
  constructor(
    private readonly queryFn: QueryFn = defaultQuery
  ) {}

  run(text: string, params: any[] = []): Promise<{ rows: any[] }> {
    return this.queryFn(text, params);
  }

  async initSchema(): Promise<void> {
    return initDb();
  }
}
