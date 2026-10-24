import type { WhapprClient } from '@whappr/client';
import type { GroupJoinedData, GroupParticipantLeftData, Participant } from '@whappr/flue';
import { logger as root } from './logger.ts';

// Maia stays in a WhatsApp group only while someone trusted is in it: she checks when she's
// added, when a trusted person leaves, and before answering, which also catches the groups whose
// events she missed (the gateway never retries a webhook).

const logger = root.child({ module: 'groups' });

/**
 * Reads a comma-separated list of ids (`…@c.us`, `…@lid`) or phone numbers, written like Whappr's
 * WEBHOOK_SENDER_IDS: a phone number becomes its `@c.us` id. Throws on an invalid entry.
 */
export function parseTrustedIds(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => {
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

  async function leave(groupId: string) {
    logger.info({ groupId }, 'leaving group without a trusted member');
    await client.groups.leave(groupId, { deleteChat: true });
  }

  /** Whether a trusted person other than `except` is in the group; leaves it when not. */
  async function check(groupId: string, except?: Participant) {
    const { participants } = await client.groups.get(groupId);
    if (participants.some((person) => isTrusted(person) && !(except && same(person, except)))) {
      return true;
    }
    await leave(groupId);
    return false;
  }

  return {
    // The event handlers return right away and act in the background: the gateway waits 5
    // seconds for the webhook.
    joined({ chat, participants }: GroupJoinedData) {
      if (participants.some(isTrusted)) return;
      leave(chat.id).catch((error) =>
        logger.error({ error, groupId: chat.id }, 'leaving group failed'),
      );
    },

    participantLeft({ chat, participant }: GroupParticipantLeftData) {
      if (!isTrusted(participant)) return;
      // Left out explicitly: the gateway's member list may not reflect the leave yet.
      check(chat.id, participant).catch((error) =>
        logger.error({ error, groupId: chat.id }, 'checking group failed'),
      );
    },

    /** Whether Maia may answer in the group; leaves it when not. */
    allows: (groupId: string) => check(groupId),
  };
}

function same(a: Participant, b: Participant) {
  return (
    a.id === b.id ||
    (a.lid !== undefined && a.lid === b.lid) ||
    (a.phone !== undefined && a.phone === b.phone)
  );
}
