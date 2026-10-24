import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { observe, setProvider } from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Hello } from './agents/hello.ts';
import { groups, channel as whappr } from './channels/whappr.ts';
import { logFlueEvent, logger } from './lib/logger.ts';

observe(logFlueEvent);

// Agents use `ollama/gemma4:e2b`. Registered before any agent runs.
setProvider(
  createProvider({
    id: 'ollama',
    // Ollama ignores the key, but Pi's OpenAI client refuses to send a request without one.
    auth: {
      apiKey: { name: 'Ollama (keyless)', resolve: async () => ({ auth: { apiKey: 'ollama' } }) },
    },
    models: [
      {
        id: 'gemma4:e2b',
        name: 'Gemma 4 E2B (Ollama)',
        api: 'openai-completions',
        provider: 'ollama',
        baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434/v1',
        // Gemma 4 thinks by default on Ollama. Agents pick `thinkingLevel: 'off'`, which
        // Pi only forwards (as `reasoning_effort: "none"`) for reasoning-capable models.
        reasoning: true,
        thinkingLevelMap: { off: 'none' },
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        // Ollama's OpenAI endpoint can't raise its context per request, so this must match
        // the server's OLLAMA_CONTEXT_LENGTH or Flue's compaction kicks in too late.
        contextWindow: 8192,
        maxTokens: 1024,
        // Ollama ignores `max_completion_tokens`, Pi's default for this API.
        compat: { maxTokensField: 'max_tokens' },
      },
    ],
    api: openAICompletionsApi(),
  }),
);

const app = new Hono();

// A route that throws. Agent and channel routers fall through to this handler too.
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  logger.error({ error, method: c.req.method, path: c.req.path }, 'request failed');
  return c.text('Internal Server Error', 500);
});

// Liveness probe for the Docker HEALTHCHECK and any orchestrator in front of it.
app.get('/health', (c) => c.json({ ok: true }));

// The route map: every agent, channel, and custom route is mounted here
// explicitly. Talk to Hello with one POST per message:
//
//   curl -X POST http://localhost:5173/agents/hello/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"Tell me a joke."}'
app.route('/agents/hello', createAgentRouter(Hello));

// WhatsApp via the Whappr gateway. Point the gateway's WEBHOOK_URL at
// https://<your-app>/channels/whappr/webhook.
app.route('/channels/whappr', whappr.route());

// Leaves the groups Maia shouldn't be in, which the webhook's group events may have missed.
groups.sweep();

export default app;
