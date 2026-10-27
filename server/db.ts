import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Workspace } from './domain.js';
import { AppError, refreshExpiration } from './domain.js';
let embedded: PGlite | undefined;
const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    })
  : undefined;
export async function query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[] }> {
  if (pool) {
    const result = await pool.query(sql, params);
    return { rows: result.rows as T[] };
  }
  if (!embedded) {
    await mkdir('.data', { recursive: true });
    embedded = new PGlite(process.env.TEST_DB === 'true' ? 'memory://' : '.data/postgres');
  }
  return embedded.query<T>(sql, params);
}
export async function initDb() {
  await query(
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, body JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, role TEXT NOT NULL, demo BOOLEAN NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, body JSONB NOT NULL, processed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), agreement_id TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', started_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await query(
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'verification'`,
  );
  await query(
    `CREATE TABLE IF NOT EXISTS agent_artifacts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), agreement_id TEXT NOT NULL, handler TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  await query(`ALTER TABLE agent_artifacts ADD COLUMN IF NOT EXISTS html TEXT`);
  await query(`CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state, created_at)`);
}
export async function createWorkspace(w: Workspace) {
  await query('INSERT INTO workspaces(id,body) VALUES($1,$2)', [w.id, JSON.stringify(w)]);
}
export async function getWorkspace(id: string): Promise<Workspace> {
  const { rows } = await query<{ body: Workspace }>('SELECT body FROM workspaces WHERE id=$1', [
    id,
  ]);
  if (!rows[0]) throw new AppError(404, 'Workspace not found.');
  rows[0].body.agreements.forEach(refreshExpiration);
  return rows[0].body;
}
// Optimistic revision check makes updates atomic across web and worker processes.
// Mutators MUST be synchronous and free of external side effects: a conflict can retry them.
export async function mutate<T>(id: string, fn: (w: Workspace) => T): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { rows } = await query<{ body: Workspace; revision: number }>(
      'SELECT body,revision FROM workspaces WHERE id=$1',
      [id],
    );
    if (!rows[0]) throw new AppError(404, 'Workspace not found.');
    const w = rows[0].body;
    w.agreements.forEach(refreshExpiration);
    const result = fn(w);
    const updated = await query(
      'UPDATE workspaces SET body=$1, revision=revision+1 WHERE id=$2 AND revision=$3 RETURNING id',
      [JSON.stringify(w), id, rows[0].revision],
    );
    if (updated.rows.length) return result;
  }
  throw new AppError(409, 'Another update is in progress. Please retry.');
}
export async function closeDb() {
  await pool?.end();
  await embedded?.close();
}
