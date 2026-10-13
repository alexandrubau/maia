'use agent';
import { useModel } from '@flue/runtime';

// One instance per WhatsApp chat, created by the Whappr channel. The channel
// sends the agent's final reply text back to the chat.
export function WhatsAppAssistant() {
  useModel('ollama/gemma4:e2b', { thinkingLevel: 'off' });
  return 'You are a helpful assistant chatting on WhatsApp. Keep replies short.';
}
