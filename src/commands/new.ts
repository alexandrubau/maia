import { defineCommand } from '../lib/commands.ts';
import * as sessions from '../lib/sessions.ts';

export const newSession = defineCommand({
  name: 'new',
  description: 'Start a new session',
  run: ({ chat }) => {
    const { session, created } = sessions.start(chat);
    return created
      ? `Started session ${session.ref}. Send /sessions to see earlier ones.`
      : `Session ${session.ref} is already new.`;
  },
});
