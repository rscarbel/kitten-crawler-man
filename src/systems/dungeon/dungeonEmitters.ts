/**
 * Where the dungeon's ambient loops come from: the floor's bed, a bed for each
 * room whose character names one, and a positional loop at every light and
 * fixture that makes a noise while it works.
 *
 * Pure: it reads the map and the lighting pass's list of static lights and
 * returns a plan, so the gates can check it without an audio context. Every
 * planned emitter names a cue, silent cues included; the ambience system
 * voices only the cues that have a sound.
 *
 * A light is planned only while it is alive: lit by the lighting pass, and
 * still standing — its prop tile still the prop, its wall fixture whole and
 * powered. The second test matters on the frame a light is smashed: the
 * lighting pass notices the missing prop on its next update, but a rescan run
 * straight after the break must already leave the light out.
 */

import type { GameMap } from '../../map/GameMap';
import { BONE_PILE, BONES, FloorTypeValue, SLUMPED_SKELETON } from '../../map/tileTypes';
import { isFixtureLit, type WallFixture } from '../../map/dungeon/wallFixtures';
import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';
import { FLOOR_AMBIENCE_BED } from '../../map/dungeon/roomCharacters';
import { STATIC_LIGHT_FIXTURES } from '../DungeonLightingSystem';
import type { LightKind } from '../lighting/lightKinds';
import { AMBIENCE_BED_CUES, type DungeonCue } from './dungeonSoundCues';
import { isRemainsPropKind } from '../destruction/remainsPropKinds';

/** One static light as the lighting pass lists it. */
export interface StaticLightTile {
  readonly x: number;
  readonly y: number;
  readonly kind: LightKind;
  readonly on: boolean;
}

/** What made an emitter, for the gates and for the camera's turning test. */
export type EmitterSource = 'floor_bed' | 'room_bed' | 'light' | 'fixture' | 'camera' | 'flies';

export interface PlannedEmitter {
  readonly cue: DungeonCue;
  readonly source: EmitterSource;
  /** The tile it was planned from: the light's, the fixture's face, the room's centre. */
  readonly tileX: number;
  readonly tileY: number;
  /** Where it sounds from, in tile coordinates (centres are `.5`). */
  readonly x: number;
  readonly y: number;
  readonly radiusTiles: number;
  readonly maxVolume: number;
  /** Heard at {@link maxVolume} everywhere on the floor. */
  readonly constant: boolean;
}

export interface EmitterPlanInput {
  readonly gameMap: Pick<
    GameMap,
    'structure' | 'wallFixtures' | 'roomBounds' | 'regionCharacters' | 'regionAt'
  >;
  readonly floor: DungeonFloorThemeId;
  /** The lighting pass's static lights, or null on a floor it does not light. */
  readonly lights: ReadonlyArray<StaticLightTile> | null;
  /**
   * Every tile that held bones when the floor was built
   * ({@link flySiteCandidates}), so a rescan need not walk the whole map;
   * found by a scan when absent.
   */
  readonly flySiteCandidates?: ReadonlyArray<TilePoint>;
  /** Tiles where smashed bone piles and skeletons lie ({@link boneRemainsTiles}). */
  readonly boneRemains?: ReadonlyArray<TilePoint>;
}

/** How loud and how far each kind of loop carries. */
interface LoopVoice {
  readonly cue: DungeonCue;
  readonly radiusTiles: number;
  readonly maxVolume: number;
}

const FLOOR_BED_VOLUME = 0.35;
const ROOM_BED_VOLUME = 0.5;
/** A room's bed carries this far out of its doorways before it fades out. */
const ROOM_BED_SPILL_TILES = 3;
const TILE_CENTRE = 0.5;

/** The loop each kind of light makes while it burns or hums; absent is silent. */
const LIGHT_VOICES: Readonly<Partial<Record<LightKind, LoopVoice>>> = {
  wall_sconce: { cue: 'torchBurn', radiusTiles: 5, maxVolume: 0.25 },
  standing_torch: { cue: 'torchBurn', radiusTiles: 5, maxVolume: 0.25 },
  brazier: { cue: 'brazierCrackle', radiusTiles: 7, maxVolume: 0.4 },
  fluorescent_tube: { cue: 'fluorescentHum', radiusTiles: 5, maxVolume: 0.2 },
  sodium_lamp: { cue: 'fluorescentHum', radiusTiles: 5, maxVolume: 0.12 },
  vending_glow: { cue: 'panelBuzz', radiusTiles: 4, maxVolume: 0.25 },
  boiler_window: { cue: 'boilerRoomBed', radiusTiles: 8, maxVolume: 0.5 },
};

/** The loop each non-light fixture makes while it is whole; absent is silent. */
const FIXTURE_VOICES: Readonly<Partial<Record<WallFixture['kind'], LoopVoice>>> = {
  fuse_box: { cue: 'panelBuzz', radiusTiles: 4, maxVolume: 0.2 },
  steam_valve: { cue: 'steamLeak', radiusTiles: 4, maxVolume: 0.3 },
};

/** A camera dome's servo, voiced only while it turns. */
export const CAMERA_SERVO_VOICE: LoopVoice = { cue: 'cameraServo', radiusTiles: 6, maxVolume: 0.3 };

/** Flies over a bone pile or a slumped skeleton. */
const FLIES_VOICE: LoopVoice = { cue: 'fliesBuzz', radiusTiles: 3, maxVolume: 0.2 };

/** A tile, by its coordinates. */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** Flies gather over at most this many bone sites in one room or hallway. */
export const FLY_SITES_PER_REGION = 2;

/** Every tile on the map flies could gather over. A full scan: run it once per floor. */
export function flySiteCandidates(structure: GameMap['structure']): TilePoint[] {
  const out: TilePoint[] = [];
  for (let y = 0; y < structure.length; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      if (FLY_SITE_TILE_TYPES.has(row[x].type)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Where flies gather now: the candidates still holding bones, and the
 * remains of smashed bone piles and skeletons (`remains`, which outlast the
 * break), at most {@link FLY_SITES_PER_REGION} a region between them.
 */
export function liveFlySites(
  gameMap: Pick<GameMap, 'structure' | 'regionAt'>,
  candidates: ReadonlyArray<TilePoint>,
  remains: ReadonlyArray<TilePoint> = [],
): TilePoint[] {
  const perRegion = new Map<number, number>();
  const out: TilePoint[] = [];
  const take = (site: TilePoint): void => {
    const region = gameMap.regionAt(site.x, site.y);
    const taken = perRegion.get(region) ?? 0;
    if (taken >= FLY_SITES_PER_REGION) return;
    perRegion.set(region, taken + 1);
    out.push(site);
  };
  for (const site of candidates) {
    if (FLY_SITE_TILE_TYPES.has(gameMap.structure[site.y][site.x].type)) take(site);
  }
  for (const site of remains) take(site);
  return out;
}

/** The wreckage of bone piles and skeletons, as tiles flies can gather over. */
export function boneRemainsTiles(
  wreckage: ReadonlyArray<{
    readonly tileX: number;
    readonly tileY: number;
    readonly kind: string | null;
  }>,
): TilePoint[] {
  const out: TilePoint[] = [];
  for (const piece of wreckage) {
    if (piece.kind !== null && isRemainsPropKind(piece.kind))
      out.push({ x: piece.tileX, y: piece.tileY });
  }
  return out;
}

/** The tile types flies gather over. */
export const FLY_SITE_TILE_TYPES: ReadonlySet<number> = new Set([
  BONE_PILE,
  SLUMPED_SKELETON,
  BONES,
]);

function positional(
  voice: LoopVoice,
  source: EmitterSource,
  tileX: number,
  tileY: number,
): PlannedEmitter {
  return {
    cue: voice.cue,
    source,
    tileX,
    tileY,
    x: tileX + TILE_CENTRE,
    y: tileY + TILE_CENTRE,
    radiusTiles: voice.radiusTiles,
    maxVolume: voice.maxVolume,
    constant: false,
  };
}

/** Every ambient emitter the floor has right now. */
export function planDungeonEmitters(input: EmitterPlanInput): PlannedEmitter[] {
  const { gameMap } = input;
  const structure = gameMap.structure;
  const width = structure[0]?.length ?? 0;
  const planned: PlannedEmitter[] = [];

  planned.push({
    cue: AMBIENCE_BED_CUES[FLOOR_AMBIENCE_BED[input.floor]],
    source: 'floor_bed',
    tileX: 0,
    tileY: 0,
    x: 0,
    y: 0,
    radiusTiles: 0,
    maxVolume: FLOOR_BED_VOLUME,
    constant: true,
  });

  gameMap.roomBounds.forEach((bounds, roomId) => {
    const assignment = gameMap.regionCharacters.forRegion(roomId);
    if (assignment === null || assignment.type === 'special') return;
    const bed = assignment.character.ambience.bed;
    if (bed === null) return;
    const centreX = bounds.x + bounds.w / 2;
    const centreY = bounds.y + bounds.h / 2;
    planned.push({
      cue: AMBIENCE_BED_CUES[bed],
      source: 'room_bed',
      tileX: Math.floor(centreX),
      tileY: Math.floor(centreY),
      x: centreX,
      y: centreY,
      radiusTiles: Math.hypot(bounds.w, bounds.h) / 2 + ROOM_BED_SPILL_TILES,
      maxVolume: ROOM_BED_VOLUME,
      constant: false,
    });
  });

  const fixtureByTile = new Map<number, WallFixture>();
  for (const fixture of gameMap.wallFixtures) {
    fixtureByTile.set(fixture.tileY * width + fixture.tileX, fixture);
  }

  for (const light of input.lights ?? []) {
    if (!light.on) continue;
    const voice = LIGHT_VOICES[light.kind];
    if (voice === undefined) continue;
    if (!lightStillStands(gameMap, fixtureByTile.get(light.y * width + light.x), light)) continue;
    planned.push(positional(voice, 'light', light.x, light.y));
  }

  for (const fixture of gameMap.wallFixtures) {
    if (fixture.state.broken) continue;
    if (fixture.kind === 'camera_dome') {
      planned.push(positional(CAMERA_SERVO_VOICE, 'camera', fixture.tileX, fixture.tileY));
      continue;
    }
    const voice = FIXTURE_VOICES[fixture.kind];
    if (voice === undefined) continue;
    planned.push(positional(voice, 'fixture', fixture.tileX, fixture.tileY));
  }

  const candidates = input.flySiteCandidates ?? flySiteCandidates(structure);
  for (const site of liveFlySites(gameMap, candidates, input.boneRemains ?? [])) {
    planned.push(positional(FLIES_VOICE, 'flies', site.x, site.y));
  }

  return planned;
}

/**
 * Whether what carries a lit light is still there: a wall fixture whole and
 * powered, a prop tile still the prop. A light hung on a bare wall with no
 * fixture under it (the goblin nursery's sconces) stands as long as the wall.
 */
function lightStillStands(
  gameMap: Pick<GameMap, 'structure' | 'wallFixtures'>,
  fixture: WallFixture | undefined,
  light: StaticLightTile,
): boolean {
  if (fixture !== undefined) return isFixtureLit(fixture, gameMap.wallFixtures);
  const row =
    light.y >= 0 && light.y < gameMap.structure.length ? gameMap.structure[light.y] : null;
  if (row === null || light.x < 0 || light.x >= row.length) return false;
  const type = row[light.x].type;
  return STATIC_LIGHT_FIXTURES.has(type) || type === FloorTypeValue.wall;
}
