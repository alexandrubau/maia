import { defineCommand } from '../lib/commands.ts';
import * as sessions from '../lib/sessions.ts';

export const resumeSession = defineCommand({
  name: 'resume',
  description: 'Continue an earlier session, e.g. /resume 4321',
  run: async ({ args, chat }) => {
    const ref = Number(args);
    if (!Number.isInteger(ref) || ref < 1) {
      return 'Send /resume and a number from /sessions, e.g. /resume 4321.';
    }
    if ((await sessions.current(chat))?.ref === ref)
      return `Session ${ref} is already the current one.`;
    const session = await sessions.resume(chat, ref);
    if (!session) return `There is no session ${ref}. Send /sessions to see them.`;
    return `Back to session ${ref}: ${session.title ?? 'no messages yet'}`;
  },
});
