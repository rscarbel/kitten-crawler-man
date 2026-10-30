/**
 * What each step of the human's kitchen chapter asks of him: where it is done,
 * what a press there does, and how the Journal puts it. The kitchen's works
 * offer a deed only where the step in hand is done, and the Journal points at
 * that same place, so the two cannot disagree about what comes next.
 */

import type { KitchenStage } from '../../core/quests/missingCatsProgress';
import {
  LARDER_DOOR_TILE,
  TOWER_DUMBWAITER,
  towerStoreyPlan,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';

/** The kitchen's fittings a step is done at. */
export type KitchenFitting = 'hatch' | 'bell' | 'larder_door' | 'stair_up';

/** Where a kitchen step is done: at one of the kitchen's fittings, or at the shop with the tuna. */
export type KitchenStepPlace =
  { readonly kind: 'fitting'; readonly fitting: KitchenFitting } | { readonly kind: 'store' };

export interface KitchenStep {
  readonly objective: string;
  readonly hint: string;
  readonly place: KitchenStepPlace;
  /** What a press at the step's fitting does, as its prompt reads; null when there is only waiting to do. */
  readonly deed: string | null;
}

const kitchenStair = towerStoreyPlan('kitchen');

export const KITCHEN_FITTING_TILES = {
  hatch: TOWER_DUMBWAITER.foot.hatch,
  bell: TOWER_DUMBWAITER.foot.bell,
  larder_door: LARDER_DOOR_TILE,
  stair_up: kitchenStair.stairUp ?? kitchenStair.arrival,
} as const satisfies Record<KitchenFitting, TowerTile>;

function at(fitting: KitchenFitting): KitchenStepPlace {
  return { kind: 'fitting', fitting };
}

/** The step the kitchen stands at, given whether a crawler in the kitchen has a tin of tuna to send up. */
export function kitchenStep(stage: KitchenStage, tunaInHand: boolean): KitchenStep {
  switch (stage) {
    case 'key_ring_in_dumbwaiter':
      return {
        objective:
          "Sneak past the gatehouse guards and take the key ring from the kitchen's dumbwaiter",
        hint: "Keep out of the guards' sight. They won't hurt you, but they will walk you back to the cellar stair.",
        place: at('hatch'),
        deed: 'take the key ring',
      };
    case 'key_ring_in_hand':
      return {
        objective: 'Unlock the larder with the key ring',
        hint: "The larder is through the door in the kitchen's south wall. One of the keys is stamped LARDER.",
        place: at('larder_door'),
        deed: 'unlock the larder',
      };
    case 'larder_open':
      return {
        objective: "Ring the dumbwaiter's bell",
        hint: 'Whoever sent the key ring down is still upstairs. The bell pull hangs beside the dumbwaiter.',
        place: at('bell'),
        deed: 'ring the bell',
      };
    case 'bell_rung':
      return {
        objective: 'Wait at the dumbwaiter for an answer',
        hint: 'Something is coming down from upstairs.',
        place: at('hatch'),
        deed: null,
      };
    case 'note_in_dumbwaiter':
      return {
        objective: 'Take what came down the dumbwaiter',
        hint: 'Whoever is upstairs has sent something back.',
        place: at('hatch'),
        deed: 'take the note',
      };
    case 'note_in_hand':
      return tunaInHand
        ? {
            objective: 'Send the tuna up the dumbwaiter',
            hint: 'Whoever sent the note down is holding the portcullis shut from above.',
            place: at('hatch'),
            deed: 'send the tuna up',
          }
        : {
            objective: 'Buy a tin of tuna at the General Store',
            hint: "The note from upstairs smells of fish: whoever is up there wants feeding. The gatehouse's front door is the quickest way out.",
            place: { kind: 'store' },
            deed: null,
          };
    case 'tuna_sent':
      return {
        objective: 'Wait by the portcullis on the kitchen stair',
        hint: 'Whoever ate the tuna is the one holding the portcullis.',
        place: at('stair_up'),
        deed: null,
      };
    default: {
      const unhandled: never = stage;
      throw new Error(`no kitchen step for ${String(unhandled)}`);
    }
  }
}
