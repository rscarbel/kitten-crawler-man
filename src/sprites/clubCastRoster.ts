/**
 * Which closed-set look draws each of the Desperado Club's non-named figures.
 *
 * The club is a mixed crowd, the same as the streets: station staff and the
 * dancers are fixed picks (one look, always the same look — the cache keys on
 * the look, not the instance), and the wandering patrons draw from a small
 * pool split roughly two skyfowl to one human, matching the town's own split.
 * None of this touches Clarabelle, Rosemarie, the Cretins, the DJ or the
 * casino dealer — every one of those keeps its own dedicated painter.
 */

import type { ClubFigureRef } from './clubCastFigure';
import {
  DANCE_BEATS_PER_LOOP,
  DANCE_FPS,
  DANCE_FRAMES_PER_BEAT,
  DANCE_STYLES,
  type DanceStyle,
} from './art/danceStyles';
import { clubDancerLook } from './person/clubCastLooks';
import { townCastLook } from './person/townCastLooks';

/** The bar counter: an apron-wearing skyfowl merchant look, reused from the street cast. */
export const CLUB_BARTENDER: ClubFigureRef = {
  species: 'skyfowl',
  lookId: 'merchant_hawkbrown_standard',
};

/** The club's own market stall: the General Store's own keeper look, reused. */
export const CLUB_MARKET_VENDOR: ClubFigureRef = {
  species: 'human',
  look: townCastLook('adult_merchant'),
};

/** The VIP lounge's host: a skyfowl look dressed for status, reused from the street cast. */
export const CLUB_VIP_HOST: ClubFigureRef = {
  species: 'skyfowl',
  lookId: 'noble_goldenbarred_standard',
};

/**
 * The dance floor's three looks — two skyfowl, one human, each with its own
 * dance routines — cycled across the floor's tiles so the crowd reads as more
 * than one dancer without a per-instance colour.
 */
export const CLUB_DANCER_REFS: readonly ClubFigureRef[] = [
  { species: 'skyfowl', lookId: 'dancer_sparrowfleck_slight' },
  { species: 'skyfowl', lookId: 'dancer_goldenbarred_standard' },
  { species: 'human', look: clubDancerLook() },
];

/**
 * The wandering patron pool: four skyfowl looks and two human looks, reused
 * street-cast civilians rather than new content — a nightclub crowd is
 * exactly the closed-set case a shared look cache is for.
 */
export const CLUB_PATRON_REFS: readonly ClubFigureRef[] = [
  { species: 'skyfowl', lookId: 'merchant_sparrowfleck_slight' },
  { species: 'skyfowl', lookId: 'clerk_dovegrey_standard' },
  { species: 'skyfowl', lookId: 'noble_goldenbarred_heavy' },
  { species: 'skyfowl', lookId: 'porter_hawkbrown_slight' },
  { species: 'human', look: townCastLook('adult_noble') },
  { species: 'human', look: townCastLook('adult_commoner') },
];

/** One dancer on the floor: which look, which routine, and how far into the bar it starts. */
export interface ClubDancer {
  readonly ref: ClubFigureRef;
  readonly style: DanceStyle;
  readonly loopOffsetSeconds: number;
}

/**
 * Dancers stagger by whole quarter-beats — everyone is still on the music's
 * grid, just not on the same count. Three quarter-beats a dancer walks the
 * offsets round the bar without two neighbours sharing one.
 */
const QUARTERS_PER_BEAT = 4;
const QUARTER_BEATS_PER_BAR = QUARTERS_PER_BEAT * DANCE_BEATS_PER_LOOP;
const QUARTER_BEAT_STAGGER = 3;
const FRAMES_PER_QUARTER_BEAT = DANCE_FRAMES_PER_BEAT / QUARTERS_PER_BEAT;

/**
 * The dancer on the `index`th dance-floor tile. The routine steps on by one
 * more every full lap of the looks, so no look always dances the same routine
 * and no two neighbouring tiles share a look and a routine — a floor that
 * reads as a crowd, not as one dancer cloned in lockstep.
 */
export function clubDancerAt(index: number): ClubDancer {
  const looks = CLUB_DANCER_REFS.length;
  const lap = Math.floor(index / looks);
  const quarterBeats = (index * QUARTER_BEAT_STAGGER) % QUARTER_BEATS_PER_BAR;
  return {
    ref: CLUB_DANCER_REFS[index % looks],
    style: DANCE_STYLES[(index + lap) % DANCE_STYLES.length],
    loopOffsetSeconds: (quarterBeats * FRAMES_PER_QUARTER_BEAT) / DANCE_FPS,
  };
}
