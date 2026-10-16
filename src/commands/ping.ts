import { defineCommand } from '../lib/commands.ts';

export const ping = defineCommand({
  name: 'ping',
  description: 'Check that the app is responding',
  run: () => 'pong',
});
