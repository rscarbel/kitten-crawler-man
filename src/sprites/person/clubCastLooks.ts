/**
 * The Desperado Club's human dancer, as a closed-set look outside the street
 * cast: one fixed figure, painted through the same Carl rig and pipeline as
 * every other adult look, with its own dance routines. Station staff (bartender,
 * market, VIP host) and the wandering patrons reuse existing street-cast and
 * skyfowl-cast looks directly (`DesperadoClubSystem.ts`/`ClubCrowdSystem.ts`
 * pick the ids) — the club dancer is the one figure this floor needs that
 * nothing else in the game already draws.
 */
import { ADULT_STRIDE_FRACTION, type TownCastLookCarl } from './townCastLooks';
import { deriveGlossRamp } from '../art/carl/palette';
import { FEMININE_FACING_BROW, FEMININE_PROFILE_BROW, type CarlExpression } from '../art/carl/head';

/** A calm, unscowled feminine expression for the dancer — never Carl's own combat brow. */
const DANCER_EXPRESSION: CarlExpression = {
  angerScale: 0.1,
  profileBrow: FEMININE_PROFILE_BROW,
  facingBrow: FEMININE_FACING_BROW,
  lipFullness: 1.15,
};

export const CLUB_DANCER_LOOK_ID = 'club_dancer';

let look: TownCastLookCarl | null = null;

/** The human club dancer as a closed-set look, for `townCastOutfitFigure`. */
export function clubDancerLook(): TownCastLookCarl {
  if (look !== null) return look;
  look = {
    id: CLUB_DANCER_LOOK_ID,
    painter: 'carl',
    build: 'slight',
    roles: [],
    hasWork: false,
    hasDance: true,
    strideFraction: ADULT_STRIDE_FRACTION,
    feminine: true,
    dialogSeed: 0x4c1b,
    buildWidthScale: 0.78,
    gear: { trollskinShirt: true, cloak: false },
    skinRamp: {
      deep: '#5c2d35',
      shadow: '#8b4a42',
      dark: '#b0654e',
      mid: '#c27a5a',
      base: '#d89c76',
      light: '#f0cba3',
      rim: '#fae9c6',
    },
    hairRamp: {
      deep: '#2a1316',
      shadow: '#421e1a',
      dark: '#5c2e1f',
      mid: '#784326',
      base: '#975b2b',
      light: '#b97d38',
      rim: '#d8ae5a',
    },
    hairStyle: 'long',
    garmentRamp: deriveGlossRamp('#c81e78'),
    garmentHemDrop: 0.65,
    garmentHemFlare: 1.6,
    garmentHasHardware: false,
    accessory: { kind: 'none', color: '#000000' },
    legwear: 'none',
    pantsColor: '#2a1a2a',
    expression: DANCER_EXPRESSION,
  };
  return look;
}
