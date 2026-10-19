import { defineCommand } from '../lib/commands.ts';
import * as sessions from '../lib/sessions.ts';

export const listSessions = defineCommand({
  name: 'sessions',
  description: 'List recent sessions',
  run: async ({ chat }) => {
    const recent = await sessions.list(chat);
    if (!recent.length) return 'No sessions yet. Send a message to start one.';
    const current = (await sessions.current(chat))?.ref;
    return [
      ...recent.map(
        ({ ref, title, lastActiveAt }) =>
          `${ref} · ${title ?? 'No messages yet'} · ${ago(lastActiveAt)}${ref === current ? ' ← current' : ''}`,
      ),
      '',
      'Send /resume and a number to continue one.',
    ].join('\n');
  },
});

function ago(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
