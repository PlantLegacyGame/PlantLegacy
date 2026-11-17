import type { ChatConfig } from './chat.ts';

/**
 * Chat message shaping and the per-minute budget.
 *
 * Both used to live inline in `World.handlePostHelloMessage` and in two private
 * methods on the world, where the only way to reach them was a live socket.
 * Everything here is a function of its arguments: the caller owns the player's
 * timestamps and does the fanout.
 */

type ChatMode = 'world' | 'proximity';

/**
 * The parts of `config/chat.json` this module reads, taken from the loader's own
 * type so a renamed field cannot leave a parallel copy behind.
 */
export type ChatLimits = Pick<ChatConfig, 'messageMaxChars' | 'emoteIds'>;

export interface ChatIntent {
  mode: ChatMode;
  /** Message text after trimming and clipping, or the raw text of a bad emote. */
  text: string;
  /** Set when the text was `/emote <id>` for an id the config allows. */
  emoteId?: string;
}

const EMOTE_COMMAND = /^\/emote\s+(\w+)$/i;

/**
 * What an inbound CHAT_MESSAGE should broadcast, or null when there is nothing
 * to send (no message, or only whitespace once trimmed).
 *
 * An unknown emote is not an error: it falls through as ordinary text, which is
 * what the player typed.
 */
export function resolveChatIntent(
  raw: { message?: string; mode?: string },
  limits: ChatLimits,
): ChatIntent | null {
  if (!raw.message) return null;
  const text = raw.message.trim().slice(0, limits.messageMaxChars);
  if (text.length === 0) return null;

  const mode: ChatMode = raw.mode === 'proximity' ? 'proximity' : 'world';
  const emoteMatch = text.match(EMOTE_COMMAND);
  const emoteId = emoteMatch?.[1].toLowerCase();
  if (emoteId && limits.emoteIds.includes(emoteId)) {
    return { mode, text, emoteId };
  }
  return { mode, text };
}

/**
 * Records one message against the sender's sliding one-minute budget.
 *
 * Returns the pruned timestamp list as well as the verdict, because the caller
 * stores it back on the player: pruning has to happen even for a message that is
 * then refused, or a burst keeps the window full forever.
 */
export function consumeChatBudget(
  timestamps: readonly number[],
  now: number,
  messagesPerMinute: number,
): { allowed: boolean; timestamps: number[] } {
  const windowStart = now - 60_000;
  const recent = timestamps.filter((timestamp) => timestamp > windowStart);
  if (recent.length >= messagesPerMinute) {
    return { allowed: false, timestamps: recent };
  }
  recent.push(now);
  return { allowed: true, timestamps: recent };
}
