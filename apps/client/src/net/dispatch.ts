/**
 * Message dispatch for the client's socket.
 *
 * `connect()` used to hold a ~1,700-line switch with 27 cases, so every new
 * protocol message was appended into the middle of a 2,000-line closure with no
 * test anywhere near it. A handler is now a named function plus one table entry,
 * and the table is checked against the protocol at startup.
 *
 * The payload type is `unknown`: `validateMessage()` runs before dispatch, and
 * each handler casts to its own payload type. That contract used to be implied
 * by an `as` cast inside a closure; here it is stated once.
 */
import { SERVER_TO_CLIENT_TYPES } from '@plant-legacy/shared/protocol';

/** What every handler is told about the message it is handling. */
export interface MessageContext {
  /** The protocol number, for the types that share one handler. */
  readonly type: number;
  /** Bytes on the wire, for the debug overlay's inbound counter. */
  readonly byteLength: number;
}

export type MessageHandler = (payload: unknown, ctx: MessageContext) => void | Promise<void>;

export type DispatchTable = ReadonlyMap<number, MessageHandler>;

/**
 * Build the type-to-handler table.
 *
 * Throws on a duplicate type: two handlers for one message means one of them
 * silently never runs, which is worse than failing at startup.
 */
export function createDispatchTable(
  entries: ReadonlyArray<readonly [number, MessageHandler]>,
): DispatchTable {
  const table = new Map<number, MessageHandler>();
  for (const [type, handler] of entries) {
    if (table.has(type)) {
      throw new Error(`Duplicate message handler for protocol type ${type}`);
    }
    table.set(type, handler);
  }
  return table;
}

/**
 * Server-to-client types with no handler in `table`.
 *
 * A protocol message nobody handles is otherwise invisible: the socket only logs
 * "Unknown message type" at runtime, if the player happens to trigger it.
 * Calling this at startup turns that into a visible error instead of a message
 * that quietly does nothing.
 */
export function missingServerMessageTypes(table: DispatchTable): number[] {
  return SERVER_TO_CLIENT_TYPES.filter((type) => !table.has(type));
}
