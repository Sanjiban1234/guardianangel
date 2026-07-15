import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/**
 * DatabasePool — owns the pg.Pool singleton.
 * Isolated: any pool-level error is caught here and sets a flag.
 * Other modules get a reference but never manage the pool directly.
 */
export class DatabasePool {
  private pool: Pool;
  private _hasError = false;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : undefined,
    });

    this.pool.on('error', (err) => {
      console.warn(
        'DatabasePool: pg.Pool encountered an error. Marking pool as unavailable.',
        err.message
      );
      this._hasError = true;
    });
  }

  /** Returns true if the pool has encountered an unrecoverable error */
  get hasError(): boolean {
    return this._hasError;
  }

  /** Marks the pool as failed (used by QueryRunner on connection refusal) */
  markFailed(): void {
    this._hasError = true;
  }

  /** Acquire a client from the pool for transactional work */
  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /** Run a single parameterized query directly on the pool */
  async query(text: string, params: any[] = []): Promise<any> {
    return this.pool.query(text, params);
  }

  /** Gracefully shut down the pool */
  async end(): Promise<void> {
    await this.pool.end();
  }
}
