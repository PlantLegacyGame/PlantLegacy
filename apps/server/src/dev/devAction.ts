/** A dev command as it arrived on the wire: `type` plus whatever the caller sent. */
export interface DevAction {
  type: string;
  [key: string]: unknown;
}
