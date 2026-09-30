/**
 * EscortAmbushSystem — the road's ambushes on Midge's walk from Briar Hollow
 * to Wendell's pasture.
 *
 * Three small waves of the necromancer's dead, each sprung the first time
 * Midge's progress along the road passes its mark: the first as she clears
 * the palisade, the other two out on the road.
 *
 * The road's sanctuary is the **town wall**, not the town's safe zone. The
 * safe zone is a circle forty tiles round the plaza that reaches out past
 * the wall to within twenty-odd tiles of the palisade: dead that kept it
 * would break off almost as soon as they came up, leaving a wave a war horn
 * and nothing else. So the road's dead ignore the safe zone while Midge and
 * the party are all outside the wall, and break off the moment one of them
 * is through it.
 *
 * Progress is walked, not taken off a straight line — the road to Garrison
 * Green can swing round the town to a far gate — and runs from the village
 * gate nearest the town by the walk (0) to a point still
 * {@link WAVE_SANCTUARY_CLEARANCE_TILES} short of the town wall (1): no wave
 * springs closer to the wall than that, where it could not reach her before
 * she was through it.
 *
 * A wave comes out of the wilds at Midge's back — not ahead of her across
 * the road — just past the edge of the party's sight (`offscreenSpawns.ts`,
 * the rules the siege's dead come up by), never inside the town wall, never
 * inside the palisade, and never once the escort is over. The wave is
 * announced with the side it comes from as its first body comes up, and
 * each ambusher still off screen
 * is pointed at from the screen's edge. Its bodies go straight for the
 * nearest of the party and Midge wherever they are (`forceAggro`), since a
 * wave that came up off screen would otherwise never notice anyone, and one
 * left behind out of anybody's sight is let go.
 *
 * The count of waves sprung lives in the escort's carry record, so a door
 * visit mid-road neither re-arms a wave nor loses one. Midge being scared
 * home re-arms all three.
 */

import { TILE_SIZE } from '../../core/constants';
import type { AudioManager } from '../../audio/AudioManager';
import { applySpawnDifficulty, type DifficultyProfile } from '../../core/difficultyProfiles';
import type { MidgeEscortCarry } from '../../core/midgeEscortCarry';
import { isWorldPointInView, visibleWorldView } from '../../core/visibleWorldView';
import type { Mob } from '../../creatures/Mob';
import type { Player } from '../../Player';
import { RaisedRatkin } from '../../creatures/RaisedRatkin';
import { tryConsumePathfind } from '../../creatures/pathfindBudget';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import type { MobRoster } from '../kits/SceneWorld';
import { BLUEPRINTS_ESCORT_MUSIC } from './blueprints/blueprintsSoundCues';
import { isUnseenSpawn, placeAmong, spawnDue, type OffscreenSpawnRules } from './offscreenSpawns';
import { createUndead, type SiegeMusicClaim } from './VillageAssaultSystem';

const UPDATES_PER_SECOND = 60;
const TILE_CENTRE = 0.5;
const FULL_TURN = Math.PI * 2;
const HALF_TURN_DEGREES = 180;
const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / HALF_TURN_DEGREES;

/** The first ambush: Midge just clear of the palisade. */
const PALISADE_CLEARED_PROGRESS = 0.05;
/** The second: well out on the road. */
const MID_ROAD_PROGRESS = 0.4;
/** The last: with room left to fight before the town. */
const LATE_ROAD_PROGRESS = 0.75;
/** The progress along the road at which each wave springs, in order. */
export const ESCORT_WAVE_PROGRESS: readonly number[] = [
  PALISADE_CLEARED_PROGRESS,
  MID_ROAD_PROGRESS,
  LATE_ROAD_PROGRESS,
];
/** How many ambushes the road holds. */
export const ESCORT_WAVE_COUNT = ESCORT_WAVE_PROGRESS.length;
/**
 * The fewest and most bodies one wave brings. Nine: the road's ambushes are
 * a deliberate horde, three bodies to each crawler and three more for the
 * cow, so the party cannot simply stand in front of Midge and trade blows
 * with a line of three. `verify:difficulty-curve` prices a wave this size on
 * its own band for the escort, since no room on the floor fields nine.
 */
export const ESCORT_WAVE_MIN_BODIES = 9;
export const ESCORT_WAVE_MAX_BODIES = 9;
/**
 * Each of the road's dead comes at this share of its kind's health: a horde
 * of lesser dead rather than nine of the wilds' own, so the danger is in how
 * many of them there are and how many get past the party to the cow, not in
 * any one of them. Their blows are their kind's own. Tuned by playtest.
 */
export const ESCORT_BODY_HEALTH_SHARE = 0.4;
/** What the road's ambushers are drawn from: the dead that roam these wilds. */
export const ESCORT_AMBUSH_KINDS = [
  'ruins_ghoul',
  'raised_ratkin',
  'skeleton_warrior',
  'skeleton_archer',
] as const;
/** One of the road's ambusher kinds. */
export type EscortAmbushKind = (typeof ESCORT_AMBUSH_KINDS)[number];
/**
 * The most of a kind one wave may bring. The ghoul hits hardest of the four:
 * one in every three bodies at most, as a wave of three held it to one.
 */
export const ESCORT_KIND_CAPS: Readonly<Partial<Record<EscortAmbushKind, number>>> = {
  ruins_ghoul: 3,
};

/**
 * A wave springs only while the road is clear: at most this many ambushers
 * still in the fight, whichever wave — or whichever attempt, before a scare
 * sent Midge home — they came with. The waves are priced as fights of their
 * own, and one sprung over a leftover would be a fight nobody priced. One
 * left behind or stuck is out of the fight and holds nothing back.
 */
const ESCORT_WAVE_OVERLAP_BODIES = 0;
/**
 * And only once the road has been that clear for this long: a breather after
 * a fight, so on a map where the village stands close to the town — the
 * marks only a few tiles apart — the next wave does not follow on the last
 * blow of the one before.
 */
export const ESCORT_WAVE_MIN_GAP_SECONDS = 3;
const ESCORT_WAVE_MIN_GAP_FRAMES = ESCORT_WAVE_MIN_GAP_SECONDS * UPDATES_PER_SECOND;
/** No ambusher comes up within this many tiles of the town wall's ring. */
const TOWN_WALL_SPAWN_MARGIN_TILES = 2;
/** A wave's bodies come out one after another this far apart, so one blow never meets the lot. */
const WAVE_STAGGER_SECONDS = 0.6;
const WAVE_STAGGER_FRAMES = Math.round(WAVE_STAGGER_SECONDS * UPDATES_PER_SECOND);

/**
 * How far from Midge a wave's bodies may come up. Each is walked out along
 * its bearing from the nearest of these to the first spot out of the party's
 * sight, so it comes up just past the edge of the screen whichever way the
 * road runs — a screen is wider than it is tall, and a fixed distance that
 * is off screen above her is in plain view beside her. The far bound clears
 * the scene's fog of sight (thirty tiles round the active crawler, plus the
 * spawn's own margin), so a screen of any size has somewhere out of sight
 * inside it.
 */
const SPAWN_RING_MIN_TILES = 12;
const SPAWN_RING_MAX_TILES = 36;
/** Each step outward along a bearing while looking for the screen's edge, in tiles. */
const SPAWN_RING_STEP_TILES = 1;
/**
 * How far either side of "straight behind Midge" — the way from the party
 * through her — a wave's bearing may swing. Behind her rather than all
 * round: the road's dead are after the cow, and a wave out of the wilds at
 * her back reaches her before it reaches the party walking ahead of her.
 */
const WAVE_SWING_DEGREES = 40;
const WAVE_SWING_RADIANS = degreesToRadians(WAVE_SWING_DEGREES);
/**
 * No wave springs with Midge fewer than this many walked tiles from the town
 * wall: a wave raised past the edge of a wide screen, at her back, needs
 * about that much road to close on a cow the party keeps walking.
 */
export const WAVE_SANCTUARY_CLEARANCE_TILES = 20;
/** How far either side of its wave's bearing one body may come up, so a wave comes from one side of her. */
const SPAWN_SPREAD_DEGREES = 20;
const SPAWN_SPREAD_RADIANS = degreesToRadians(SPAWN_SPREAD_DEGREES);
/**
 * A body that finds nowhere out of sight behind her widens its search round
 * her over this long, until any side will do. Behind her can be the
 * palisade she has just left, or a lake: a wave held to that side would be a
 * war horn and nobody coming.
 */
const SPAWN_WIDEN_SECONDS = 3;
const SPAWN_WIDEN_FRAMES = SPAWN_WIDEN_SECONDS * UPDATES_PER_SECOND;
/** Directions round Midge a body is offered for each try at placing it. */
const SPAWN_ANCHORS_PER_TRY = 4;
/** How far round one of those points a body may come up. */
const SPAWN_SCATTER_TILES = 3;
/** How far crowded ground may be nudged to open ground. */
const SPAWN_SEARCH_TILES = 4;
/** Candidate tiles tried round one point. */
const SPAWN_ATTEMPTS = 4;
/** No ambusher appears this close to a crawler. */
const SPAWN_MIN_CRAWLER_TILES = 8;
/** With no camera published (a headless run), out of sight is this far from both crawlers. */
const SPAWN_UNSEEN_TILES = 20;
/** A body appears this far past the camera's edge, so none of it shows as it comes up. */
const SPAWN_OFFSCREEN_MARGIN_TILES = 2;
/**
 * A body never settles for a spot in view: an ambusher appearing in front of
 * the party is the one thing this rule is for. One with nowhere out of sight
 * waits, and is dropped after {@link SPAWN_GIVE_UP_SECONDS}.
 */
const SPAWN_DEFER_FRAMES = Number.POSITIVE_INFINITY;
/** A body that found nowhere to come up tries again after this many updates. */
const SPAWN_RETRY_FRAMES = 15;
/** How far a spawn's walk to Midge may run before the spot is refused as cut off from her. */
const SPAWN_PATH_BUDGET_TILES = SPAWN_RING_MAX_TILES * 2;
/**
 * A body that has found nowhere at all to come up after this long is dropped:
 * a wave on a road hemmed in by forest is short one body, not stuck holding
 * the music forever.
 */
const SPAWN_GIVE_UP_SECONDS = 10;
const SPAWN_GIVE_UP_FRAMES = SPAWN_GIVE_UP_SECONDS * UPDATES_PER_SECOND;

/**
 * An ambusher this far from everyone it could fight, and out of sight, for
 * {@link ABANDON_SECONDS} is let go. Past the furthest a body can come up —
 * the ring, the scatter round a point on it and the nudge to open ground —
 * with room to spare, or a body raised at the edge of a wide screen would
 * count as left behind on the frame it came up and be let go before it had
 * taken a step.
 */
const ABANDON_MARGIN_TILES = 4;
const ABANDON_TILES =
  SPAWN_RING_MAX_TILES + SPAWN_SCATTER_TILES + SPAWN_SEARCH_TILES + ABANDON_MARGIN_TILES;
/** No nearer to anyone for this long, and not yet at them, an ambusher is stuck. */
export const ESCORT_STUCK_SECONDS = 8;
const STUCK_FRAMES = ESCORT_STUCK_SECONDS * UPDATES_PER_SECOND;
/** Coming this much nearer counts as closing in. */
const CLOSING_STEP_TILES = 0.5;
/**
 * Within this many tiles of someone it could fight, an ambusher is in the
 * fight, however still it stands: a skeleton archer's bow reaches this far,
 * and it holds its distance to shoot rather than closing in.
 */
const IN_THE_FIGHT_TILES = 9;
const ABANDON_SECONDS = 6;
const ABANDON_FRAMES = ABANDON_SECONDS * UPDATES_PER_SECOND;

/** The four steps the road's walk is measured in. */
const ROAD_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** Fade-in for the escort's fight music as the first ambusher of a wave appears. */
const ESCORT_MUSIC_FADE_MS = 1200;

/** The eight points of the compass a wave is announced from, clockwise from east in screen space (y down). */
const COMPASS_WORDS = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
] as const;

/** How far in from the screen's edge the marker for an ambusher off screen sits. */
const INCOMING_MARKER_INSET_PX = 28;
/** The marker's length, tip to tail, and its half-width across the tail. */
const INCOMING_MARKER_LENGTH_PX = 14;
const INCOMING_MARKER_HALF_WIDTH_PX = 8;
/** How far back from the tip the tail's notch cuts in, as a share of the length. */
const INCOMING_MARKER_NOTCH_SHARE = 0.5;
const INCOMING_MARKER_FILL = '#dc2626';
const INCOMING_MARKER_OUTLINE = 'rgba(0,0,0,0.75)';
const INCOMING_MARKER_OUTLINE_PX = 2;
/** A slow throb rather than a flash, so it reads as "this way" rather than as a hit. */
const INCOMING_MARKER_PULSE_MS = 900;
const INCOMING_MARKER_MIN_ALPHA = 0.55;
const INCOMING_MARKER_ALPHA_RANGE = 0.4;

/** The caption a wave springs with, naming the side of the road it comes from. */
export function escortAmbushCaption(direction: string): string {
  return `Ambush! The dead come for Midge from the ${direction}!`;
}

/** The compass point nearest `bearing`, a screen-space angle in radians (0 is east, y runs down). */
export function compassWord(bearing: number): (typeof COMPASS_WORDS)[number] {
  const sector = FULL_TURN / COMPASS_WORDS.length;
  const turns = (((bearing % FULL_TURN) + FULL_TURN) % FULL_TURN) / sector;
  return COMPASS_WORDS[Math.round(turns) % COMPASS_WORDS.length];
}

type AmbushKind = EscortAmbushKind;

interface PendingAmbusher {
  readonly kind: AmbushKind;
  readonly dueFrame: number;
  /** Which wave sprung on this road it belongs to, counting every wave ever sprung. */
  readonly wave: number;
}

/**
 * The road as walked: every open tile's steps to the nearest tile inside the
 * town wall, and the steps from the village gate nearest the town.
 */
interface EscortRoad {
  readonly stepsToSanctuary: Int32Array;
  readonly size: number;
  readonly gateSteps: number;
}

/** A body in the world, by its top-left pixel. */
interface Body {
  readonly x: number;
  readonly y: number;
}

export interface EscortAmbushDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly roster: MobRoster;
  readonly audio: AudioManager | null;
  /** The overworld's zone music, which the fight music takes over from while ambushers live. */
  readonly music: () => SiegeMusicClaim | null;
  /** Both crawlers, wherever they stand. */
  readonly crawlers: () => readonly Body[];
  /** The level each ambusher comes at, rolled per body. */
  readonly level: () => number;
  readonly difficulty: () => DifficultyProfile;
  /** Played as each wave springs. */
  readonly sting: () => void;
  /** Shows the caption naming the side a wave comes from as it springs. */
  readonly announce: (message: string) => void;
  /** The escort's door-surviving record, which holds how many waves have sprung. */
  readonly carry: MidgeEscortCarry;
  /** Seeded in the gates; the game uses `Math.random`. */
  readonly random?: () => number;
}

/** One update of the road: where Midge is, whether she is being led, and whether the escort is still on. */
export interface EscortAmbushFrame {
  readonly midge: Player | null;
  readonly led: boolean;
  /** Whether the quest is at the escort step at all. */
  readonly escorting: boolean;
  /**
   * Whether the escort is held — the Plea's siege — so nothing springs or
   * comes up, but a wave already under way keeps its bodies still to come.
   */
  readonly held: boolean;
}

export class EscortAmbushSystem {
  private readonly random: () => number;
  private readonly spawnRules: OffscreenSpawnRules;
  private pending: PendingAmbusher[] = [];
  private readonly headSpawnWait = { frames: 0 };
  private readonly ambushers: Mob[] = [];
  /**
   * Each ambusher's distance to the fight: now; the mark its closing in is
   * measured from — where it last came nearer, or the furthest it has since
   * been pushed back to; and updates since it last came nearer.
   */
  private readonly fightOf = new Map<Mob, { tiles: number; mark: number; since: number }>();
  /** Updates each ambusher has spent far from everyone and out of sight. */
  private readonly strandedFrames = new Map<Mob, number>();
  private road: EscortRoad | null | undefined = undefined;
  private frame = 0;
  /** The first update the body at the head of the queue may try again for a place. */
  private nextPlaceFrame = 0;
  /**
   * The update the road last fell to {@link ESCORT_WAVE_OVERLAP_BODIES}
   * ambushers or fewer; null while more than that stand.
   */
  private quietSinceFrame: number | null = -Infinity;
  /** The Midge the current wave's bodies are placed round. */
  private midgeTile: TilePoint | null = null;
  /** The bearing, in radians, out from Midge that the current wave comes from. */
  private waveBearing = 0;
  /** The last wave whose side of the road has been announced. */
  private announcedWave = 0;
  private musicClaimed = false;
  /** Every wave ever sprung on this road, re-armed attempts included: each wave's own number. */
  private wavesEverSprung = 0;
  /** The wave each ambusher came with. */
  private readonly waveOfMob = new WeakMap<Mob, number>();
  /** Every ambusher ever raised on this road, for the gates. */
  spawnedTotal = 0;

  constructor(private readonly deps: EscortAmbushDeps) {
    this.random = deps.random ?? Math.random;
    this.spawnRules = {
      gameMap: deps.gameMap,
      crawlers: deps.crawlers,
      random: this.random,
      scatterTiles: SPAWN_SCATTER_TILES,
      searchTiles: SPAWN_SEARCH_TILES,
      attempts: SPAWN_ATTEMPTS,
      minCrawlerTiles: SPAWN_MIN_CRAWLER_TILES,
      unseenTiles: SPAWN_UNSEEN_TILES,
      offscreenMarginTiles: SPAWN_OFFSCREEN_MARGIN_TILES,
      deferFrames: SPAWN_DEFER_FRAMES,
      accepts: (x, y) => this.mayComeUpAt(x, y),
    };
  }

  /** How many of the road's waves have sprung on this attempt. */
  get wavesSprung(): number {
    return this.deps.carry.wavesSprung;
  }

  /** The road's ambushers still standing. */
  get livingAmbushers(): readonly Mob[] {
    return this.ambushers.filter((mob) => mob.isAlive);
  }

  /** Bodies of a sprung wave still to come up. */
  get bodiesToCome(): number {
    return this.pending.length;
  }

  /** Whether the road is clear of ambushers still in the fight, and has no bodies still to come. */
  get isRoadClear(): boolean {
    return this.quietSinceFrame !== null;
  }

  /** The wave `mob` came with, numbered across every wave ever sprung; null for one that is not the road's. */
  waveOf(mob: Mob): number | null {
    return this.waveOfMob.get(mob) ?? null;
  }

  /** Whether `mob` is one of the road's ambushers. */
  isAmbusher(mob: Mob): boolean {
    return this.ambushers.includes(mob);
  }

  /** Every wave armed again: the escort starts over from Merrit's gate. */
  rearm(): void {
    this.deps.carry.wavesSprung = 0;
    this.pending = [];
    this.headSpawnWait.frames = 0;
  }

  /**
   * How far along the road `body` stands, as walked: 0 at the village gate
   * nearest the town, 1 at {@link WAVE_SANCTUARY_CLEARANCE_TILES} short of
   * the town wall and on in. 0 anywhere inside the palisade, and 0 on
   * a map with no town to walk to or ground the road never reaches.
   */
  progressOf(body: Body): number {
    const road = this.escortRoad();
    if (road === null) return 0;
    const centreX = body.x + TILE_SIZE * TILE_CENTRE;
    const centreY = body.y + TILE_SIZE * TILE_CENTRE;
    if (this.deps.gameMap.isInBriarHollow(centreX, centreY)) return 0;
    const steps = this.stepsToSanctuary(road, body);
    if (steps === null) return 0;
    const stretch = road.gateSteps - WAVE_SANCTUARY_CLEARANCE_TILES;
    if (stretch <= 0) return 1;
    return Math.max(0, Math.min(1, (road.gateSteps - steps) / stretch));
  }

  /** Walked tiles from `body` to inside the town wall; null off the road's walk or with no town. */
  tilesToSanctuary(body: Body): number | null {
    const road = this.escortRoad();
    return road === null ? null : this.stepsToSanctuary(road, body);
  }

  private stepsToSanctuary(road: EscortRoad, body: Body): number | null {
    const tileX = Math.floor(body.x / TILE_SIZE + TILE_CENTRE);
    const tileY = Math.floor(body.y / TILE_SIZE + TILE_CENTRE);
    if (tileX < 0 || tileY < 0 || tileX >= road.size || tileY >= road.size) return null;
    const steps = road.stepsToSanctuary[tileY * road.size + tileX];
    return steps < 0 ? null : steps;
  }

  update(frame: EscortAmbushFrame): void {
    this.frame++;
    this.dropTheTurned();
    const midge = frame.midge;
    const live = frame.escorting && !frame.held;
    if (!frame.escorting) {
      this.pending = [];
    } else if (live && midge !== null && frame.led) {
      this.midgeTile = {
        x: Math.floor(midge.x / TILE_SIZE + TILE_CENTRE),
        y: Math.floor(midge.y / TILE_SIZE + TILE_CENTRE),
      };
      this.springDueWave(midge);
    }
    if (live && this.midgeTile !== null) this.spawnDueBodies();
    this.watchTheFight(midge);
    this.noteQuiet();
    this.fixateOn(frame.led ? midge : null);
    this.keepTheWallAsSanctuary(midge);
    this.letGoOfStragglers(frame.escorting);
    this.holdMusic(frame.escorting);
  }

  /**
   * An ambusher a snare has turned fights for the party now: it is no longer
   * the road's, holds no wave back and no music, and goes after no cow.
   */
  private dropTheTurned(): void {
    for (let index = this.ambushers.length - 1; index >= 0; index--) {
      const mob = this.ambushers[index];
      if (mob.isHostile && !mob.isConverted) continue;
      mob.fixatedTarget = null;
      mob.ignoresTownSafeZone = false;
      this.ambushers.splice(index, 1);
      this.fightOf.delete(mob);
      this.strandedFrames.delete(mob);
    }
  }

  /**
   * Keeps, for every ambusher, how near it stands to anyone it could fight
   * and how long since it last came nearer — which is how one stuck behind a
   * rock, or left far behind, is told from one still in the fight. Nearer is
   * measured from the furthest it has been since it last closed in, so one
   * the party has walked away from counts again as closing the moment it
   * gains ground, however near it once stood.
   */
  private watchTheFight(midge: Body | null): void {
    const crawlers = this.deps.crawlers();
    for (const mob of this.ambushers) {
      if (!mob.isAlive) continue;
      const tilesTo = (body: Body): number =>
        Math.hypot(body.x - mob.x, body.y - mob.y) / TILE_SIZE;
      let nearestTiles = midge === null ? Infinity : tilesTo(midge);
      for (const crawler of crawlers) nearestTiles = Math.min(nearestTiles, tilesTo(crawler));
      const fight = this.fightOf.get(mob) ?? {
        tiles: nearestTiles,
        mark: nearestTiles,
        since: 0,
      };
      fight.tiles = nearestTiles;
      const closedIn = nearestTiles < fight.mark - CLOSING_STEP_TILES;
      if (closedIn || nearestTiles <= IN_THE_FIGHT_TILES) {
        fight.mark = nearestTiles;
        fight.since = 0;
      } else {
        fight.mark = Math.max(fight.mark, nearestTiles);
        fight.since++;
      }
      this.fightOf.set(mob, fight);
    }
  }

  /**
   * Whether `mob` is out of the fight: left further behind than anyone it
   * could fight will ever come back for, or stuck — no nearer to anyone for
   * {@link ESCORT_STUCK_SECONDS} while not yet at them.
   */
  private isOutOfTheFight(mob: Mob): boolean {
    const fight = this.fightOf.get(mob);
    if (fight === undefined) return false;
    return fight.tiles > ABANDON_TILES || fight.since >= STUCK_FRAMES;
  }

  /** Tracks when the road last became clear of ambushers still in the fight. */
  private noteQuiet(): void {
    let standing = this.pending.length;
    for (const mob of this.ambushers) {
      if (mob.isAlive && !this.isOutOfTheFight(mob)) standing++;
    }
    if (standing > ESCORT_WAVE_OVERLAP_BODIES) this.quietSinceFrame = null;
    else this.quietSinceFrame ??= this.frame;
  }

  /**
   * Springs the next wave once Midge's progress passes its mark, and the road
   * has been all but clear of ambushers for the breather.
   */
  private springDueWave(midge: Body): void {
    const sprung = this.deps.carry.wavesSprung;
    if (sprung >= ESCORT_WAVE_COUNT || this.pending.length > 0) return;
    const quietSince = this.quietSinceFrame;
    if (quietSince === null || this.frame - quietSince < ESCORT_WAVE_MIN_GAP_FRAMES) return;
    if (this.progressOf(midge) < ESCORT_WAVE_PROGRESS[sprung]) return;
    const centreX = midge.x + TILE_SIZE * TILE_CENTRE;
    const centreY = midge.y + TILE_SIZE * TILE_CENTRE;
    if (this.deps.gameMap.isInsideTownWall(centreX, centreY)) return;
    const toSanctuary = this.tilesToSanctuary(midge);
    if (toSanctuary !== null && toSanctuary < WAVE_SANCTUARY_CLEARANCE_TILES) return;
    this.deps.carry.wavesSprung = sprung + 1;
    this.wavesEverSprung++;
    const bodies =
      ESCORT_WAVE_MIN_BODIES +
      Math.floor(this.random() * (ESCORT_WAVE_MAX_BODIES - ESCORT_WAVE_MIN_BODIES + 1));
    const drawn = new Map<AmbushKind, number>();
    for (let index = 0; index < bodies; index++) {
      const kind = this.drawKind(drawn);
      drawn.set(kind, (drawn.get(kind) ?? 0) + 1);
      this.pending.push({
        kind,
        dueFrame: this.frame + index * WAVE_STAGGER_FRAMES,
        wave: this.wavesEverSprung,
      });
    }
    this.headSpawnWait.frames = 0;
    this.waveBearing = this.behindMidge(midge) + (this.random() * 2 - 1) * WAVE_SWING_RADIANS;
    this.deps.sting();
  }

  /**
   * One kind for the next body of a wave, `drawn` already in it: a roll, and
   * a kind at its cap passes the body on to the next kind in the list.
   */
  private drawKind(drawn: ReadonlyMap<AmbushKind, number>): AmbushKind {
    const rolled = Math.floor(this.random() * ESCORT_AMBUSH_KINDS.length);
    for (let offset = 0; offset < ESCORT_AMBUSH_KINDS.length; offset++) {
      const kind = ESCORT_AMBUSH_KINDS[(rolled + offset) % ESCORT_AMBUSH_KINDS.length];
      const cap = ESCORT_KIND_CAPS[kind] ?? Infinity;
      if ((drawn.get(kind) ?? 0) < cap) return kind;
    }
    return ESCORT_AMBUSH_KINDS[rolled];
  }

  private spawnDueBodies(): void {
    spawnDue(this.pending, this.headSpawnWait, {
      isDue: (next) => next.dueFrame <= this.frame,
      isHeldBack: () => false,
      place: (_next, waitedFrames) => this.placeBody(waitedFrames),
      spawn: (next, tile) => this.raise(next.kind, next.wave, tile),
    });
    // A body with nowhere at all to come up is dropped rather than held.
    if (this.pending.length > 0 && this.headSpawnWait.frames >= SPAWN_GIVE_UP_FRAMES) {
      this.pending.shift();
      this.headSpawnWait.frames = 0;
    }
  }

  /** Somewhere round Midge for the body at the head of the queue, or null to wait. */
  private placeBody(waitedFrames: number): TilePoint | null {
    const midgeTile = this.midgeTile;
    if (midgeTile === null) return null;
    // A body with nowhere out of sight tries again only now and then: each
    // try is a dozen ring searches and a path search.
    if (this.frame < this.nextPlaceFrame) return null;
    this.nextPlaceFrame = this.frame + SPAWN_RETRY_FRAMES;
    const widened = Math.min(1, waitedFrames / SPAWN_WIDEN_FRAMES);
    const spread = SPAWN_SPREAD_RADIANS + (Math.PI - SPAWN_SPREAD_RADIANS) * widened;
    const anchors: TilePoint[] = [];
    for (let index = 0; index < SPAWN_ANCHORS_PER_TRY; index++) {
      const angle = this.waveBearing + (this.random() * 2 - 1) * spread;
      anchors.push(this.screenEdgeAlong(midgeTile, angle));
    }
    const place = placeAmong(this.spawnRules, anchors, (anchor) => anchor, waitedFrames);
    if (place === null) return null;
    // Shares the mobs' per-frame path budget; a crowded frame defers the spawn.
    if (!tryConsumePathfind()) return null;
    // A spot cut off from Midge — a clearing ringed by trees, the far bank of
    // a river — would stand its ambusher there for the whole escort.
    const way = this.deps.gameMap.findPath(
      place.tile.x,
      place.tile.y,
      midgeTile.x,
      midgeTile.y,
      SPAWN_PATH_BUDGET_TILES,
      true,
    );
    return way.length > 0 && way.length <= SPAWN_PATH_BUDGET_TILES ? place.tile : null;
  }

  /**
   * The first tile along `angle` out from `midgeTile`, between the ring's
   * bounds, that the party cannot see; the ring's far edge when every one of
   * them is in view.
   */
  private screenEdgeAlong(midgeTile: TilePoint, angle: number): TilePoint {
    const crawlers = this.deps.crawlers();
    let tile = midgeTile;
    for (
      let radius = SPAWN_RING_MIN_TILES;
      radius <= SPAWN_RING_MAX_TILES;
      radius += SPAWN_RING_STEP_TILES
    ) {
      tile = {
        x: Math.round(midgeTile.x + Math.cos(angle) * radius),
        y: Math.round(midgeTile.y + Math.sin(angle) * radius),
      };
      let away = Infinity;
      for (const crawler of crawlers) {
        away = Math.min(
          away,
          Math.hypot(tile.x - crawler.x / TILE_SIZE, tile.y - crawler.y / TILE_SIZE),
        );
      }
      if (isUnseenSpawn(this.spawnRules, tile, away)) return tile;
    }
    return tile;
  }

  /**
   * The bearing, in radians, from the nearer crawler through Midge and on
   * past her; any bearing at all with her beside them or nobody about.
   */
  private behindMidge(midge: Body): number {
    const midgeX = midge.x + TILE_SIZE * TILE_CENTRE;
    const midgeY = midge.y + TILE_SIZE * TILE_CENTRE;
    let nearestX = midgeX;
    let nearestY = midgeY;
    let nearestDistance = Infinity;
    for (const crawler of this.deps.crawlers()) {
      const crawlerX = crawler.x + TILE_SIZE * TILE_CENTRE;
      const crawlerY = crawler.y + TILE_SIZE * TILE_CENTRE;
      const distance = Math.hypot(crawlerX - midgeX, crawlerY - midgeY);
      if (distance < nearestDistance) {
        nearestX = crawlerX;
        nearestY = crawlerY;
        nearestDistance = distance;
      }
    }
    if (nearestDistance === 0 || nearestDistance === Infinity) return this.random() * FULL_TURN;
    return Math.atan2(midgeY - nearestY, midgeX - nearestX);
  }

  /** Whether an ambusher may come up on tile (`tileX`, `tileY`): outside the town's sanctuary and the palisade. */
  private mayComeUpAt(tileX: number, tileY: number): boolean {
    const centreX = (tileX + TILE_CENTRE) * TILE_SIZE;
    const centreY = (tileY + TILE_CENTRE) * TILE_SIZE;
    const map = this.deps.gameMap;
    if (map.isInBriarHollow(centreX, centreY)) return false;
    const marginPx = TOWN_WALL_SPAWN_MARGIN_TILES * TILE_SIZE;
    return (
      !map.isInsideTownWall(centreX, centreY) &&
      !map.isInsideTownWall(centreX - marginPx, centreY) &&
      !map.isInsideTownWall(centreX + marginPx, centreY) &&
      !map.isInsideTownWall(centreX, centreY - marginPx) &&
      !map.isInsideTownWall(centreX, centreY + marginPx)
    );
  }

  private raise(kind: AmbushKind, wave: number, tile: TilePoint): void {
    this.announceSide(wave, tile);
    const mob = createUndead(kind, tile.x, tile.y);
    // They claw their way up out of the ground, as the siege's own do.
    if (mob instanceof RaisedRatkin) mob.beginRising();
    mob.applyMobLevel(this.deps.level());
    fieldAsLesserDead(mob);
    applySpawnDifficulty(mob, this.deps.difficulty());
    // Raised off screen, past any aggro range: without this they would stand
    // where they came up and never notice the party.
    mob.forceAggro = true;
    // They come up further off than a mob's usual path search reaches, and a
    // search that stops short walks them straight into the trees between.
    mob.pathDistanceBudgetTiles = SPAWN_PATH_BUDGET_TILES;
    this.deps.roster.add(mob);
    this.ambushers.push(mob);
    this.waveOfMob.set(mob, wave);
    this.spawnedTotal++;
  }

  /**
   * Names the side of the road `wave` comes from, as its first body comes up
   * at `tile`: where it really came up, which a body that had to look further
   * round her for a spot out of sight may have moved off the wave's bearing.
   */
  private announceSide(wave: number, tile: TilePoint): void {
    const midgeTile = this.midgeTile;
    if (wave === this.announcedWave || midgeTile === null) return;
    this.announcedWave = wave;
    const bearing = Math.atan2(tile.y - midgeTile.y, tile.x - midgeTile.x);
    this.deps.announce(escortAmbushCaption(compassWord(bearing)));
  }

  /**
   * Every ambusher goes for Midge while she is led — the road's dead are
   * after the cow — and fights a crawler only one that steps in its way.
   * Null lets them go back to the nearest body, as when she is scared home.
   */
  private fixateOn(midge: Player | null): void {
    for (const mob of this.ambushers) mob.fixatedTarget = midge;
  }

  /**
   * The town wall is the road's sanctuary, not the town's safe zone, which
   * reaches most of the way to the palisade: the road's dead ignore the safe
   * zone while Midge and the whole party are outside the wall, and keep it
   * again the moment any of them is through it, so none is ever chased into
   * town.
   */
  private keepTheWallAsSanctuary(midge: Body | null): void {
    const map = this.deps.gameMap;
    const insideTheWall = (body: Body): boolean =>
      map.isInsideTownWall(body.x + TILE_SIZE * TILE_CENTRE, body.y + TILE_SIZE * TILE_CENTRE);
    const anyoneInTown =
      midge === null || insideTheWall(midge) || this.deps.crawlers().some(insideTheWall);
    for (const mob of this.ambushers) mob.ignoresTownSafeZone = !anyoneInTown;
  }

  /**
   * Lets go of an ambusher out of the fight — left far behind, stuck, or on
   * a road whose escort is over — once nobody can see it go.
   */
  private letGoOfStragglers(escorting: boolean): void {
    for (const mob of this.ambushers) {
      if (!mob.isAlive) {
        this.strandedFrames.delete(mob);
        this.fightOf.delete(mob);
        continue;
      }
      const centreX = mob.x + TILE_SIZE * TILE_CENTRE;
      const centreY = mob.y + TILE_SIZE * TILE_CENTRE;
      const done = !escorting || this.isOutOfTheFight(mob);
      const stranded = done && !isWorldPointInView(centreX, centreY, 0);
      const frames = stranded ? (this.strandedFrames.get(mob) ?? 0) + 1 : 0;
      this.strandedFrames.set(mob, frames);
      if (frames >= ABANDON_FRAMES) this.letGo(mob);
    }
    this.compact();
  }

  /** Takes an ambusher out of the world unseen: no death, no reward, no body. */
  private letGo(mob: Mob): void {
    mob.currentTarget = null;
    mob.clearAirborneAttacks();
    mob.hp = 0;
    mob.vanish();
    this.deps.roster.grid.remove(mob);
    this.strandedFrames.delete(mob);
    this.fightOf.delete(mob);
  }

  /** Drops the dead from the ambusher list, so it never grows past a wave or two. */
  private compact(): void {
    for (let index = this.ambushers.length - 1; index >= 0; index--) {
      if (!this.ambushers[index].isAlive) this.ambushers.splice(index, 1);
    }
  }

  /**
   * The escort's fight music while any ambusher stands on the escort, and the
   * zone's own once none does — or once Midge is delivered, whoever is left
   * out on the road.
   */
  private holdMusic(escorting: boolean): void {
    const music = this.deps.music();
    if (music === null) return;
    const fighting = escorting && this.ambushers.some((mob) => mob.isAlive);
    if (fighting && !this.musicClaimed) {
      this.musicClaimed = true;
      music.battleMusicActive = true;
      if (this.deps.audio?.currentMusicId !== BLUEPRINTS_ESCORT_MUSIC) {
        this.deps.audio?.playMusic(BLUEPRINTS_ESCORT_MUSIC, { fadeInMs: ESCORT_MUSIC_FADE_MS });
      }
    } else if (!fighting && this.musicClaimed) {
      this.releaseMusic();
    }
  }

  private releaseMusic(): void {
    this.musicClaimed = false;
    const music = this.deps.music();
    if (music === null) return;
    music.battleMusicActive = false;
    music.reset();
  }

  /** The road as walked, worked out once. Null with no town on the map. */
  private escortRoad(): EscortRoad | null {
    if (this.road !== undefined) return this.road;
    this.road = this.measureRoad();
    return this.road;
  }

  /**
   * Every open tile's walk to the town wall, breadth first out of the open
   * tiles inside it, and the shortest of those walks from a village gate.
   */
  private measureRoad(): EscortRoad | null {
    const map = this.deps.gameMap;
    if (map.townPlan === undefined) return null;
    const size = map.gridSize;
    const steps = new Int32Array(size * size).fill(-1);
    const queue = new Int32Array(size * size);
    let head = 0;
    let tail = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!map.isWalkable(x, y)) continue;
        if (!map.isTileInsideTownWall(x, y)) continue;
        steps[y * size + x] = 0;
        queue[tail++] = y * size + x;
      }
    }
    while (head < tail) {
      const index = queue[head++];
      const x = index % size;
      const y = Math.floor(index / size);
      for (const [dx, dy] of ROAD_STEPS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= size || nextY >= size) continue;
        const next = nextY * size + nextX;
        if (steps[next] !== -1 || !map.isWalkable(nextX, nextY)) continue;
        steps[next] = steps[index] + 1;
        queue[tail++] = next;
      }
    }
    let gateSteps = Infinity;
    for (const gate of this.deps.site.gates) {
      const fromGate = steps[gate.outside.y * size + gate.outside.x];
      if (fromGate >= 0) gateSteps = Math.min(gateSteps, fromGate);
    }
    if (gateSteps === Infinity) return null;
    return { stepsToSanctuary: steps, size, gateSteps };
  }

  /**
   * Screen space, over the fog: a marker at the screen's edge pointing at
   * each ambusher still in the fight that the player cannot see yet, so a
   * wave out of sight is never a war horn and nothing else. Placed against
   * the view the scene last published, which is the camera it drew with.
   */
  renderIncoming(ctx: CanvasRenderingContext2D, nowMs: number): void {
    const view = visibleWorldView();
    if (view === null) return;
    const camX = view.left;
    const camY = view.top;
    const width = view.width;
    const height = view.height;
    const centreX = width / 2;
    const centreY = height / 2;
    const reachX = centreX - INCOMING_MARKER_INSET_PX;
    const reachY = centreY - INCOMING_MARKER_INSET_PX;
    if (reachX <= 0 || reachY <= 0) return;
    const pulse = (Math.sin((nowMs / INCOMING_MARKER_PULSE_MS) * FULL_TURN) + 1) / 2;
    ctx.save();
    ctx.globalAlpha = INCOMING_MARKER_MIN_ALPHA + INCOMING_MARKER_ALPHA_RANGE * pulse;
    ctx.fillStyle = INCOMING_MARKER_FILL;
    ctx.strokeStyle = INCOMING_MARKER_OUTLINE;
    ctx.lineWidth = INCOMING_MARKER_OUTLINE_PX;
    for (const mob of this.ambushers) {
      if (!mob.isAlive || this.isOutOfTheFight(mob)) continue;
      const worldX = mob.x + TILE_SIZE * TILE_CENTRE;
      const worldY = mob.y + TILE_SIZE * TILE_CENTRE;
      if (isWorldPointInView(worldX, worldY, 0)) continue;
      const towardX = worldX - camX - centreX;
      const towardY = worldY - camY - centreY;
      if (towardX === 0 && towardY === 0) continue;
      // Out along the line to it until that line meets the inset screen edge.
      const toEdge = Math.min(
        towardX === 0 ? Infinity : reachX / Math.abs(towardX),
        towardY === 0 ? Infinity : reachY / Math.abs(towardY),
      );
      const along = Math.min(1, toEdge);
      drawIncomingMarker(
        ctx,
        centreX + towardX * along,
        centreY + towardY * along,
        Math.atan2(towardY, towardX),
      );
    }
    ctx.restore();
  }

  /** A death rewind: the rewind has already dropped every ambusher; forget them, and the music with them. */
  onRewind(): void {
    const present = new Set(this.deps.roster.mobs);
    for (let index = this.ambushers.length - 1; index >= 0; index--) {
      if (!present.has(this.ambushers[index])) this.ambushers.splice(index, 1);
    }
    this.strandedFrames.clear();
    this.fightOf.clear();
    this.pending = [];
    this.headSpawnWait.frames = 0;
    this.midgeTile = null;
    if (this.musicClaimed && !this.ambushers.some((mob) => mob.isAlive)) this.releaseMusic();
  }

  /** The scene is being torn down: the zone music gets the track back. */
  dispose(): void {
    if (this.musicClaimed) this.releaseMusic();
    this.pending = [];
  }
}

/** One edge marker: a filled chevron with its tip at (`x`, `y`) pointing along `angle`. */
function drawIncomingMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-INCOMING_MARKER_LENGTH_PX, -INCOMING_MARKER_HALF_WIDTH_PX);
  ctx.lineTo(-INCOMING_MARKER_LENGTH_PX * INCOMING_MARKER_NOTCH_SHARE, 0);
  ctx.lineTo(-INCOMING_MARKER_LENGTH_PX, INCOMING_MARKER_HALF_WIDTH_PX);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/**
 * Makes `mob` one of the road's lesser dead, at {@link ESCORT_BODY_HEALTH_SHARE}
 * of its kind's health. Call after `applyMobLevel`, which would otherwise level
 * the scaled figure again.
 */
export function fieldAsLesserDead(mob: Mob): void {
  mob.scaleMaxHp(ESCORT_BODY_HEALTH_SHARE);
}
