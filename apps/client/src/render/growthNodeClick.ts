/**
 * What a click on a part of a plant should start.
 *
 * Grow mode is a mode, but clicking a part is the gesture the hint above the
 * action bar teaches - "click your plant to see what it can grow" - and it was
 * gated on that mode already being on: with the mode off, a click on the seed
 * fell through to nothing at all. No panel, no message, no request, which reads
 * as a dead part (G13). A click on your own part now starts growing and brings
 * the mode with it, so the selection, the aim and the lit Grow button agree. A
 * rival's plant stays a look, never a grow.
 */
export interface NodeClickPlan {
  /** Ask the server for this node's growth options. */
  requestOptions: boolean;
  /** Turn grow mode on: a part of your own plant is about to be grown. */
  enterGrowMode: boolean;
  /** Show the rival's low-detail inspect instead. */
  inspectRival: boolean;
}

export function planNodeClick(input: { isOwnPlant: boolean; growMode: boolean }): NodeClickPlan {
  if (!input.isOwnPlant) {
    return { requestOptions: false, enterGrowMode: false, inspectRival: true };
  }
  return { requestOptions: true, enterGrowMode: !input.growMode, inspectRival: false };
}
