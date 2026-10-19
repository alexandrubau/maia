import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sqlite } from '@flue/runtime/node';
import { type Generated, Kysely } from 'kysely';
import { NodeNativeSqliteDialect } from 'kysely-node-native-sqlite';

// Only SQLite for now: `sqlite://<path>`, the path relative to the cwd.
const url = process.env.DATABASE_URL || 'sqlite://./data/flue.db';
if (!url.startsWith('sqlite://')) {
  throw new Error("DATABASE_URL must be a sqlite:// URL; other databases aren't supported yet.");
}
const path = url.slice('sqlite://'.length);
// Flue's adapter creates the folder too, but migrations run before Flue's first boot.
mkdirSync(dirname(path), { recursive: true });

/**
 * The app's own tables. They live next to Flue's, in the same database, and are created by
 * the migrations in src/migrations: `npx kysely migrate:latest`, which the Docker image runs.
 */
export type Database = {
  maia_sessions: {
    id: string;
    channel: string;
    chat_id: string;
    ref: number;
    title: string | null;
    last_active_at: number;
    is_current: Generated<number>;
  };
};

// Flue writes to the same file over its own connection, hence the busy timeout.
export const db = new Kysely<Database>({
  dialect: new NodeNativeSqliteDialect(path, { timeout: 5000 }),
});

// Conversations, attachments, and accepted submissions are stored here so
// they survive a restart. Swap in another adapter (Postgres, libSQL, ...)
// when one host's SQLite file is no longer enough:
// https://flueframework.com/docs/guide/database/
export default sqlite(path);
