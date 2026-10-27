/**
 * The Cloak & Dagger's human dancer, as a closed-set look outside the street
 * cast: one fixed figure, painted through the same biped rig and pipeline as
 * every other adult look, with its own dance routines. Station staff (bartender,
 * market) and the wandering patrons reuse existing street-cast and
 * Hawkfolk cast looks directly (`CloakAndDaggerSystem.ts`/`ClubCrowdSystem.ts`
 * pick the ids) — the club dancer is the one figure this floor needs that
 * nothing else in the game already draws.
 */
import {
  ADULT_STRIDE_FRACTION,
  DANCER_HAIR_RAMP,
  DANCER_SKIN_RAMP,
  type TownCastLookBiped,
} from './townCastLooks';
import { deriveGlossRamp } from '../art/biped/palette';
import {
  FEMININE_FACING_BROW,
  FEMININE_PROFILE_BROW,
  FLAT_MOUTH,
  RIG_BROW_TONE,
  RIG_EYES,
  type BipedExpression,
} from '../art/biped/head';

/** A calm, unscowled feminine expression for the dancer — never the rig's own combat brow. */
const DANCER_EXPRESSION: BipedExpression = {
  angerScale: 0.1,
  profileBrow: FEMININE_PROFILE_BROW,
  facingBrow: FEMININE_FACING_BROW,
  lipFullness: 1.15,
  mouthSmile: FLAT_MOUTH,
  eyes: RIG_EYES,
  browTone: RIG_BROW_TONE,
};

export const CLUB_DANCER_LOOK_ID = 'club_dancer';

let look: TownCastLookBiped | null = null;

/** The human club dancer as a closed-set look, for `townCastOutfitFigure`. */
export function clubDancerLook(): TownCastLookBiped {
  if (look !== null) return look;
  look = {
    id: CLUB_DANCER_LOOK_ID,
    painter: 'biped',
    build: 'slight',
    roles: [],
    hasWork: false,
    hasDance: true,
    strideFraction: ADULT_STRIDE_FRACTION,
    feminine: true,
    dialogSeed: 0x4c1b,
    buildWidthScale: 0.78,
    skinRamp: DANCER_SKIN_RAMP,
    hairRamp: DANCER_HAIR_RAMP,
    hairStyle: 'ponytail',
    facialHair: 'none',
    garmentRamp: deriveGlossRamp('#c81e78'),
    garmentHemDrop: 0.65,
    garmentHemFlare: 1.6,
    garmentHasHardware: false,
    accessory: { kind: 'none', color: '#000000' },
    legwear: 'stockings',
    pantsColor: '#2a1a2a',
    shoeColor: '#1c1418',
    expression: DANCER_EXPRESSION,
  };
  return look;
}
