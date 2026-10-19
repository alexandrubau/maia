import { init } from '@flue/runtime';
import { createWhapprClient } from '@whappr/client';
import { createWhapprChannel, type Message } from '@whappr/flue';
import { WhatsAppAssistant } from '../agents/whatsapp.ts';
import { newSession } from '../commands/new.ts';
import { ping } from '../commands/ping.ts';
import { resumeSession } from '../commands/resume.ts';
import { listSessions } from '../commands/sessions.ts';
import { createCommands } from '../lib/commands.ts';
import * as sessions from '../lib/sessions.ts';

const commands = createCommands<Message>([ping, newSession, listSessions, resumeSession]);

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

    // In a group, a message is addressed to the assistant when it tags the assistant, or
    // replies to it without tagging anyone else ("@Ana did you see?" is for Ana).
    const tagsOthers = message.mentions.some((mention) => !mention.isMe);
    const repliesToMe = message.replyTo?.sender.isMe && !tagsOthers;
    if (message.chat.type === 'group' && !message.mentionsMe && !repliesToMe) return;

    const text = resolveMentions(message);
    const chat = { channel: 'whappr', id: message.chat.id };

    // Commands skip the per-chat queue, so they answer even while the agent is busy.
    const pending = commands.run(text ?? '', { payload: message, chat });
    if (pending) {
      pending
        .then(async (reply) => {
          if (reply) await send(message, reply);
        })
        .catch((error) =>
          console.error(`[whappr] command reply to chat ${message.chat.id} failed:`, error),
        );
      return;
    }

    // `text` is the body or a media caption; media-only messages get a placeholder.
    const body = text ?? `[${message.kind} message]`;

    // The session is picked now, not when the queue reaches the message, so a message
    // sent before /new still lands in the session it was written for.
    const session = sessions.touch(chat, body);
    enqueue(message.chat.id, () => reply(message, body, session.id));
  },
});

async function reply(message: Message, body: string, sessionId: string) {
  const agent = init(WhatsAppAssistant, { id: sessionId });
  const receipt = await agent
    .dispatch({
      message: {
        kind: 'signal',
        type: 'whappr.message.received',
        body,
        attributes: {
          messageId: message.id,
          kind: message.kind,
          senderId: message.sender.id,
          ...(message.sender.name && { senderName: message.sender.name }),
          // The quoted message, so a tag on a reply to someone else has its context.
          ...(message.replyTo?.text && {
            quotedSenderId: message.replyTo.sender.id,
            ...(message.replyTo.sender.name && { quotedSenderName: message.replyTo.sender.name }),
            quotedText: message.replyTo.text,
          }),
        },
      },
    })
    .catch((error) => {
      console.error('[whappr] undeliverable message shape:', shapeOf(message));
      throw error;
    });

  const { text: answer } = await agent.read(receipt);
  if (answer) await send(message, answer);
}

// In a group, the reply quotes the message it answers, so it's clear who it's for.
function send(message: Message, text: string) {
  return client.messages.send({
    to: message.chat.id,
    text,
    ...(message.chat.type === 'group' && { replyTo: message.id }),
  });
}

// WhatsApp writes a mention into the text as `@` and the part of its id before the `@`.
// The assistant's own mention is dropped, so "@Maia /new" and "/new @Maia" read as "/new";
// anyone else's becomes their name when WhatsApp knows it.
function resolveMentions(message: Message) {
  let text = message.text;
  for (const { id, name, isMe } of message.mentions) {
    const token = `@${id.split('@')[0]}`;
    text = text?.replaceAll(token, isMe ? '' : name ? `@${name}` : token);
  }
  return text?.trim();
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
