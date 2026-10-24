import { WhapprApiError, type WhapprClient } from '@whappr/client';
import type { GroupJoinedData, GroupParticipantLeftData, Participant } from '@whappr/flue';
import { logger as root } from './logger.ts';

// Maia stays in a WhatsApp group only while someone trusted answers for her being there: she
// leaves a group unless a trusted person added her, and once no trusted person is left in it.

const logger = root.child({ module: 'groups' });

// Listing groups is slow: the gateway refreshes each one from WhatsApp.
const LIST_TIMEOUT_MS = 120_000;
const SWEEP_RETRY_MS = 60_000;

/**
 * Reads a comma-separated list of ids (`…@c.us`, `…@lid`) or phone numbers, written like Whappr's
 * WEBHOOK_SENDER_IDS: a phone number becomes its `@c.us` id. Throws on an invalid entry, or when
 * the list is empty.
 */
export function parseTrustedIds(value: string | undefined): ReadonlySet<string> {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) throw new Error('Missing the WHAPPR_TRUSTED_IDS environment variable.');

  return new Set(
    entries.map((entry) => {
      if (/^[^@\s]+@(c\.us|lid)$/.test(entry)) return entry;
      if (/^\+?[\d\s-]*\d[\d\s-]*$/.test(entry)) return `${entry.replace(/\D/g, '')}@c.us`;
      throw new Error(
        `WHAPPR_TRUSTED_IDS: "${entry}" must be an id (…@c.us, …@lid) or a phone number.`,
      );
    }),
  );
}

export function createGroupGuard(client: WhapprClient, trustedIds: ReadonlySet<string>) {
  // WhatsApp knows a person by a phone-based id, a privacy id, or both: any of them may be listed.
  const isTrusted = (person: Participant) =>
    !person.isMe &&
    (trustedIds.has(person.id) ||
      (person.lid !== undefined && trustedIds.has(person.lid)) ||
      (person.phone !== undefined && trustedIds.has(`${person.phone}@c.us`)));

  async function leave(groupId: string, reason: string) {
    logger.info({ groupId, reason }, 'leaving group');
    try {
      await client.groups.leave(groupId, { deleteChat: true });
    } catch (error) {
      // Already gone, e.g. the sweep and an event both left it.
      if (error instanceof WhapprApiError && error.code === 'CHAT_NOT_FOUND') return;
      logger.error({ error, groupId }, 'leaving group failed');
    }
  }

  async function hasTrustedMember(groupId: string, except?: Participant) {
    const { participants } = await client.groups.get(groupId);
    return participants.some((person) => isTrusted(person) && !(except && same(person, except)));
  }

  async function sweep() {
    const groups = await client.groups.list({ timeoutMs: LIST_TIMEOUT_MS });
    for (const { id } of groups) {
      try {
        if (!(await hasTrustedMember(id))) await leave(id, 'no trusted member');
      } catch (error) {
        logger.error({ error, groupId: id }, 'checking group failed');
      }
    }
    logger.info({ groups: groups.length }, 'group sweep done');
  }

  function sweepUntilDone() {
    sweep().catch((error) => {
      logger.warn({ error }, 'group sweep failed, retrying');
      setTimeout(sweepUntilDone, SWEEP_RETRY_MS);
    });
  }

  // The handlers return right away and act in the background: the gateway waits 5 seconds for
  // the webhook.
  return {
    /** Stays when a trusted person added Maia or, when WhatsApp doesn't say who did, is a member. */
    joined({ chat, author, participants }: GroupJoinedData) {
      if (author ? isTrusted(author) : participants.some(isTrusted)) return;
      void leave(chat.id, author ? 'added by an untrusted person' : 'no trusted member');
    },

    /** When a trusted person leaves, stays only if another one is still a member. */
    participantLeft({ chat, participant }: GroupParticipantLeftData) {
      if (!isTrusted(participant)) return;
      // Left out explicitly: the gateway's member list may not reflect the leave yet.
      hasTrustedMember(chat.id, participant)
        .then(async (stays) => {
          if (!stays) await leave(chat.id, 'last trusted member left');
        })
        .catch((error) => logger.error({ error, groupId: chat.id }, 'checking group failed'));
    },

    /**
     * Leaves every group without a trusted member: those joined before the guard existed, or while
     * Maia was down, since the gateway never retries a webhook. Retries until one sweep completes,
     * as the gateway may not be up or paired yet.
     */
    sweep: sweepUntilDone,
  };
}

function same(a: Participant, b: Participant) {
  return (
    a.id === b.id ||
    (a.lid !== undefined && a.lid === b.lid) ||
    (a.phone !== undefined && a.phone === b.phone)
  );
}
