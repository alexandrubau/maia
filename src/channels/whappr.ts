import { init } from '@flue/runtime';
import { createWhapprClient } from '@whappr/client';
import { createWhapprChannel, type Message } from '@whappr/flue';
import { WhatsAppAssistant } from '../agents/whatsapp.ts';
import { ping } from '../commands/ping.ts';
import { createCommands } from '../lib/commands.ts';

const commands = createCommands<Message>([ping]);

export const client = createWhapprClient({
  baseUrl: requireEnv('WHAPPR_GATEWAY_URL'),
  secret: requireEnv('WHAPPR_SECRET_KEY'),
});

export const channel = createWhapprChannel({
  secret: requireEnv('WHAPPR_SECRET_KEY'),

  // Path: /channels/whappr/webhook
  async event({ event }) {
    if (event.type !== 'message.received') return;

    // The gateway waits 5 seconds for this webhook and never retries, so
    // acknowledge right away and reply in the background.
    const message = event.data;

    // Commands skip the per-chat queue, so they answer even while the agent is busy.
    const pending = commands.run(message.text ?? '', { message });
    if (pending) {
      pending
        .then(async (text) => {
          if (text) await client.messages.send({ to: message.chat.id, text });
        })
        .catch((error) =>
          console.error(`[whappr] command reply to chat ${message.chat.id} failed:`, error),
        );
      return;
    }

    enqueue(message.chat.id, () => reply(message));
  },
});

async function reply(message: Message) {
  const agent = init(WhatsAppAssistant, { id: channel.instanceId(message.chat.id) });
  const receipt = await agent
    .dispatch({
      message: {
        kind: 'signal',
        type: 'whappr.message.received',
        // `text` is the body or a media caption; media-only messages get a placeholder.
        body: message.text ?? `[${message.kind} message]`,
        attributes: {
          messageId: message.id,
          kind: message.kind,
          sender: message.sender.name ?? message.sender.id,
        },
      },
    })
    .catch((error) => {
      console.error('[whappr] undeliverable message shape:', shapeOf(message));
      throw error;
    });

  const { text } = await agent.read(receipt);
  if (text) await client.messages.send({ to: message.chat.id, text });
}

// Field types only, never content: text and sender names are personal data.
function shapeOf(message: Message) {
  return {
    keys: Object.keys(message),
    id: typeof message.id,
    kind: message.kind,
    text: typeof message.text,
    sender: message.sender && {
      keys: Object.keys(message.sender),
      id: typeof message.sender.id,
      name: typeof message.sender.name,
    },
  };
}

// One reply at a time per chat. A message dispatched while the agent is busy
// joins the running response, and every joined read returns that same reply,
// so it would be sent once per joined message.
const queues = new Map<string, Promise<void>>();

function enqueue(chatId: string, task: () => Promise<void>) {
  const next = (queues.get(chatId) ?? Promise.resolve())
    .then(task)
    .catch((error) => console.error(`[whappr] reply to chat ${chatId} failed:`, error));
  queues.set(chatId, next);
  next.finally(() => {
    if (queues.get(chatId) === next) queues.delete(chatId);
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing the ${name} environment variable.`);
  return value;
}
