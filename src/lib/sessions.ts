import { randomInt, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATABASE_URL } from '../db.ts';

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

/**
 * The chat's current session, marked as used and named after `text` if it has no title
 * yet. A chat's first message starts its first session.
 */
export function touch(chat: Chat, text: string): Session {
  const session = current(chat) ?? create(chat);
  const title = session.title ?? shorten(text);
  const lastActiveAt = Date.now();
  db()
    .prepare('UPDATE maia_sessions SET title = ?, last_active_at = ? WHERE id = ?')
    .run(title, lastActiveAt, session.id);
  return { ...session, title, lastActiveAt };
}

/** Starts a session and makes it current. A current session with no messages is reused. */
export function start(chat: Chat): { session: Session; created: boolean } {
  const session = current(chat);
  if (session && !session.title) return { session, created: false };
  return { session: create(chat), created: true };
}

/** Makes the session with `ref` current. Undefined when the chat has none. */
export function resume(chat: Chat, ref: number): Session | undefined {
  const row = db()
    .prepare('SELECT * FROM maia_sessions WHERE channel = ? AND chat_id = ? AND ref = ?')
    .get(chat.channel, chat.id, ref);
  if (!row) return undefined;
  const session = toSession(row);
  makeCurrent(chat, session.id);
  return session;
}

/** The most recently used sessions, newest first. */
export function list(chat: Chat): Session[] {
  return db()
    .prepare(
      `SELECT * FROM maia_sessions WHERE channel = ? AND chat_id = ?
       ORDER BY last_active_at DESC LIMIT ?`,
    )
    .all(chat.channel, chat.id, LIST_LENGTH)
    .map(toSession);
}

export function current(chat: Chat): Session | undefined {
  const row = db()
    .prepare('SELECT * FROM maia_sessions WHERE channel = ? AND chat_id = ? AND is_current = 1')
    .get(chat.channel, chat.id);
  return row && toSession(row);
}

function create(chat: Chat): Session {
  const insert = db().prepare(
    `INSERT INTO maia_sessions (id, channel, chat_id, ref, last_active_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (channel, chat_id, ref) DO NOTHING`,
  );
  // Refs are random, so one can clash with another session's in the same chat.
  for (let attempt = 0; attempt < 10; attempt++) {
    const session = { id: randomUUID(), ref: randomInt(1000, 10000), lastActiveAt: Date.now() };
    if (insert.run(session.id, chat.channel, chat.id, session.ref, session.lastActiveAt).changes) {
      makeCurrent(chat, session.id);
      return session;
    }
  }
  throw new Error(`No free session ref in ${chat.channel} chat ${chat.id}.`);
}

function makeCurrent(chat: Chat, id: string) {
  db()
    .prepare('UPDATE maia_sessions SET is_current = (id = ?) WHERE channel = ? AND chat_id = ?')
    .run(id, chat.channel, chat.id);
}

function toSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    ref: Number(row.ref),
    title: typeof row.title === 'string' ? row.title : undefined,
    lastActiveAt: Number(row.last_active_at),
  };
}

function shorten(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

// Opened on first use: Flue creates the database file when it boots.
let database: DatabaseSync | undefined;

function db() {
  if (!database) {
    database = new DatabaseSync(DATABASE_URL);
    // Flue writes to the same file over its own connection.
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec(`CREATE TABLE IF NOT EXISTS maia_sessions (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      ref INTEGER NOT NULL,
      title TEXT,
      last_active_at INTEGER NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0,
      UNIQUE (channel, chat_id, ref)
    )`);
  }
  return database;
}
