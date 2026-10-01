/**
 * The dungeon's sounds (floors 1 and 2), by what they mean rather than by file.
 *
 * Every play site on these floors raises a cue from {@link DUNGEON_CUES},
 * never a raw id, so each recording that lands is its registration in
 * `src/audio/sounds.ts` plus one line here. Most of these recordings do not
 * exist yet, so a cue either borrows the nearest sound the game already has
 * or is an empty list — silent — where nothing stands in. Each entry's JSDoc
 * names the file it is waiting for.
 *
 * A cue with several takes is rotated through, one take per play. A looping
 * cue (a bed or a positional loop) plays its first take only.
 *
 * Every one-shot id named here must be preloaded on both floors — the
 * `universal` group, or both `level1` and `level2` in `src/audio/sfxGroups.ts`
 * — and a looping cue's id may instead be a streamed one.
 * `AudioManager.play` returns silently on a buffer that was never preloaded,
 * and `npm run verify:dungeon-life` fails on any id that breaks this.
 *
 * ## Finding the cue for something that broke
 *
 * - A prop: {@link propEventCues}, from the event `DestructiblePropSystem`
 *   reports. It looks the kind up in {@link PROP_BREAK_CUES} first, then falls
 *   back on the kind's chief material ({@link MATERIAL_BREAK_CUES}), then on
 *   the kind's wood/iron/trash smash cue. A new breakable kind needs no entry
 *   here to make a sound; it needs one only to make a better one.
 * - A blow that does not break a prop: {@link PROP_STRUCK_CUES}, by kind (a
 *   dented locker, drum or cabinet).
 * - A wall fixture: {@link wallFixtureEventCues}, by fixture kind and what
 *   happened to it.
 * - A light that went out by being smashed: layer {@link LIGHT_OUT_CUE}.
 */

import type { SoundId } from '../../audio/sounds';
import type { WallFixtureKind } from '../../map/dungeon/wallFixtures';
import type { BreakMaterial, SmashCue } from '../destruction/breakMaterials';
import { WALL_FIXTURE_SPECS } from '../../map/dungeon/wallFixtures';
import type { AmbienceBedId, AmbientOneShotId } from '../../map/dungeon/roomCharacters';
import type { DestructiblePropKind, PropAudioEvent } from '../DestructiblePropSystem';
import type { WallFixtureEvent, WallFixtureEventName } from '../wallFixtureDamage';
import { CELLAR_PROP_KINDS, isCellarPropKind } from '../destruction/cellarPropKinds';
import { REMAINS_PROP_KINDS, isRemainsPropKind } from '../destruction/remainsPropKinds';
import type { ServicePropKind } from '../../sprites/art/serviceProps/serviceFurnitureArt';
import { SERVICE_PROP_KINDS } from '../destruction/serviceLevelPropKinds';
import { THEMED_PROP_MATERIALS, themedPropMaterials } from '../destruction/themedPropMaterials';
import { onServiceLevel } from '../../map/dungeon/propVariants';

export const DUNGEON_CUES = {
  // ── Beds ──
  /** Floor 1's bed under everything. Waits on `ambient_cellar_bed_loop`. */
  cellarBed: [],
  /** Floor 2's bed under everything. Waits on `ambient_service_level_bed_loop`. */
  serviceLevelBed: [],
  /** The flooded cellar and the flooded pump room. Waits on `ambient_flooded_room_loop`. */
  floodedRoomBed: [],
  /** The boiler room, and the boiler itself. Waits on `ambient_boiler_room_loop`; the spider lab's machinery stands in. */
  boilerRoomBed: ['tech_machinery_running'],

  // ── Positional loops ──
  /** A wall sconce or standing torch. Waits on `torch_burn_loop`; the brazier's crackle stands in. */
  torchBurn: ['ambient_fire_crackling'],
  /** A brazier. Final: `ambient_fire_crackling`. */
  brazierCrackle: ['ambient_fire_crackling'],
  /** Fluorescent tubes and sodium lamps. Waits on `fluorescent_hum_loop`. */
  fluorescentHum: [],
  /** A leaking pipe or steam valve. Waits on `steam_leak_loop`. */
  steamLeak: [],
  /** A breaker panel, and the vending machine. Waits on `electrical_panel_buzz_loop`. */
  panelBuzz: [],
  /** A security camera dome, only while it turns. Waits on `camera_servo_loop`. */
  cameraServo: [],
  /** Flies over a bone pile or a slumped skeleton. Waits on `flies_buzz_loop`. */
  fliesBuzz: [],

  // ── Ambient one-shots ──
  /** A drip landing in a puddle. Waits on `water_drip_1..4`. */
  waterDrip: [],
  /** Floor 2: a distant pipe knocking in the walls. Waits on `pipe_knock_1..3`. */
  pipeKnock: [],
  /** Floor 1: old stone settling, grit trickling down. Waits on `stone_settle_1..2`; `rumble` stands in. */
  stoneSettle: ['rumble'],
  /** Something unseen far off. Waits on `distant_growl_1..2`. */
  distantGrowl: [],
  /** A tube flickering: buzz, click, dark or back on. Waits on `fluorescent_flicker_1..3`. */
  fluorescentFlicker: [],

  // ── Breaking: the wood, iron, rubbish and glass cues every prop falls back on ──
  /** Splitting planks. Final: `wood_smashing_1..2`. */
  woodSmash: ['wood_smashing_1', 'wood_smashing_2'],
  /** Iron folding up. Final: `hammer_strike`. */
  ironSmash: ['hammer_strike'],
  /** A burst bag and the rubbish it held. Final: `garbage_bag_burst_1..2`. */
  trashBurst: ['garbage_bag_burst_1', 'garbage_bag_burst_2'],
  /** Glass going. Final: `glass_break_1..3`. */
  glassSmash: ['glass_break_1', 'glass_break_2', 'glass_break_3'],

  // ── Breaking: floor 1 ──
  /** A clay urn. Waits on `clay_pot_break_1..3`; the bag burst stands in. */
  clayPotBreak: ['garbage_bag_burst_1', 'garbage_bag_burst_2'],
  /** Layered on {@link DUNGEON_CUES.clayPotBreak} when the urn held coins. Waits on `urn_coins_spill`; `coin_pouch` stands in. */
  urnCoinsSpill: ['coin_pouch'],
  /** A grain sack split. Waits on `sack_tear_1..2`; the bag burst stands in. */
  sackTear: ['garbage_bag_burst_1', 'garbage_bag_burst_2'],
  /** Layered on {@link DUNGEON_CUES.sackTear}: grain pouring out. Waits on `grain_spill`. */
  grainSpill: [],
  /** A wine cask staved in. Waits on `wine_cask_burst`; `wood_smashing_1` stands in. */
  wineCaskBurst: ['wood_smashing_1'],
  /** A bottle rack coming down. Waits on `bottle_shelf_crash`; glass stands in. */
  bottleShelfCrash: ['glass_break_1', 'glass_break_2', 'glass_break_3'],
  /** A candle cluster knocked over. Final: `candle_stand_topple_1..2`. */
  candleStandTopple: ['candle_stand_topple_1', 'candle_stand_topple_2'],
  /** A rubble heap knocked down. Waits on `rubble_collapse`; `rock_breaking_1..2` stand in. */
  rubbleCollapse: ['rock_breaking_1', 'rock_breaking_2'],
  /** A bone pile or slumped skeleton smashed. Waits on `bones_clatter_1..3`; `wood_breaking_1` stands in. */
  bonesClatter: ['wood_breaking_1'],
  /** Slashing through a cobweb curtain. Waits on `cobweb_tear`. */
  cobwebTear: [],
  /** A sconce, torch or candle cluster smashed and guttering out. Waits on `torch_extinguish`. */
  torchExtinguish: [],
  /** A brazier knocked over, coals skittering. Waits on `coals_scatter`; `hammer_strike` stands in. */
  coalsScatter: ['hammer_strike'],
  /** Hanging chains struck and swinging. Waits on `chain_rattle_1..2`; `hammer_strike` stands in. */
  chainRattle: ['hammer_strike'],
  /** A torn banner slashed further. Waits on `banner_rip`. */
  bannerRip: [],

  // ── Breaking: floor 2 ──
  /** A locker, steel drum or filing cabinet hit and dented, not broken. Waits on `metal_dent_1..2`; `massive_metal_hit` stands in. */
  metalDent: ['massive_metal_hit'],
  /** A locker door wrenched open. Waits on `locker_burst`; `massive_metal_hit` stands in. */
  lockerBurst: ['massive_metal_hit'],
  /** A steel drum split. Waits on `drum_burst`; `massive_metal_hit` stands in. */
  drumBurst: ['massive_metal_hit'],
  /** A filing cabinet broken. Waits on `filing_cabinet_crash`; `massive_metal_hit` stands in. */
  filingCabinetCrash: ['massive_metal_hit'],
  /** A mop bucket or plastic crate smashed. Waits on `plastic_crack`; `wood_breaking_1` stands in. */
  plasticCrack: ['wood_breaking_1'],
  /** The wet-floor sign knocked flat and skidding. Waits on `wet_sign_skid`. */
  wetSignSkid: [],
  /** The vending machine's front smashed. Waits on `vending_glass_smash`; `glass_break_1` stands in. */
  vendingGlassSmash: ['glass_break_1'],
  /** A monitor or the monitor bank smashed. Waits on `monitor_pop`; `glass_break_2` stands in. */
  monitorPop: ['glass_break_2'],
  /** The security camera dome smashed. Waits on `camera_break`; `glass_break_3` stands in. */
  cameraBreak: ['glass_break_3'],
  /** A breaker panel smashed. Waits on `fuse_box_short`; `massive_metal_hit` stands in. */
  fuseBoxShort: ['massive_metal_hit'],
  /**
   * A gas cylinder's fuse, from the break to the blast. Waits on
   * `gas_cylinder_hiss`; the village's miasma hiss stands in, because the
   * hiss is the blast's warning and must not fall silent.
   */
  gasCylinderHiss: ['miasma_hiss'],
  /**
   * An oil spill catching light. Waits on `oil_fire_ignite`. The llama's
   * fireball whoosh stands in: the brazier crackle is a streamed loop, which a
   * one-shot cannot play.
   */
  oilFireIgnite: ['llama_fireball'],
  /** A steam valve struck: a sharp burst of steam. Waits on `steam_valve_burst`. */
  steamValveBurst: [],

  // ── Small moving things ──
  /** Beetles or roaches scattering. Waits on `critter_scuttle_1..3`. */
  critterScuttle: [],
  /** A footstep in a puddle. Waits on `puddle_step_1..4`. */
  puddleStep: [],
  /** Paper drifts lifting underfoot. Waits on `paper_rustle_1..2`. */
  paperRustle: [],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type DungeonCue = keyof typeof DUNGEON_CUES;

/** Every cue that loops: beds and positional loops play their first take, held. */
export const DUNGEON_LOOP_CUES: ReadonlySet<DungeonCue> = new Set<DungeonCue>([
  'cellarBed',
  'serviceLevelBed',
  'floodedRoomBed',
  'boilerRoomBed',
  'torchBurn',
  'brazierCrackle',
  'fluorescentHum',
  'steamLeak',
  'panelBuzz',
  'cameraServo',
  'fliesBuzz',
]);

/** The takes of a cue, empty while it is silent. */
export function dungeonCueTakes(cue: DungeonCue): readonly SoundId[] {
  return DUNGEON_CUES[cue];
}

/** A looping cue's sound, or null while it is silent. */
export function dungeonLoopSound(cue: DungeonCue): SoundId | null {
  const takes: readonly SoundId[] = DUNGEON_CUES[cue];
  return takes[0] ?? null;
}

/** How a one-shot cue is voiced; both optional, as on `AudioManager.play`. */
export interface DungeonCueVoicing {
  readonly volume?: number;
  readonly pan?: number;
}

/** What {@link playDungeonCue} needs of the audio manager. */
export interface DungeonCueAudio {
  play(id: SoundId, opts?: { volume?: number; pan?: number }): void;
}

/**
 * Plays `cue`'s next take through `audio`, rotating through its takes. Silent
 * for an empty cue. `played` keeps the rotation per caller; pass the same map
 * every time.
 */
export function playDungeonCue(
  audio: DungeonCueAudio | null,
  cue: DungeonCue,
  played: Map<DungeonCue, number>,
  voicing: DungeonCueVoicing = {},
): void {
  const takes: readonly SoundId[] = DUNGEON_CUES[cue];
  if (audio === null || takes.length === 0) return;
  const taken = played.get(cue) ?? 0;
  played.set(cue, taken + 1);
  audio.play(takes[taken % takes.length], voicing);
}

// ── Beds and one-shots, by the ids the room characters name ──────────────────

/** The cue each bed a floor or room character names plays. */
export const AMBIENCE_BED_CUES = {
  cellar_bed: 'cellarBed',
  service_level_bed: 'serviceLevelBed',
  flooded_room: 'floodedRoomBed',
  boiler_room: 'boilerRoomBed',
} as const satisfies Record<AmbienceBedId, DungeonCue>;

/** The cue each ambient one-shot a room character names plays. */
export const AMBIENT_ONE_SHOT_CUES = {
  water_drip: 'waterDrip',
  pipe_knock: 'pipeKnock',
  stone_settle: 'stoneSettle',
  distant_growl: 'distantGrowl',
  fluorescent_flicker: 'fluorescentFlicker',
} as const satisfies Record<AmbientOneShotId, DungeonCue>;

// ── Props ───────────────────────────────────────────────────────────────────

/**
 * A kind's own break, where its material's cue would say less than it should.
 * Cues after the first are layered on it.
 */
export const PROP_BREAK_CUES: Readonly<
  Partial<Record<DestructiblePropKind, readonly [DungeonCue, ...DungeonCue[]]>>
> = {
  brazier: ['coalsScatter', 'torchExtinguish'],
  garbage_bag: ['trashBurst'],
  clay_urn: ['clayPotBreak'],
  grain_sack: ['sackTear', 'grainSpill'],
  wine_cask: ['wineCaskBurst'],
  bottle_rack: ['bottleShelfCrash'],
  rubble_heap: ['rubbleCollapse'],
  candle_cluster: ['candleStandTopple', 'torchExtinguish'],
  // A fungus bursts soft and quiet, which the bag burst carries.
  glow_fungus: ['trashBurst'],
  bone_pile: ['bonesClatter'],
  slumped_skeleton: ['bonesClatter'],
  locker_bank: ['lockerBurst'],
  filing_cabinet: ['filingCabinetCrash'],
  mop_bucket: ['plasticCrack'],
  vending_machine: ['vendingGlassSmash'],
  // The fuse's hiss is the cylinder's warning, raised separately from the
  // fuse being lit; the break itself is the iron giving way.
  gas_cylinder: ['ironSmash'],
};

/** Floor 2's versions of the props both floors share, where they break differently. */
const SERVICE_LEVEL_BREAK_CUES: Readonly<
  Partial<Record<DestructiblePropKind, readonly [DungeonCue, ...DungeonCue[]]>>
> = {
  barrel: ['drumBurst'],
  barrel_side: ['drumBurst'],
  crate: ['plasticCrack'],
};

/** Floor 1's flames, which gutter out as they break. */
const CELLAR_BREAK_CUES: Readonly<
  Partial<Record<DestructiblePropKind, readonly [DungeonCue, ...DungeonCue[]]>>
> = {
  torch: ['woodSmash', 'torchExtinguish'],
};

/** What a break of a chief material sounds like, for a kind with no cue of its own. */
export const MATERIAL_BREAK_CUES = {
  wood: 'woodSmash',
  clay: 'clayPotBreak',
  glass: 'glassSmash',
  metal: 'ironSmash',
  cloth: 'sackTear',
  paper: 'trashBurst',
  stone: 'rubbleCollapse',
  bone: 'bonesClatter',
  wax: 'candleStandTopple',
  electrical: 'monitorPop',
  gas: 'ironSmash',
  plastic: 'plasticCrack',
} as const satisfies Record<BreakMaterial, DungeonCue>;

/**
 * What a blow that does not break sounds like, for the kinds that answer one
 * (sheet metal that dents); every other kind takes its blows in silence, the
 * swing's own sound carrying the hit.
 */
export const PROP_STRUCK_CUES: Readonly<Partial<Record<DestructiblePropKind, DungeonCue>>> = {
  locker_bank: 'metalDent',
  filing_cabinet: 'metalDent',
};

/** Floor 2's steel drums dent too; floor 1's barrels are oak. */
const SERVICE_LEVEL_STRUCK_CUES: Readonly<Partial<Record<DestructiblePropKind, DungeonCue>>> = {
  barrel: 'metalDent',
  barrel_side: 'metalDent',
};

/** The wood/iron/trash smash cues, for a kind none of the tables above names. */
const SMASH_CUE_FALLBACK = {
  wood: 'woodSmash',
  iron: 'ironSmash',
  trash: 'trashBurst',
} as const satisfies Record<SmashCue, DungeonCue>;

/** Layered on any break that puts a flame out. */
export const LIGHT_OUT_CUE: DungeonCue = 'torchExtinguish';

function isServiceKind(kind: DestructiblePropKind): kind is ServicePropKind {
  return kind in SERVICE_PROP_KINDS;
}

function isThemedKind(kind: DestructiblePropKind): kind is keyof typeof THEMED_PROP_MATERIALS {
  return kind in THEMED_PROP_MATERIALS;
}

/**
 * What a prop kind is chiefly made of on the current floor, or null for a kind
 * no material table names (a garbage bag).
 */
export function chiefMaterialOf(kind: DestructiblePropKind): BreakMaterial | null {
  if (isThemedKind(kind)) return themedPropMaterials(kind)[0];
  if (isCellarPropKind(kind)) return CELLAR_PROP_KINDS[kind].materials[0];
  if (isServiceKind(kind)) return SERVICE_PROP_KINDS[kind].materials[0];
  if (isRemainsPropKind(kind)) return REMAINS_PROP_KINDS[kind].materials[0];
  return null;
}

/**
 * The cues a broken prop plays, the first its own and the rest layered on it.
 * `smashCue` is the kind's wood/iron/trash smash cue, the last resort.
 */
export function propBreakCues(
  kind: DestructiblePropKind,
  smashCue: SmashCue,
  serviceLevel: boolean = onServiceLevel(),
): readonly DungeonCue[] {
  const floorOwn = serviceLevel ? SERVICE_LEVEL_BREAK_CUES[kind] : CELLAR_BREAK_CUES[kind];
  if (floorOwn !== undefined) return floorOwn;
  const own = PROP_BREAK_CUES[kind];
  if (own !== undefined) return own;
  const material = chiefMaterialOf(kind);
  if (material === null) return [SMASH_CUE_FALLBACK[smashCue]];
  // A themed prop's smash cue is already chosen per floor (an oak cask in
  // the cellars, a steel drum below), which says more than its chief
  // material does.
  if (isThemedKind(kind)) return [SMASH_CUE_FALLBACK[smashCue]];
  return [MATERIAL_BREAK_CUES[material]];
}

/** The cues a prop's blow, break or skid plays; empty for one that is silent. */
export function propEventCues(event: PropAudioEvent): readonly DungeonCue[] {
  switch (event.name) {
    case 'sign_skid':
      return ['wetSignSkid'];
    case 'ignited':
      return ['oilFireIgnite'];
    case 'scuttled':
      return ['critterScuttle'];
    case 'struck': {
      const floorOwn = onServiceLevel() ? SERVICE_LEVEL_STRUCK_CUES[event.kind] : undefined;
      const struck = floorOwn ?? PROP_STRUCK_CUES[event.kind];
      return struck === undefined ? [] : [struck];
    }
    case 'broken': {
      const cues = propBreakCues(event.kind, event.smashCue);
      if (event.kind === 'clay_urn' && event.coins) return [...cues, 'urnCoinsSpill'];
      return cues;
    }
  }
}

// ── Wall fixtures ───────────────────────────────────────────────────────────

/** A fixture's cue for each thing that can happen to it; absent is silent. */
type FixtureEventCues = Readonly<Partial<Record<WallFixtureEventName, readonly DungeonCue[]>>>;

/** What happens to each fixture, and what it sounds like. */
export const WALL_FIXTURE_EVENT_CUES = {
  sconce: { broken: ['ironSmash', 'torchExtinguish'] },
  fluorescent_tube: { broken: ['glassSmash'] },
  sodium_lamp: { broken: ['glassSmash'] },
  emergency_light: { broken: ['monitorPop'] },
  // The short's own recording carries the power-down whine; the flicker is
  // the tubes' last gasp, which the stand-in does not have.
  fuse_box: { struck: ['metalDent'], broken: ['fuseBoxShort'], power_down: ['fluorescentFlicker'] },
  steam_valve: { hissed: ['steamValveBurst'] },
  camera_dome: { broken: ['cameraBreak'] },
  hanging_chains: { swung: ['chainRattle'] },
  torn_banner: { torn: ['bannerRip'] },
  monitor_bank: { broken: ['monitorPop'] },
} as const satisfies Record<WallFixtureKind, FixtureEventCues>;

/** The cues a fixture event plays; falls back on the fixture's material for a break. */
export function wallFixtureEventCues(event: WallFixtureEvent): readonly DungeonCue[] {
  const table: FixtureEventCues = WALL_FIXTURE_EVENT_CUES[event.kind];
  const own = table[event.name];
  if (own !== undefined) return own;
  if (event.name === 'broken')
    return [MATERIAL_BREAK_CUES[WALL_FIXTURE_SPECS[event.kind].material]];
  return [];
}
