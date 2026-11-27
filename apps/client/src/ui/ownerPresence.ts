/**
 * How a rival's owner is shown in the Inspect panel: awake or asleep.
 *
 * The world has always known this indirectly - a plant carries its owner's name
 * only while that owner is connected, so a nameless rival was an absent one - but
 * a reader cannot see a rule about missing fields. The panel says it in words.
 *
 * `ownerOnline` is optional because an older server does not send it. In that
 * case the panel shows nothing at all: inferring "asleep" from a missing name
 * would be right today and wrong the first time a connected player has not set
 * one, and a wrong sleep state is worse than a blank line.
 */
export type OwnerPresenceState = 'awake' | 'asleep' | 'unknown';

export interface OwnerPresence {
  state: OwnerPresenceState;
  text: string;
}

export function ownerPresence(ownerOnline: boolean | undefined): OwnerPresence {
  if (ownerOnline === true) {
    return { state: 'awake', text: 'Awake \u00B7 here, tending their plant' };
  }
  if (ownerOnline === false) {
    return { state: 'asleep', text: 'Asleep \u00B7 the plant grows on its own' };
  }
  return { state: 'unknown', text: '' };
}
