/**
 * Every skyfowl look in the game, as data: a closed set of civilian street
 * looks plus the fightable street-tough family, each a build, a plumage
 * pattern, an outfit and a base posture.
 *
 * The cache keys on `(figure, state, frame)`, so a look is never read off an
 * instance — each entry here gets its own `FigureId` in
 * `skyfowlCastFigure.ts`, exactly as the ratkin cast does.
 */

import type { SkyfowlBuild } from './palette';
import {
  CORVIDBLACK,
  DOVEGREY,
  GOLDENBARRED,
  HAWKBROWN,
  SPARROWFLECK,
  STREETTOUGH_MARKING,
  type PlumagePattern,
} from './palette';
import type { SkyfowlOutfit } from './outfit';
import type { Ramp } from './paint';
import {
  apron,
  clerkVest,
  corporalTabard,
  crudeClubProp,
  cuirass,
  dancerSash,
  guardHelm,
  inkSleeves,
  ledgerProp,
  lodgeCoat,
  needleProp,
  nobleCloak,
  packHarness,
  raggedWrap,
  sackProp,
  sawProp,
  smithApron,
  smock,
  spearProp,
  tankardProp,
  templeCirclet,
  templeRobe,
  toolBelt,
  tongsProp,
  workTunic,
} from './outfit';
import type { SkyfowlPosture } from './rows';

function ramp(
  dark: string,
  mid: string,
  light: string,
): { dark: string; mid: string; light: string } {
  return { dark, mid, light };
}

// ── Role outfits ─────────────────────────────────────────────────────────────

export type SkyfowlRole =
  | 'merchant'
  | 'guard'
  | 'laborer'
  | 'clerk'
  | 'temple'
  | 'noble'
  | 'porter'
  | 'fledgling'
  | 'street_tough'
  | 'dancer';

const MERCHANT_APRON = ramp('#8a7550', '#cfc09a', '#f2ead2');
const GUARD_STEEL = ramp('#22303e', '#3d5b74', '#6f96ae');
const LABORER_BELT = ramp('#3a2a1a', '#6a4c2c', '#8f6a42');
const LABORER_TUNIC = ramp('#4a3c28', '#7c6848', '#a4906a');
const CLERK_CLOTH = ramp('#28324a', '#405070', '#5e749a');
const TEMPLE_CLOTH = ramp('#1e3a44', '#3a6270', '#5e93a0');
const NOBLE_CLOTH = ramp('#3a1e40', '#5e3468', '#805a8c');
const PORTER_HARNESS = ramp('#3a281a', '#6a4a2c', '#8f6a44');
const FLEDGLING_SMOCK = ramp('#8a7850', '#c2ac78', '#e0d0a0');
const TOUGH_WRAP = ramp('#3a0a18', '#7c1032', '#a82442');
const DANCER_SASH_A = ramp('#3a0838', '#a01890', '#e850c8');
const DANCER_SASH_B = ramp('#0a3a3a', '#189a8c', '#4de8d4');

function roleOutfit(
  role: Exclude<SkyfowlRole, 'street_tough' | 'dancer'>,
  plumage: PlumagePattern,
  build: SkyfowlBuild,
): SkyfowlOutfit {
  switch (role) {
    case 'merchant':
      return { plumage, build, garments: [apron(MERCHANT_APRON)], heldProp: sackProp() };
    case 'guard':
      return {
        plumage,
        build,
        garments: [cuirass(GUARD_STEEL), guardHelm(GUARD_STEEL)],
        heldProp: spearProp(),
      };
    case 'laborer':
      return { plumage, build, garments: [workTunic(LABORER_TUNIC), toolBelt(LABORER_BELT)] };
    case 'clerk':
      return { plumage, build, garments: [clerkVest(CLERK_CLOTH)], heldProp: ledgerProp() };
    case 'temple':
      return { plumage, build, garments: [templeRobe(TEMPLE_CLOTH)] };
    case 'noble':
      return { plumage, build, garments: [nobleCloak(NOBLE_CLOTH)] };
    case 'porter':
      return {
        plumage,
        build,
        garments: [workTunic(PORTER_HARNESS), packHarness(PORTER_HARNESS)],
        heldProp: sackProp(),
      };
    case 'fledgling':
      return { plumage, build: 'fledgling', garments: [smock(FLEDGLING_SMOCK)] };
    default:
      return { plumage, build, garments: [] };
  }
}

function dancerOutfit(plumage: PlumagePattern, build: SkyfowlBuild, sash: Ramp): SkyfowlOutfit {
  return { plumage, build, garments: [dancerSash(sash)] };
}

function streetToughOutfit(plumage: PlumagePattern, build: SkyfowlBuild): SkyfowlOutfit {
  const toughPlumage: PlumagePattern = {
    ...plumage,
    marking: STREETTOUGH_MARKING,
    markingStrength: 0.5,
    markingStyle: 'speckle',
  };
  return {
    plumage: toughPlumage,
    build,
    garments: [raggedWrap(TOUGH_WRAP)],
    heldProp: crudeClubProp(),
  };
}

// ── Looks ────────────────────────────────────────────────────────────────────

export interface SkyfowlLook {
  readonly id: string;
  readonly role: SkyfowlRole;
  readonly outfit: SkyfowlOutfit;
  readonly posture: SkyfowlPosture;
  /** True for the fightable street-tough family: `SkyFowl` mob wiring reads this later. */
  readonly fightable: boolean;
  /** True for the Desperado Club's dancer looks: adds one looping row per dance routine. */
  readonly dances?: boolean;
}

function civilianLook(
  id: string,
  role: Exclude<SkyfowlRole, 'street_tough' | 'dancer'>,
  plumage: PlumagePattern,
  build: SkyfowlBuild,
): SkyfowlLook {
  return {
    id,
    role,
    outfit: roleOutfit(role, plumage, build),
    posture: 'upright',
    fightable: false,
  };
}

function toughLook(id: string, plumage: PlumagePattern, build: SkyfowlBuild): SkyfowlLook {
  return {
    id,
    role: 'street_tough',
    outfit: streetToughOutfit(plumage, build),
    posture: 'hunched',
    fightable: true,
  };
}

function dancerLook(
  id: string,
  plumage: PlumagePattern,
  build: SkyfowlBuild,
  sash: Ramp,
): SkyfowlLook {
  return {
    id,
    role: 'dancer',
    outfit: dancerOutfit(plumage, build, sash),
    posture: 'upright',
    fightable: false,
    dances: true,
  };
}

/**
 * Sixteen civilian street looks, curated (not every build × plumage × role
 * combination) to spread the five plumage patterns and four builds across the
 * eight roles: hawkbrown widest, golden-barred rarest and reserved for
 * status.
 */
export const SKYFOWL_CIVILIAN_LOOKS: readonly SkyfowlLook[] = [
  civilianLook('merchant_hawkbrown_standard', 'merchant', HAWKBROWN, 'standard'),
  civilianLook('merchant_sparrowfleck_slight', 'merchant', SPARROWFLECK, 'slight'),
  civilianLook('guard_hawkbrown_standard', 'guard', HAWKBROWN, 'standard'),
  civilianLook('guard_corvidblack_heavy', 'guard', CORVIDBLACK, 'heavy'),
  civilianLook('laborer_hawkbrown_heavy', 'laborer', HAWKBROWN, 'heavy'),
  civilianLook('laborer_sparrowfleck_standard', 'laborer', SPARROWFLECK, 'standard'),
  civilianLook('clerk_dovegrey_slight', 'clerk', DOVEGREY, 'slight'),
  civilianLook('clerk_dovegrey_standard', 'clerk', DOVEGREY, 'standard'),
  civilianLook('temple_dovegrey_standard', 'temple', DOVEGREY, 'standard'),
  civilianLook('temple_corvidblack_heavy', 'temple', CORVIDBLACK, 'heavy'),
  civilianLook('noble_goldenbarred_standard', 'noble', GOLDENBARRED, 'standard'),
  civilianLook('noble_goldenbarred_heavy', 'noble', GOLDENBARRED, 'heavy'),
  civilianLook('porter_sparrowfleck_standard', 'porter', SPARROWFLECK, 'standard'),
  civilianLook('porter_hawkbrown_slight', 'porter', HAWKBROWN, 'slight'),
  civilianLook('fledgling_hawkbrown', 'fledgling', HAWKBROWN, 'fledgling'),
  civilianLook('fledgling_sparrowfleck', 'fledgling', SPARROWFLECK, 'fledgling'),
];

/**
 * The fightable street-tough family: bruised plum and rust-iron, dulled
 * plumage, a hunched stance — a colour family and posture no civilian look
 * above uses, so the mixed lineup and blind review can test whether it reads
 * as hostile at a glance.
 */
export const SKYFOWL_TOUGH_LOOKS: readonly SkyfowlLook[] = [
  toughLook('tough_hawkbrown_standard', HAWKBROWN, 'standard'),
  toughLook('tough_corvidblack_standard', CORVIDBLACK, 'standard'),
  toughLook('tough_sparrowfleck_slight', SPARROWFLECK, 'slight'),
  toughLook('tough_hawkbrown_heavy', HAWKBROWN, 'heavy'),
];

/**
 * The Desperado Club's skyfowl dancers: two looks, distinct sash colours so
 * the dance floor doesn't read as one figure doubled.
 */
export const SKYFOWL_DANCER_LOOKS: readonly SkyfowlLook[] = [
  dancerLook('dancer_sparrowfleck_slight', SPARROWFLECK, 'slight', DANCER_SASH_A),
  dancerLook('dancer_goldenbarred_standard', GOLDENBARRED, 'standard', DANCER_SASH_B),
];

// ── Named residents ──────────────────────────────────────────────────────────
//
// One look per named skyfowl resident, never picked by the street crowd —
// `citizenFigure.ts` only pools from `SKYFOWL_CIVILIAN_LOOKS`, so these stay
// unique to the individual they were built for.

const SMITH_LEATHER = ramp('#2a2016', '#4a3624', '#6a4c34');
const LODGE_COAT_CLOTH = ramp('#2a323a', '#445260', '#6a7c8c');
const CORPORAL_STEEL = ramp('#242e3a', '#3d5266', '#6488a0');
const CORPORAL_STRIPE = '#c9a24a';
const INK_SLEEVE_CLOTH = ramp('#302838', '#4c4058', '#6c5c7c');
const INK_STAIN = '#1a1420';
const TEMPLE_CIRCLET_GOLD = '#d4b04a';
const INNKEEP_OSSIE_CLOTH = ramp('#5a3a1e', '#8a5c32', '#b98450');
const INNKEEP_BREND_CLOTH = ramp('#1e2a3a', '#344c66', '#547090');
const QUARTERMASTER_CLOTH = ramp('#3a3c2e', '#5c604a', '#7e8266');
const KEEPER_APRON = ramp('#7a6a34', '#c2b070', '#e8dca8');

/**
 * Brann's own outfit: the same laborer base every civilian wheelwright
 * wears, plus a hand saw in place of the belt's mallet — his trade's own
 * signature tool, not the generic labourer's.
 */
function brannOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'standard',
    garments: [workTunic(LABORER_TUNIC), toolBelt(LABORER_BELT)],
    heldProp: sawProp(),
  };
}

function avielOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'heavy',
    garments: [templeRobe(TEMPLE_CLOTH), templeCirclet(TEMPLE_CIRCLET_GOLD)],
  };
}

function vargaOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'heavy',
    garments: [smithApron(SMITH_LEATHER)],
    heldProp: tongsProp(),
  };
}

function ossieOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'standard',
    garments: [apron(INNKEEP_OSSIE_CLOTH)],
    heldProp: tankardProp(),
  };
}

function brendOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'standard',
    garments: [clerkVest(INNKEEP_BREND_CLOTH)],
    heldProp: ledgerProp(),
  };
}

function kesslerOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return { plumage, build: 'standard', garments: [lodgeCoat(LODGE_COAT_CLOTH)] };
}

function pellOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'standard',
    garments: [corporalTabard(CORPORAL_STEEL, CORPORAL_STRIPE), guardHelm(CORPORAL_STEEL)],
    heldProp: spearProp(),
  };
}

function dannOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'heavy',
    garments: [clerkVest(QUARTERMASTER_CLOTH)],
    heldProp: ledgerProp(),
  };
}

function nimOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'slight',
    garments: [inkSleeves(INK_SLEEVE_CLOTH, INK_STAIN)],
    heldProp: needleProp(),
  };
}

function kestrelOutfit(plumage: PlumagePattern): SkyfowlOutfit {
  return {
    plumage,
    build: 'standard',
    garments: [apron(KEEPER_APRON)],
    heldProp: sackProp(),
  };
}

function residentLook(id: string, role: SkyfowlRole, outfit: SkyfowlOutfit): SkyfowlLook {
  return { id, role, outfit, posture: 'upright', fightable: false };
}

/**
 * Ten named skyfowl residents, each on their own outfit — none of them a
 * civilian look wearing a different colour. `role` here only categorises the
 * work row (a stationed trade's loop); it never feeds `citizenFigure.ts`'s
 * random picker, since these looks are never added to
 * `SKYFOWL_CIVILIAN_LOOKS`.
 */
export const SKYFOWL_RESIDENT_LOOKS: readonly SkyfowlLook[] = [
  residentLook('resident_brann_cartwright', 'laborer', brannOutfit(CORVIDBLACK)),
  residentLook('resident_deacon_aviel', 'temple', avielOutfit(GOLDENBARRED)),
  residentLook('resident_smith_varga', 'laborer', vargaOutfit(CORVIDBLACK)),
  residentLook('resident_innkeep_ossie', 'merchant', ossieOutfit(HAWKBROWN)),
  residentLook('resident_innkeep_brend', 'merchant', brendOutfit(DOVEGREY)),
  residentLook('resident_sgt_kessler', 'guard', kesslerOutfit(CORVIDBLACK)),
  residentLook('resident_corporal_pell', 'guard', pellOutfit(SPARROWFLECK)),
  residentLook('resident_quartermaster_dann', 'clerk', dannOutfit(DOVEGREY)),
  residentLook('resident_tattooist_nim', 'merchant', nimOutfit(SPARROWFLECK)),
  residentLook('resident_keeper_brenna_kestrel', 'merchant', kestrelOutfit(GOLDENBARRED)),
];

export const SKYFOWL_LOOKS: readonly SkyfowlLook[] = [
  ...SKYFOWL_CIVILIAN_LOOKS,
  ...SKYFOWL_TOUGH_LOOKS,
  ...SKYFOWL_DANCER_LOOKS,
  ...SKYFOWL_RESIDENT_LOOKS,
];

export type SkyfowlLookId = (typeof SKYFOWL_LOOKS)[number]['id'];

const SKYFOWL_LOOKS_BY_ID: ReadonlyMap<SkyfowlLookId, SkyfowlLook> = new Map(
  SKYFOWL_LOOKS.map((look) => [look.id, look]),
);

/** A skyfowl look by its own id — for the resident figure lookup and the harness. */
export function skyfowlLookById(id: SkyfowlLookId): SkyfowlLook {
  const found = SKYFOWL_LOOKS_BY_ID.get(id);
  if (found === undefined) throw new Error(`no skyfowl look "${id}"`);
  return found;
}
