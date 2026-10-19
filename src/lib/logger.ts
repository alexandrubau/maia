import { FlueError, type FlueObservation } from '@flue/runtime';
import pino from 'pino';

export const logger = pino(
  {
    // pino validates this itself and throws on an unrecognized level.
    level: process.env.LOG_LEVEL ?? 'info',

    // Keyed off NODE_ENV: pino-pretty is a devDependency, so the Docker runtime
    // image (NODE_ENV=production, `npm ci --omit=dev`) doesn't have it, and
    // requiring it there crashes on boot with "unable to determine transport target".
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        : undefined,

    // Personal data in a logged Whappr message. Keys stay visible, so the log still
    // shows the message's structure. See https://getpino.io/#/docs/redaction
    redact: {
      paths: [
        'message.text',
        'message.sender.name',
        'message.replyTo.text',
        'message.replyTo.sender.name',
        'message.mentions[*].name',
        'message.location',
        'message.contacts',
        'message.media.fileName',
      ],
      censor: '[REDACTED]',
    },

    serializers: {
      // Keyed "error", not pino's conventional "err": call sites read
      // `logger.error({ error }, '...')`. A live FlueError keeps its type, details
      // and meta; a plain Error goes through pino's serializer; Flue's own
      // already-serialized error payloads arrive as plain objects and pass through.
      error(value: unknown) {
        if (value instanceof FlueError) {
          return {
            type: value.type,
            message: value.message,
            details: value.details,
            meta: value.meta,
            stack: value.stack,
            cause:
              value.cause instanceof Error ? pino.stdSerializers.err(value.cause) : value.cause,
          };
        }
        if (value instanceof Error) return pino.stdSerializers.err(value);
        return value;
      },
    },
  },
  // Production writes stdout synchronously. pino's default buffers it and flushes on
  // exit before the exit hook below runs, so crash and exit lines could be lost.
  process.env.NODE_ENV === 'production' ? pino.destination({ sync: true }) : undefined,
);

function correlation(event: FlueObservation) {
  return {
    instanceId: event.instanceId,
    submissionId: event.submissionId,
    agentName: event.agentName,
    conversationId: event.conversationId,
    session: event.session,
    parentSession: event.parentSession,
    turnId: event.turnId,
    operationId: event.operationId,
    taskId: event.taskId,
    harness: event.harness,
  };
}

// Registered here, not in src/app.ts, so they're in place as soon as the logger is:
// this module loads before src/db.ts and the channels, whose top-level code throws on
// bad configuration, and src/app.ts only runs once all of those have loaded.
//
// Replaces Node's plain-text crash report; it still exits with code 1, as Node would.
// An unhandled rejection lands here too (origin "unhandledRejection"): Node raises it
// as an uncaught exception when nothing listens for it.
process.on('uncaughtException', (error, origin) => {
  logger.fatal({ error, origin }, 'uncaught exception');
  process.exit(1);
});

// Every exit that still runs JavaScript: a graceful shutdown on SIGTERM/SIGINT, the
// crash above, or the event loop running out of work. A V8 out-of-memory abort or a
// SIGKILL (Docker's OOM killer, a timed-out stop) ends the process with no chance to log.
process.on('exit', (code) => logger.info({ code }, 'process exiting'));

// Bridges Flue's runtime event stream into the logger; src/app.ts registers it
// with observe(). Failures log at error, completions at debug. Message contents
// and tool arguments are never logged: chat text is personal data.
export function logFlueEvent(event: FlueObservation) {
  switch (event.type) {
    case 'log':
      logger[event.level]({ ...event.attributes, ...correlation(event) }, event.message);
      return;

    case 'submission_settled':
      if (event.outcome === 'completed') return;
      logger.error(
        {
          ...correlation(event),
          outcome: event.outcome,
          error: event.error,
          errorInfo: event.errorInfo,
        },
        `submission ${event.outcome}`,
      );
      return;

    case 'submission_recovery':
      logger.error(
        {
          ...correlation(event),
          operation: event.operation,
          outcome: event.outcome,
          attemptCount: event.attemptCount,
          maxAttempts: event.maxAttempts,
          error: event.error,
          errorInfo: event.errorInfo,
        },
        'submission recovery',
      );
      return;

    case 'operation': {
      const fields = {
        ...correlation(event),
        operationKind: event.operationKind,
        durationMs: event.durationMs,
        usage: event.usage,
      };
      if (event.isError) {
        logger.error(
          { ...fields, error: event.error, errorInfo: event.errorInfo },
          'operation failed',
        );
      } else {
        logger.debug(fields, 'operation completed');
      }
      return;
    }

    case 'tool': {
      const fields = {
        ...correlation(event),
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        durationMs: event.durationMs,
      };
      if (event.isError) {
        logger.error({ ...fields, errorInfo: event.errorInfo }, 'tool call failed');
      } else {
        logger.debug(fields, 'tool call completed');
      }
      return;
    }

    case 'task': {
      const fields = { ...correlation(event), agent: event.agent, durationMs: event.durationMs };
      if (event.isError) {
        // On failure, `result` is the error message string.
        logger.error(
          { ...fields, message: event.result, errorInfo: event.errorInfo },
          'task failed',
        );
      } else {
        logger.debug(fields, 'task completed');
      }
      return;
    }

    case 'compaction': {
      const fields = {
        ...correlation(event),
        messagesBefore: event.messagesBefore,
        messagesAfter: event.messagesAfter,
        durationMs: event.durationMs,
      };
      if (event.isError) {
        logger.error(
          { ...fields, error: event.error, errorInfo: event.errorInfo },
          'compaction failed',
        );
      } else {
        logger.debug(fields, 'compaction completed');
      }
      return;
    }

    case 'turn':
      // Not promoted to error: Flue can retry or compact after a failed turn, so
      // submission_settled is the reliable terminal signal.
      logger.debug(
        {
          ...correlation(event),
          purpose: event.purpose,
          durationMs: event.durationMs,
          provider: event.request.providerName,
          model: event.request.requestedModel,
          finishReason: event.response.finishReason,
          usage: event.response.usage,
          isError: event.isError,
          error: event.isError ? event.response.error : undefined,
        },
        'model turn completed',
      );
      return;

    default:
      return;
  }
}
