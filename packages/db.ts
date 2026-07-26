
import { Pool, PoolClient } from 'pg'
import dotenv from 'dotenv'
dotenv.config()

/**
 * PostgreSQL Connection Pool Configuration
 *
 * Tuned for high-throughput distributed worker execution:
 * - max: 20 concurrent connections (sufficient for worker + API combined)
 * - idleTimeoutMillis: 30s idle connection reaping
 * - connectionTimeoutMillis: 2s fast-fail on connection acquisition
 * - statement_timeout: 30s kill runaway queries to prevent pool exhaustion
 *   (applied via connection init command, not just documented)
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  // statement_timeout is set per-connection via the options string because
  // node-postgres Pool does not expose it directly as a top-level option.
  // We enforce it at the session level in the pool's connect handler below.
})

pool.on('connect', async (client) => {
  // Enforce a 30-second statement timeout on every freshly obtained connection.
  // This kills runaway queries and prevents pool exhaustion from long-running
  // transactions that would otherwise hold connections indefinitely.
  await client.query('SET statement_timeout = 30000')
})

pool.on('error', (err) => {
  console.error('DB pool error:', err.message)
})

/** Execute a parameterized SQL query and return typed rows */
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const { rows } = await pool.query(sql, params)
  return rows as T[]
}

/** Execute a query expecting at most one row (returns null if none) */
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

/**
 * Execute a function within a database transaction (BEGIN → COMMIT / ROLLBACK).
 * Automatically releases the client back to the pool on completion.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * Pool Health Check
 * Returns current connection pool statistics for observability.
 */
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  }
}

/** Quick connectivity check — used by /api/health */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
