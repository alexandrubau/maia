import { sqlite } from '@flue/runtime/node';

// Also opened by the app's own tables (src/lib/sessions.ts), so they live next to Flue's.
export const DATABASE_URL = './data/flue.db';

// Conversations, attachments, and accepted submissions are stored here so
// they survive a restart. Swap in another adapter (Postgres, libSQL, ...)
// when one host's SQLite file is no longer enough:
// https://flueframework.com/docs/guide/database/
export default sqlite(DATABASE_URL);
