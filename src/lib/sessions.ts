import { randomInt, randomUUID } from 'node:crypto';
import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import { type Database, db } from '../db.ts';

// A chat holds sessions: threads with fresh context, each its own agent conversation.
// New messages go to the chat's current session.

/** A chat on one channel. Its id is only unique within that channel. */
export type Chat = { channel: string; id: string };

export type Session = {
  /** Random and never reused: the id of the session's agent conversation. */
  id: string;
  /** What people see and type, e.g. `/resume 4321`. Unique within the chat. */
  ref: number;
  /** The session's first message, shortened. Absent until it has one. */
  title?: string;
  lastActiveAt: number;
};

const TITLE_LENGTH = 40;
const LIST_LENGTH = 10;

// Reads and writes that depend on each other run in one transaction, so two messages
// arriving together can't both start a session. The database has a single connection,
// which a transaction holds until it ends: inside one, query through `trx`, never `db`,
// or the query waits for the transaction forever.

/**
 * The chat's current session, marked as used and named after `text` if it has no title
 * yet. A chat's first message starts its first session.
 */
export function touch(chat: Chat, text: string): Promise<Session> {
  return db.transaction().execute(async (trx) => {
    const session = (await current(chat, trx)) ?? (await create(trx, chat));
    const title = session.title ?? shorten(text);
    const lastActiveAt = Date.now();
    await trx
      .updateTable('maia_sessions')
      .set({ title, last_active_at: lastActiveAt })
      .where('id', '=', session.id)
      .execute();
    return { ...session, title, lastActiveAt };
  });
}

/** Starts a session and makes it current. A current session with no messages is reused. */
export function start(chat: Chat): Promise<{ session: Session; created: boolean }> {
  return db.transaction().execute(async (trx) => {
    const session = await current(chat, trx);
    if (session && !session.title) return { session, created: false };
    return { session: await create(trx, chat), created: true };
  });
}

/** Makes the session with `ref` current. Undefined when the chat has none. */
export function resume(chat: Chat, ref: number): Promise<Session | undefined> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('maia_sessions')
      .selectAll()
      .where('channel', '=', chat.channel)
      .where('chat_id', '=', chat.id)
      .where('ref', '=', ref)
      .executeTakeFirst();
    if (!row) return undefined;
    await makeCurrent(trx, chat, row.id);
    return toSession(row);
  });
}

/** The most recently used sessions, newest first. */
export async function list(chat: Chat): Promise<Session[]> {
  const rows = await db
    .selectFrom('maia_sessions')
    .selectAll()
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.id)
    .orderBy('last_active_at', 'desc')
    .limit(LIST_LENGTH)
    .execute();
  return rows.map(toSession);
}

export async function current(
  chat: Chat,
  executor: Kysely<Database> = db,
): Promise<Session | undefined> {
  const row = await executor
    .selectFrom('maia_sessions')
    .selectAll()
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.id)
    .where('is_current', '=', 1)
    .executeTakeFirst();
  return row && toSession(row);
}

async function create(trx: Transaction<Database>, chat: Chat): Promise<Session> {
  // Refs are random, so one can clash with another session's in the same chat.
  for (let attempt = 0; attempt < 10; attempt++) {
    const session = { id: randomUUID(), ref: randomInt(1000, 10000), lastActiveAt: Date.now() };
    const { numInsertedOrUpdatedRows } = await trx
      .insertInto('maia_sessions')
      .values({
        id: session.id,
        channel: chat.channel,
        chat_id: chat.id,
        ref: session.ref,
        last_active_at: session.lastActiveAt,
      })
      .onConflict((conflict) => conflict.columns(['channel', 'chat_id', 'ref']).doNothing())
      .executeTakeFirst();
    if (numInsertedOrUpdatedRows) {
      await makeCurrent(trx, chat, session.id);
      return session;
    }
  }
  throw new Error(`No free session ref in ${chat.channel} chat ${chat.id}.`);
}

async function makeCurrent(trx: Transaction<Database>, chat: Chat, id: string) {
  await trx
    .updateTable('maia_sessions')
    .set({ is_current: sql<number>`(id = ${id})` })
    .where('channel', '=', chat.channel)
    .where('chat_id', '=', chat.id)
    .execute();
}

function toSession(row: Selectable<Database['maia_sessions']>): Session {
  return {
    id: row.id,
    ref: row.ref,
    title: row.title ?? undefined,
    lastActiveAt: row.last_active_at,
  };
}

function shorten(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}
