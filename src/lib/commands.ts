// Commands are instructions for the application.
// Channels run them before a message reaches the agent, so they answer even while
// the agent is busy. Shaped like Flue tools: defined with defineCommand(), one per
// file in src/commands/, and mounted explicitly by each channel with createCommands().

export type CommandContext<TMessage = unknown> = {
  /** The text after the command name, trimmed. Empty when there is none. */
  args: string;
  /** What the channel received, in the provider's own shape. */
  message: TMessage;
};

// The reply to send. Nothing means no reply.
// biome-ignore lint/suspicious/noConfusingVoidType: lets `run` return nothing, like Flue tools.
export type CommandReply = string | void;

export type CommandDefinition<TMessage = unknown> = {
  readonly name: string;
  readonly description: string;
  // A function-typed property, not a method, so the message type is checked strictly:
  // a command that reads one channel's message can't be mounted on another channel.
  readonly run: (context: CommandContext<TMessage>) => CommandReply | Promise<CommandReply>;
};

const NAME = /^[a-z][a-z0-9_-]*$/;
const COMMAND = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i;

export function defineCommand<TMessage = unknown>(
  definition: CommandDefinition<TMessage>,
): CommandDefinition<TMessage> {
  if (!NAME.test(definition.name)) throw new Error(`Invalid command name "${definition.name}".`);
  if (!definition.description) throw new Error(`Command /${definition.name} needs a description.`);
  return Object.freeze({ ...definition });
}

export function createCommands<TMessage>(commands: CommandDefinition<TMessage>[]) {
  const help = defineCommand<TMessage>({
    name: 'help',
    description: 'List the commands',
    run: () => [...byName.values()].map((c) => `/${c.name} – ${c.description}`).join('\n'),
  });
  const byName: Map<string, CommandDefinition<TMessage>> = new Map([[help.name, help]]);
  for (const command of commands) {
    if (byName.has(command.name)) throw new Error(`Duplicate command /${command.name}.`);
    byName.set(command.name, command);
  }

  return {
    // Undefined when the text isn't a command. Detection is synchronous so the caller
    // decides right away whether to queue the message for the agent. The promise never
    // rejects: a failing command is logged and replies `/x failed.`
    run(text: string, context: { message: TMessage }): Promise<CommandReply> | undefined {
      const match = COMMAND.exec(text.trim());
      if (!match) return undefined;
      const [, name, args = ''] = match;
      const command = byName.get(name.toLowerCase());
      if (!command) return Promise.resolve(`Unknown command /${name}. Send /help to see them all.`);
      return Promise.resolve()
        .then(() => command.run({ args, ...context }))
        .catch((error) => {
          console.error(`[commands] /${command.name} failed:`, error);
          return `/${command.name} failed.`;
        });
    },
  };
}
