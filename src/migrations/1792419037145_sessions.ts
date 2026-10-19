import type { Kysely } from 'kysely';

// The table predates migrations, so databases from before them already have it, in this shape.
export async function up(db: Kysely<unknown>) {
  await db.schema
    .createTable('maia_sessions')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('chat_id', 'text', (col) => col.notNull())
    .addColumn('ref', 'integer', (col) => col.notNull())
    .addColumn('title', 'text')
    .addColumn('last_active_at', 'integer', (col) => col.notNull())
    .addColumn('is_current', 'integer', (col) => col.notNull().defaultTo(0))
    .addUniqueConstraint('maia_sessions_chat_ref', ['channel', 'chat_id', 'ref'])
    .execute();
}
