import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { WOOD_SMASHING_SOUNDS, type SoundId } from '../audio/sounds';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  BigRooster,
  COMPANION_KETTLEBELL_DAMAGE_SHARE,
  PLATE_ROLL_COOLDOWN_FRAMES,
  PLATE_ROLL_HIT_RADIUS_TILES,
  type PlateLane,
} from '../creatures/BigRooster';
import { RoosterMinion } from '../creatures/RoosterMinion';
import type { RoosterFlockView } from '../creatures/roosterKicks';
import type { Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import {
  GYM_CABLE_STACK,
  GYM_KETTLEBELL_RACK,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_TREADMILL_BELT,
} from '../map/tileTypes';
import { gymLayoutOf, type GymLayout, type GymTreadmill } from '../map/tiles/bossRooms/gymLayout';
import {
  resetGymPropState,
  setGymKettlebellRackStocked,
  setGymRackFill,
  setGymSquatRackLoaded,
} from '../map/tiles/bossRooms/gymPropState';
import {
  KETTLEBELL_FALL_FRAMES,
  KETTLEBELL_IMPACT_RADIUS_PX,
  KETTLEBELL_RAIN_FRAMES,
  KettlebellRain,
  type FallingKettlebell,
  type KettlebellRainRoom,
} from './bossRooms/gymKettlebellRain';
import {
  EXERCISE_BALL_RADIUS_PX,
  ExerciseBalls,
  type ExerciseBallFloor,
} from './bossRooms/gymExerciseBalls';
import { GYM_CUES } from './bossRooms/gymSoundCues';
import { escapeFromCircleZones } from './circleHazardEscape';
import { GYM_EXERCISE_BALL_COLOURS, drawKettlebellShadow } from '../sprites/art/gymKettlebellArt';
import { SPRITE_BUILDING_OVERLAY_FPS } from '../map/tiles/overlayAnimation';
import {
  GYM_CHALK_FRAMES,
  GYM_MIRROR_CRACK_TILES,
  GYM_PLATE_FRAMES,
  GYM_RACK_SLOTS,
  GYM_SHUTTER_FRAMES,
  type GymConsoleState,
} from '../sprites/art/gymRoomArt';
import {
  drawGymBeltSprite,
  drawGymBoomboxSprite,
  drawGymChalkPuffSprite,
  drawGymConsoleSprite,
  drawGymExerciseBallSprite,
  drawGymFallingKettlebellSprite,
  drawGymMirrorCrackSprite,
  drawGymPickupSprite,
  gymPickupInkTop,
  gymRackInkTop,
  drawGymPlateSprite,
  drawGymShutterSprite,
} from '../sprites/gymRoomSprites';
import { drawSlamShockwave } from '../sprites/slamShockwave';
import { drawDangerCircle, drawDangerPath } from '../sprites/dangerTelegraph';
import { drawThrownDumbbell } from '../sprites/roosterSprite';
import { frameTime } from '../utils';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { type SystemContext, presentCrawlers } from './GameSystem';
import { InertBossRoomDressing } from './bossRooms/InertBossRoomDressing';
import { gymStripLights, type StripLight } from './bossRooms/bossRoomMoodLights';
import { drawStripLight } from '../sprites/art/moodLightArt';
import type { CheckpointedDressing, DressingRenderable } from './bossRooms/BossRoomDressing';
import { stampProps, type TilePoint } from './bossRooms/bossRoomLayout';
import { pushPlayerWithCollision } from './playerDisplacement';
import type { GymRoomCheckpoint } from './bossRooms/gymRoomCheckpoint';

/** Frames before a stripped rack slot refills: short, so a rack can never be emptied for good. */
const DUMBBELL_RESPAWN_FRAMES = 60;
const BENCH_RESPAWN_FRAMES = 300;

/** How far a powered belt carries whatever stands on it each frame: three fifths of a walk. */
const TREADMILL_PUSH_SHARE_OF_WALK = 0.6;
export const TREADMILL_PUSH_PX_PER_FRAME = PLAYER_SPEED * TREADMILL_PUSH_SHARE_OF_WALK;
/** A treadmill a crawler punches the console of stays off this long. */
const CONSOLE_SHUTOFF_FRAMES = 600;
/** The last stretch of a shut-off, spent beeping before the belt starts again. */
export const CONSOLE_BEEP_FRAMES = 60;
/** Hits the boombox takes before it dies. */
export const BOOMBOX_HP = 3;
/** A plate taken off a squat rack is back on it by the time he may bowl again. */
const SQUAT_RACK_RESTOCK_FRAMES = PLATE_ROLL_COOLDOWN_FRAMES;

/** Frames each shutter picture is held while it rolls. */
const SHUTTER_FRAME_HOLD = 5;
const SHUTTER_CLOSED_FRAME = GYM_SHUTTER_FRAMES - 1;
/**
 * Belt frames per second. Faster than the shared overlay clock: a belt moving
 * at the push speed, sampled at 8 fps, aliases into slats creeping backwards.
 */
const BELT_FRAMES_PER_SECOND = 16;
/** Frames each rolling-plate picture is held. */
const PLATE_SPIN_FRAME_HOLD = 3;

/** Chalk puffs alive at once, room-wide. */
export const CHALK_PUFF_CAP = 10;
const CHALK_PUFFS_PER_SLAM = 8;
const CHALK_PUFFS_PER_PLATE = 6;
const CHALK_PUFF_FRAME_HOLD = 4;
const CHALK_PUFF_LIFE_FRAMES = GYM_CHALK_FRAMES * CHALK_PUFF_FRAME_HOLD;
/** Puffs scatter this far around the rack that shed them, in tiles. */
const CHALK_PUFF_SCATTER_TILES = 1.1;
const GOLDEN_ANGLE = 2.399963;

const TILE_CENTER = 0.5;
const PICKUP_COLLECT_RADIUS_RATIO = 1.2;
/** A crawler within this of a rack's front tile can take a dumbbell from it, in tiles. */
const RACK_REACH_TILES = 1.3;
/** Big Rooster's pickup request counts for a rack within this of its front tile, in tiles. */
const BIG_ROOSTER_RACK_DETECT_TILES = 1;
/** How far a console or the boombox can be hit from, as a share of the attacker's melee reach. */
const PROP_HIT_REACH_SHARE = 1;

/** A plate lane shows at full strength from the wind-up: the lane is fixed then and never moves. */
const PLATE_LANE_FADE = 1;
/**
 * A falling kettlebell's ring shows at full strength from the moment it is
 * dropped; its fill growing to the edge is what counts down to the impact.
 */
const KETTLEBELL_WARNING_FADE = 1;
/** Companions step this much further off a plate lane than its reach, in px. */
const LANE_ESCAPE_MARGIN_TILES = 0.3;
const LANE_ESCAPE_MARGIN_PX = TILE_SIZE * LANE_ESCAPE_MARGIN_TILES;

/** A heaved kettlebell rack stands bare for the length of the rain it fed. */
const KETTLEBELL_RACK_RESTOCK_FRAMES = KETTLEBELL_RAIN_FRAMES;
/** Chalk shaken up where a kettlebell lands. */
const CHALK_PUFFS_PER_KETTLEBELL = 2;
/** How high a kettlebell starts above its shadow, in tiles. */
const KETTLEBELL_DROP_HEIGHT_TILES = 7;
/** Where a falling bell's sheet frame is anchored, as a share of a tile down from its landing centre. */
const KETTLEBELL_ART_CENTRE_SHARE = 0.62;
/** Companions keep this far clear of a shadow's reach, in tiles. */
const KETTLEBELL_ESCAPE_MARGIN_TILES = 0.4;
const KETTLEBELL_ESCAPE_RADIUS_PX =
  KETTLEBELL_IMPACT_RADIUS_PX + TILE_SIZE * KETTLEBELL_ESCAPE_MARGIN_TILES;
/** A crawler's body, for a ball running into it, in tiles from its centre. */
const CRAWLER_BODY_RADIUS_TILES = 0.35;
/** Frames before the same ball can hit the same crawler again. */
const BALL_REHIT_FRAMES = 45;
/** How far a ball pushes the AI-driven companion aside, and over how many frames. */
const BALL_SHOVE_TILES = 1.5;
const BALL_SHOVE_FRAMES = 10;
/** Frames each picture of a ball's roll is held. */
const BALL_SPIN_FRAME_HOLD = 4;
/** Where a ball's sheet frame is anchored, as a share of a tile down from its centre. */
const BALL_ART_CENTRE_SHARE = 0.58;

/** Peak camera shake in px, on the frame his fists land. */
const SHAKE_PEAK_PX = 6;
/** Frames the shake takes to die away. */
const SHAKE_FRAMES = 16;
/** Centres `Math.random()` on zero so the shake swings both ways. */
const RANDOM_MIDPOINT = 0.5;

interface RackSlot {
  filled: boolean;
  respawnTimer: number;
}

interface Rack {
  readonly tile: TilePoint;
  /** World centre of the floor tile in front of the rack, where a lifter stands. */
  readonly reach: { readonly x: number; readonly y: number };
  /**
   * Where Big Rooster stands to lift from it: the front tile's top-left, since
   * a mob's position and its follow both run off its top-left corner. Aimed at
   * the tile's centre instead, he tries to put his body half a tile into the
   * kit beside the rack and stops short of the lift.
   */
  readonly standAt: { readonly x: number; readonly y: number };
  readonly slots: RackSlot[];
}

interface Bench {
  readonly tile: TilePoint;
  active: boolean;
  respawnTimer: number;
}

interface SquatRack {
  readonly tile: TilePoint;
  strippedFrames: number;
}

interface Treadmill {
  readonly layout: GymTreadmill;
  shutoffFrames: number;
}

interface KettlebellRack {
  readonly tile: TilePoint;
  /** Where Big Rooster stands to heave from it, as a mob's top-left. */
  readonly standAt: { readonly x: number; readonly y: number };
  heavedFrames: number;
}

interface ChalkPuff {
  x: number;
  y: number;
  age: number;
}

const tileCorner = (tile: TilePoint): { x: number; y: number } => ({
  x: tile.x * TILE_SIZE,
  y: tile.y * TILE_SIZE,
});

const tileCentre = (tile: TilePoint): { x: number; y: number } => ({
  x: (tile.x + TILE_CENTER) * TILE_SIZE,
  y: (tile.y + TILE_CENTER) * TILE_SIZE,
});

/**
 * Big Rooster's gym: its dumbbell racks (his reload points, and the crawlers'
 * denial), its treadmill belts, squat racks he bowls plates from, a boombox, a
 * shutter over the door and a mirror he cracks when he loses his temper.
 *
 * The collidable kit is stamped into the map as tiles when the gym is built,
 * from `gymLayoutOf`, the same plan the floor painter reads. Everything that
 * changes during the fight lives here and is drawn from painted sheets.
 */
export class GymRoomSystem
  extends InertBossRoomDressing
  implements CheckpointedDressing<GymRoomCheckpoint>
{
  readonly layout: GymLayout | null;
  private readonly stripLights: readonly StripLight[];
  private readonly racks: Rack[] = [];
  private readonly benches: Bench[] = [];
  private readonly squatRacks: SquatRack[] = [];
  private readonly treadmills: Treadmill[] = [];
  private readonly puffs: ChalkPuff[] = [];
  private readonly kettlebellRacks: KettlebellRack[] = [];
  private readonly rain = new KettlebellRain();
  private readonly balls: ExerciseBalls;
  /** Frames until each ball may hit each crawler again, keyed by ball and crawler. */
  private readonly ballHitCooldowns = new Map<string, number>();
  /** Every bird of the flock this gym has seen alive, so one killed is counted as lost. */
  private readonly knownFlock = new Set<RoosterMinion>();
  private ballAgeFrames = 0;
  private readonly renderables: DressingRenderable[] = [];
  /** Each entry is one cue's takes; the scene plays one of them at random. */
  private readonly pendingSounds: Array<readonly SoundId[]> = [];
  private boomboxHp = BOOMBOX_HP;
  private sealed = false;
  private defeated = false;
  private mirrorCracked = false;
  private shutterFrame = 0;
  private shutterHold = 0;
  private lootSealed = false;
  private sawEnraged = false;

  /**
   * The live boss, cached each update. `render` is handed a camera and nothing
   * else, and his shockwave is floor paint that belongs in the ground pass.
   */
  private bigRooster: BigRooster | null = null;
  /** True while a wave is running, so the shake and the chalk fire once and not per frame. */
  private shockwaveRunning = false;
  private shakeFrames = 0;
  private shakeX = 0;
  private shakeY = 0;

  /**
   * @param gameMap the floor, or null on a floor with no gym
   * @param roomIndex the gym's index in `gameMap.bossRooms`, for the loot seal
   */
  constructor(
    private readonly gameMap: GameMap | null,
    private readonly roomIndex = -1,
  ) {
    super();
    resetGymPropState();
    this.layout = gameMap === null ? null : gymLayoutOf(gameMap.structure);
    this.stripLights = this.layout === null ? [] : gymStripLights(this.layout);
    this.balls = new ExerciseBalls(this.layout?.exerciseBalls ?? []);
    const layout = this.layout;
    if (gameMap === null || layout === null) return;

    stampProps(gameMap, [
      ...layout.racks.map((tile) => ({ ...tile, type: GYM_RACK })),
      ...layout.kettlebellRacks.map((tile) => ({ ...tile, type: GYM_KETTLEBELL_RACK })),
      ...layout.squatRacks.map((tile) => ({ ...tile, type: GYM_SQUAT_RACK })),
      ...layout.cableStacks.map((tile) => ({ ...tile, type: GYM_CABLE_STACK })),
      ...layout.treadmills.flatMap((treadmill) =>
        treadmill.belt.map((tile) => ({ ...tile, type: GYM_TREADMILL_BELT })),
      ),
    ]);
    for (const tile of layout.racks) {
      this.racks.push({
        tile,
        reach: tileCentre(this.frontTile(gameMap, layout, tile)),
        standAt: tileCorner(this.frontTile(gameMap, layout, tile)),
        slots: Array.from({ length: GYM_RACK_SLOTS }, () => ({ filled: true, respawnTimer: 0 })),
      });
    }
    for (const tile of layout.kettlebellRacks) {
      this.kettlebellRacks.push({
        tile,
        standAt: tileCorner(this.frontTile(gameMap, layout, tile)),
        heavedFrames: 0,
      });
    }
    for (const tile of layout.benches) this.benches.push({ tile, active: true, respawnTimer: 0 });
    for (const tile of layout.squatRacks) this.squatRacks.push({ tile, strippedFrames: 0 });
    for (const treadmill of layout.treadmills)
      this.treadmills.push({ layout: treadmill, shutoffFrames: 0 });
    this.publishPropState();
  }

  /** The walkable neighbour of a wall-side prop that faces the middle of the room. */
  private frontTile(gameMap: GameMap, layout: GymLayout, tile: TilePoint): TilePoint {
    const neighbours = [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 },
    ].filter((n) => gameMap.isWalkable(n.x, n.y, 'walker'));
    let best = neighbours[0] ?? tile;
    let bestDist = Infinity;
    for (const n of neighbours) {
      const dist = Math.hypot(n.x - layout.spawn.x, n.y - layout.spawn.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }

  private publishPropState(): void {
    for (const rack of this.racks) {
      setGymRackFill(rack.tile.x, rack.tile.y, rack.slots.filter((slot) => slot.filled).length);
    }
    for (const squat of this.squatRacks) {
      setGymSquatRackLoaded(squat.tile.x, squat.tile.y, squat.strippedFrames <= 0);
    }
    for (const rack of this.kettlebellRacks) {
      setGymKettlebellRackStocked(rack.tile.x, rack.tile.y, rack.heavedFrames <= 0);
    }
  }

  // ── Fight hooks ──────────────────────────────────────────────────────────

  override onSeal(): void {
    if (this.defeated || this.layout === null) return;
    if (!this.sealed) this.pendingSounds.push(['gate_opening']);
    this.sealed = true;
  }

  override onBossDefeated(): void {
    this.defeated = true;
    this.sealed = true;
    this.puffs.length = 0;
    // The belts stop for good; a console left counting down must not beep
    // after the fight is over.
    for (const treadmill of this.treadmills) treadmill.shutoffFrames = 0;
    this.bigRooster?.clearAirborneAttacks();
    // Bells already in the air still land, harmless now; balls roll to a stop and stay.
    this.rain.stopNewBells();
    this.balls.stopAll();
  }

  override onFightAborted(): void {
    this.sealed = false;
    this.mirrorCracked = false;
    this.sawEnraged = false;
    this.boomboxHp = BOOMBOX_HP;
    for (const rack of this.racks) {
      for (const slot of rack.slots) {
        slot.filled = true;
        slot.respawnTimer = 0;
      }
    }
    for (const squat of this.squatRacks) squat.strippedFrames = 0;
    for (const treadmill of this.treadmills) treadmill.shutoffFrames = 0;
    for (const rack of this.kettlebellRacks) rack.heavedFrames = 0;
    this.rain.clear();
    this.balls.rest();
    this.ballHitCooldowns.clear();
    this.puffs.length = 0;
    this.publishPropState();
  }

  // ── Checkpoints ──────────────────────────────────────────────────────────

  captureCheckpoint(): GymRoomCheckpoint {
    return {
      racks: this.racks.map((rack) =>
        rack.slots.map((slot) => (slot.filled ? 0 : Math.max(1, slot.respawnTimer))),
      ),
      benches: this.benches.map((bench) => (bench.active ? 0 : Math.max(1, bench.respawnTimer))),
      squatRackStrippedFrames: this.squatRacks.map((squat) => squat.strippedFrames),
      consoleShutoffFrames: this.treadmills.map((treadmill) => treadmill.shutoffFrames),
      kettlebellRackHeavedFrames: this.kettlebellRacks.map((rack) => rack.heavedFrames),
      exerciseBalls: [...this.balls.all],
      boomboxHp: this.boomboxHp,
      sealed: this.sealed,
      defeated: this.defeated,
      mirrorCracked: this.mirrorCracked,
    };
  }

  restoreCheckpoint(snapshot: GymRoomCheckpoint): void {
    this.racks.forEach((rack, rackIndex) => {
      rack.slots.forEach((slot, slotIndex) => {
        const saved = snapshot.racks[rackIndex]?.[slotIndex] ?? 0;
        slot.filled = saved <= 0;
        slot.respawnTimer = saved;
      });
    });
    this.benches.forEach((bench, index) => {
      const saved = snapshot.benches[index] ?? 0;
      bench.active = saved <= 0;
      bench.respawnTimer = saved;
    });
    this.squatRacks.forEach((squat, index) => {
      squat.strippedFrames = snapshot.squatRackStrippedFrames[index] ?? 0;
    });
    this.treadmills.forEach((treadmill, index) => {
      treadmill.shutoffFrames = snapshot.consoleShutoffFrames[index] ?? 0;
    });
    this.kettlebellRacks.forEach((rack, index) => {
      rack.heavedFrames = snapshot.kettlebellRackHeavedFrames[index] ?? 0;
    });
    this.balls.restore(snapshot.exerciseBalls);
    this.ballHitCooldowns.clear();
    this.boomboxHp = snapshot.boomboxHp;
    this.sealed = snapshot.sealed;
    this.defeated = snapshot.defeated;
    this.mirrorCracked = snapshot.mirrorCracked;
    this.sawEnraged = snapshot.mirrorCracked;
    // Snapped rather than rolled: a restore is a cut, not something happening in the room.
    this.shutterFrame = this.shutterWantsClosed() ? SHUTTER_CLOSED_FRAME : 0;
    this.shutterHold = 0;
    this.publishPropState();
    this.stopShake();
  }

  override resetForCheckpoint(): void {
    this.stopShake();
    this.puffs.length = 0;
    this.pendingSounds.length = 0;
    this.rain.clear();
  }

  /**
   * A slam from the run that died must not go on shaking the camera of the
   * one that replaces it.
   */
  private stopShake(): void {
    this.shockwaveRunning = false;
    this.shakeFrames = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  /** Camera displacement for this frame; the scene adds it after clamping. */
  get cameraOffset(): { x: number; y: number } {
    return { x: this.shakeX, y: this.shakeY };
  }

  /** Sound cues raised since the last call, for the scene to play. */
  drainSoundCues(): Array<readonly SoundId[]> {
    return this.pendingSounds.splice(0, this.pendingSounds.length);
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /** True while the belts run: from the seal until the kill. */
  get beltsLive(): boolean {
    return this.sealed && !this.defeated;
  }

  private isPowered(treadmill: Treadmill): boolean {
    return this.beltsLive && treadmill.shutoffFrames <= 0;
  }

  /** The powered belt under a world point, or null. */
  poweredBeltAt(x: number, y: number): GymTreadmill | null {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    for (const treadmill of this.treadmills) {
      if (!this.isPowered(treadmill)) continue;
      if (treadmill.layout.belt.some((tile) => tile.x === tx && tile.y === ty))
        return treadmill.layout;
    }
    return null;
  }

  /** Every belt, powered or not, for gates and sims. */
  get treadmillLayouts(): readonly GymTreadmill[] {
    return this.treadmills.map((treadmill) => treadmill.layout);
  }

  get boomboxBroken(): boolean {
    return this.boomboxHp <= 0;
  }

  /** Whether the console of this treadmill is shut off, for gates. */
  isConsoleOff(index: number): boolean {
    return index < this.treadmills.length && this.treadmills[index].shutoffFrames > 0;
  }

  /**
   * Returns the world-space positions a lifter stands at to take from each rack
   * that still holds a dumbbell. Big Rooster walks to the nearest.
   */
  getActiveDumbbellPositions(): Array<{ x: number; y: number }> {
    return this.racks
      .filter((rack) => rack.slots.some((slot) => slot.filled))
      .map((rack) => ({ x: rack.standAt.x, y: rack.standAt.y }));
  }

  // ── Interaction ──────────────────────────────────────────────────────────

  /** Takes a dumbbell off a rack or a bench off the floor near `player`. True when one was collected. */
  override tryInteract(player: HumanPlayer | CatPlayer): boolean {
    const target = this.interactTarget(player);
    if (target === null) return false;
    if (target.kind === 'rack') {
      target.slot.filled = false;
      target.slot.respawnTimer = DUMBBELL_RESPAWN_FRAMES;
      player.inventory.addItem('gym_dumbbell', 1);
      this.publishPropState();
      return true;
    }
    this.takeBench(target.bench, player);
    return true;
  }

  override wouldInteract(player: HumanPlayer | CatPlayer): boolean {
    return this.interactTarget(player) !== null;
  }

  /**
   * Takes the floor bench under a tapped or clicked world point, when `player`
   * is in reach of it. Pointing at the bench says what the press is for, so
   * this holds even with Big Rooster in reach, where a bare press would swing.
   */
  tryPickupBenchAt(worldX: number, worldY: number, player: HumanPlayer | CatPlayer): boolean {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    const tapped = this.benches.find(
      (bench) => bench.active && bench.tile.x === tileX && bench.tile.y === tileY,
    );
    if (tapped === undefined || !this.benchReaches(tapped, player)) return false;
    this.takeBench(tapped, player);
    return true;
  }

  private interactTarget(
    player: HumanPlayer | CatPlayer,
  ): { kind: 'rack'; rack: Rack; slot: RackSlot } | { kind: 'bench'; bench: Bench } | null {
    const rack = this.rackNear(
      player.x + TILE_SIZE * TILE_CENTER,
      player.y + TILE_SIZE * TILE_CENTER,
    );
    const slot = rack === null ? null : this.topFilledSlot(rack);
    if (rack !== null && slot !== null) return { kind: 'rack', rack, slot };
    const bench = this.benchInReach(player);
    return bench === null ? null : { kind: 'bench', bench };
  }

  private benchInReach(player: HumanPlayer | CatPlayer): Bench | null {
    return this.benches.find((bench) => bench.active && this.benchReaches(bench, player)) ?? null;
  }

  private benchReaches(bench: Bench, player: HumanPlayer | CatPlayer): boolean {
    const centre = tileCentre(bench.tile);
    const distance = Math.hypot(
      player.x + TILE_SIZE * TILE_CENTER - centre.x,
      player.y + TILE_SIZE * TILE_CENTER - centre.y,
    );
    return distance < TILE_SIZE * PICKUP_COLLECT_RADIUS_RATIO;
  }

  private takeBench(bench: Bench, player: HumanPlayer | CatPlayer): void {
    bench.active = false;
    bench.respawnTimer = BENCH_RESPAWN_FRAMES;
    player.inventory.addItem('gym_bench_press', 1);
  }

  private rackNear(px: number, py: number): Rack | null {
    for (const rack of this.racks) {
      if (Math.hypot(px - rack.reach.x, py - rack.reach.y) < TILE_SIZE * RACK_REACH_TILES)
        return rack;
    }
    return null;
  }

  /** The highest dumbbell still racked: the top one comes off first. */
  private topFilledSlot(rack: Rack): RackSlot | null {
    for (let index = rack.slots.length - 1; index >= 0; index--) {
      if (rack.slots[index].filled) return rack.slots[index];
    }
    return null;
  }

  // ── Update ───────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    if (this.layout === null) return;
    const bigRooster =
      ctx.roster.mobs.find((m): m is BigRooster => m instanceof BigRooster) ?? null;
    this.bigRooster = bigRooster;
    this.updateShakeAndChalk(bigRooster);
    this.lootSealed = ctx.bossRoom?.isRoomLootSealed(this.roomIndex) ?? false;
    this.advanceShutter();
    this.tickRacks(bigRooster);
    this.tickSquatRacks(bigRooster);
    this.tickConsoles();
    this.resolvePropHits(ctx);
    this.pushBodiesOnBelts(ctx);
    this.publishFlock(ctx, bigRooster);
    this.tickKettlebellRacks(bigRooster);
    this.tickRain(ctx, bigRooster);
    this.tickBalls(ctx, bigRooster);
    this.tickPuffs();

    if (bigRooster !== null) {
      bigRooster.confinedTo = this.layout.bounds;
      bigRooster.musicPlaying = !this.boomboxBroken;
      if (bigRooster.isAlive && bigRooster.isEnraged && this.sealed && !this.sawEnraged) {
        this.sawEnraged = true;
        this.mirrorCracked = true;
      }
    }
  }

  /** Raises a cue for the scene to play, when it has any takes yet. */
  private raiseCue(takes: readonly SoundId[]): void {
    if (takes.length > 0) this.pendingSounds.push(takes);
  }

  /**
   * Hands every rooster in the gym what it needs to know about the room and
   * the rest of the flock: Big Rooster his racks, balls and losses, and every
   * bird the view its dynamite kicks are aimed by.
   */
  private publishFlock(ctx: SystemContext, bigRooster: BigRooster | null): void {
    const layout = this.layout;
    const map = this.gameMap;
    if (layout === null || map === null) return;
    const minions = ctx.roster.mobs.filter(
      (mob): mob is RoosterMinion => mob instanceof RoosterMinion,
    );
    for (const minion of minions) {
      if (minion.isAlive) this.knownFlock.add(minion);
    }
    const half = TILE_SIZE * TILE_CENTER;
    const living = [
      ...minions.filter((minion) => minion.isAlive),
      ...(bigRooster?.isAlive === true ? [bigRooster] : []),
    ];
    const view: RoosterFlockView = {
      members: living.map((bird) => ({ x: bird.x + half, y: bird.y + half })),
      active: ctx.active.isAlive ? ctx.active : null,
      crawlers: presentCrawlers(ctx),
      room: layout.bounds,
      isWalkable: (tileX, tileY) => map.isWalkable(tileX, tileY, 'walker'),
    };
    for (const minion of minions) minion.flockView = view;
    if (bigRooster === null) return;
    bigRooster.flockView = view;
    const lost = [...this.knownFlock].filter(
      (minion) => !minion.isAlive || !ctx.roster.mobs.includes(minion),
    ).length;
    bigRooster.flockLosses = { known: this.knownFlock.size, lost };
    bigRooster.kettlebellRackStands = this.heaveableKettlebellRacks().map((rack) => rack.standAt);
    bigRooster.restingExerciseBalls = this.balls.all.flatMap((state, index) => {
      if (state.phase !== 'resting') return [];
      const centre = this.balls.centreOf(index);
      return [{ index, x: centre.x, y: centre.y }];
    });
  }

  /** Restocks heaved racks, and starts a rain where he heaved one. */
  private tickKettlebellRacks(bigRooster: BigRooster | null): void {
    let changed = false;
    for (const rack of this.kettlebellRacks) {
      if (rack.heavedFrames <= 0) continue;
      rack.heavedFrames--;
      if (rack.heavedFrames <= 0) changed = true;
    }
    const request = bigRooster?.heaveRequest ?? null;
    if (bigRooster !== null && request !== null) {
      bigRooster.heaveRequest = null;
      const rack = this.nearestKettlebellRack(request);
      if (rack !== null) {
        rack.heavedFrames = KETTLEBELL_RACK_RESTOCK_FRAMES;
        this.spawnPuffs(tileCentre(rack.tile), CHALK_PUFFS_PER_PLATE);
        changed = true;
      }
      if (!this.defeated) {
        this.rain.start();
        this.raiseCue(GYM_CUES.kettlebellHeave.takes);
      }
    }
    if (changed) this.publishPropState();
  }

  /**
   * The racks he may heave from: the stocked ones, or every rack while all of
   * them are restocking, so his fury's rain is never stranded for want of one.
   */
  private heaveableKettlebellRacks(): readonly KettlebellRack[] {
    const stocked = this.kettlebellRacks.filter((rack) => rack.heavedFrames <= 0);
    return stocked.length > 0 ? stocked : this.kettlebellRacks;
  }

  private nearestKettlebellRack(at: { x: number; y: number }): KettlebellRack | null {
    let best: KettlebellRack | null = null;
    let bestDistance = Infinity;
    for (const rack of this.heaveableKettlebellRacks()) {
      const distance = Math.hypot(rack.standAt.x - at.x, rack.standAt.y - at.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = rack;
    }
    return best;
  }

  private rainRoom(): KettlebellRainRoom | null {
    const layout = this.layout;
    const map = this.gameMap;
    if (layout === null || map === null) return null;
    return {
      ...layout.bounds,
      isWalkable: (tileX, tileY) => map.isWalkable(tileX, tileY, 'walker'),
    };
  }

  /**
   * Lowers the rain and lands what comes down. A bell hits the active crawler
   * in full and the AI-driven companion at a share of it; it never touches a
   * rooster, and once he is dead it touches nobody.
   */
  private tickRain(ctx: SystemContext, bigRooster: BigRooster | null): void {
    const room = this.rainRoom();
    if (room === null) return;
    const active = ctx.active;
    const activeTile = active.isAlive
      ? {
          x: Math.floor((active.x + TILE_SIZE * TILE_CENTER) / TILE_SIZE),
          y: Math.floor((active.y + TILE_SIZE * TILE_CENTER) / TILE_SIZE),
        }
      : null;
    const frame = this.rain.tick(room, activeTile);
    for (const bell of frame.landed) {
      this.raiseCue(GYM_CUES.kettlebellImpact.takes);
      this.spawnPuffs(bell, CHALK_PUFFS_PER_KETTLEBELL);
      if (this.defeated || bigRooster?.isAlive !== true) continue;
      for (const crawler of presentCrawlers(ctx)) {
        if (!crawler.isAlive || !this.bellHits(bell, crawler)) continue;
        const share = crawler === active ? 1 : COMPANION_KETTLEBELL_DAMAGE_SHARE;
        bigRooster.landKettlebell(crawler, share);
      }
    }
  }

  private bellHits(bell: FallingKettlebell, body: Player): boolean {
    const cx = body.x + TILE_SIZE * TILE_CENTER;
    const cy = body.y + TILE_SIZE * TILE_CENTER;
    return Math.hypot(cx - bell.x, cy - bell.y) < KETTLEBELL_IMPACT_RADIUS_PX;
  }

  private ballFloor(): ExerciseBallFloor | null {
    const layout = this.layout;
    const map = this.gameMap;
    if (layout === null || map === null) return null;
    return {
      room: layout.bounds,
      isWalkable: (tileX, tileY) => map.isWalkable(tileX, tileY, 'walker'),
    };
  }

  /**
   * Kicks the ball he booted, rolls every ball, and lands the rolling ones on
   * the crawlers they run into: the active crawler takes the blow, the
   * AI-driven companion is only pushed aside. The flock is never touched, and
   * a ball slowing to a stop after his death touches nobody.
   */
  private tickBalls(ctx: SystemContext, bigRooster: BigRooster | null): void {
    const floor = this.ballFloor();
    if (floor === null) return;
    const kick = bigRooster?.ballKickRequest ?? null;
    if (bigRooster !== null && kick !== null) {
      bigRooster.ballKickRequest = null;
      if (!this.defeated && this.balls.kick(kick.index, kick.dx, kick.dy)) {
        this.raiseCue(GYM_CUES.ballKick.takes);
      }
    }
    this.ballAgeFrames++;
    for (const [key, frames] of this.ballHitCooldowns) {
      if (frames <= 1) this.ballHitCooldowns.delete(key);
      else this.ballHitCooldowns.set(key, frames - 1);
    }
    const rolled = this.balls.tick(floor);
    if (rolled.bounced.length > 0) this.raiseCue(GYM_CUES.ballBounce.takes);
    const reach = EXERCISE_BALL_RADIUS_PX + TILE_SIZE * CRAWLER_BODY_RADIUS_TILES;
    this.balls.all.forEach((state, index) => {
      if (state.phase !== 'rolling') return;
      for (const crawler of presentCrawlers(ctx)) {
        if (!crawler.isAlive) continue;
        const cooldownKey = `${index}:${crawler === ctx.human ? 'human' : 'cat'}`;
        if (this.ballHitCooldowns.has(cooldownKey)) continue;
        const dx = state.x - (crawler.x + TILE_SIZE * TILE_CENTER);
        const dy = state.y - (crawler.y + TILE_SIZE * TILE_CENTER);
        const distance = Math.hypot(dx, dy);
        if (distance >= reach) continue;
        this.ballHitCooldowns.set(cooldownKey, BALL_REHIT_FRAMES);
        this.raiseCue(GYM_CUES.ballBounce.takes);
        if (distance > 0) this.balls.reflect(index, dx / distance, dy / distance);
        if (crawler === ctx.active && bigRooster !== null && !this.defeated) {
          bigRooster.landExerciseBall(crawler, state.vx, state.vy);
        } else {
          // Square to the ball's run, on whichever side the companion already stands.
          const speed = Math.hypot(state.vx, state.vy);
          const sideX = speed === 0 ? 1 : -state.vy / speed;
          const sideY = speed === 0 ? 0 : state.vx / speed;
          const sign = -dx * sideX - dy * sideY >= 0 ? 1 : -1;
          crawler.applyKnockback(
            sideX * sign,
            sideY * sign,
            TILE_SIZE * BALL_SHOVE_TILES,
            BALL_SHOVE_FRAMES,
          );
        }
      }
    });
  }

  // ── Fight state, for gates ─────────────────────────────────────────────────

  /** Every bell in the air. */
  get fallingKettlebells(): readonly FallingKettlebell[] {
    return this.rain.falling;
  }

  /** True while bells are still due to go up. */
  get kettlebellsRaining(): boolean {
    return this.rain.raining;
  }

  /** Every exercise ball's phase and motion, in the layout's order. */
  get exerciseBalls(): ExerciseBalls['all'] {
    return this.balls.all;
  }

  private shutterWantsClosed(): boolean {
    if (!this.sealed) return false;
    return !this.defeated || this.lootSealed;
  }

  private advanceShutter(): void {
    const target = this.shutterWantsClosed() ? SHUTTER_CLOSED_FRAME : 0;
    if (this.shutterFrame === target) {
      this.shutterHold = 0;
      return;
    }
    if (this.shutterFrame === 0 || this.shutterFrame === SHUTTER_CLOSED_FRAME) {
      if (this.shutterHold === 0 && target === 0) this.pendingSounds.push(['gate_opening']);
    }
    this.shutterHold++;
    if (this.shutterHold < SHUTTER_FRAME_HOLD) return;
    this.shutterHold = 0;
    this.shutterFrame += target > this.shutterFrame ? 1 : -1;
  }

  private tickRacks(bigRooster: BigRooster | null): void {
    let changed = false;
    for (const rack of this.racks) {
      for (const slot of rack.slots) {
        if (slot.filled) continue;
        slot.respawnTimer--;
        if (slot.respawnTimer <= 0) {
          slot.filled = true;
          changed = true;
        }
      }
    }
    for (const bench of this.benches) {
      if (bench.active) continue;
      bench.respawnTimer--;
      if (bench.respawnTimer <= 0) bench.active = true;
    }

    const request = bigRooster?.requestDumbbellAt ?? null;
    if (bigRooster !== null && request !== null) {
      for (const rack of this.racks) {
        if (
          Math.hypot(request.x - rack.standAt.x, request.y - rack.standAt.y) >=
          TILE_SIZE * BIG_ROOSTER_RACK_DETECT_TILES
        ) {
          continue;
        }
        const slot = this.topFilledSlot(rack);
        if (slot === null) continue;
        slot.filled = false;
        slot.respawnTimer = DUMBBELL_RESPAWN_FRAMES;
        bigRooster.onDumbbellPickedUp();
        changed = true;
        break;
      }
      // A request answers one grab. Left standing over an empty rack, it would
      // hand him the next dumbbell to respawn there in the middle of a slam.
      bigRooster.requestDumbbellAt = null;
    }

    if (bigRooster?.isAlive === true) {
      const bossCx = bigRooster.x + TILE_SIZE * TILE_CENTER;
      const bossCy = bigRooster.y + TILE_SIZE * TILE_CENTER;
      let nearest: { x: number; y: number } | null = null;
      let nearestDist = Infinity;
      for (const position of this.getActiveDumbbellPositions()) {
        const dist = Math.hypot(position.x - bossCx, position.y - bossCy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = position;
        }
      }
      bigRooster.nearestDumbbellPos = nearest;
    }
    if (changed) this.publishPropState();
  }

  private tickSquatRacks(bigRooster: BigRooster | null): void {
    let changed = false;
    for (const squat of this.squatRacks) {
      if (squat.strippedFrames <= 0) continue;
      squat.strippedFrames--;
      if (squat.strippedFrames <= 0) changed = true;
    }
    if (bigRooster !== null) {
      const taken = bigRooster.plateTakenFrom;
      if (taken !== null) {
        bigRooster.plateTakenFrom = null;
        const squat = this.squatRacks.find((candidate) => {
          const centre = tileCentre(candidate.tile);
          return centre.x === taken.x && centre.y === taken.y;
        });
        if (squat !== undefined) {
          squat.strippedFrames = SQUAT_RACK_RESTOCK_FRAMES;
          this.spawnPuffs(taken, CHALK_PUFFS_PER_PLATE);
          changed = true;
        }
      }
      bigRooster.loadedSquatRacks = this.squatRacks
        .filter((squat) => squat.strippedFrames <= 0)
        .map((squat) => tileCentre(squat.tile));
    }
    if (changed) this.publishPropState();
  }

  private tickConsoles(): void {
    for (const treadmill of this.treadmills) {
      if (treadmill.shutoffFrames <= 0) continue;
      treadmill.shutoffFrames--;
      const beepStarts = treadmill.shutoffFrames === CONSOLE_BEEP_FRAMES;
      if (beepStarts && this.beltsLive) this.pendingSounds.push(['cooldown_crisp']);
    }
  }

  /**
   * A crawler's swing at a treadmill console shuts that belt off; at the
   * boombox, it breaks a little more. Read off the same one-frame swing peak
   * `CombatSystem` resolves a punch on, so a swing counts once.
   */
  private resolvePropHits(ctx: SystemContext): void {
    for (const attacker of presentCrawlers(ctx)) {
      if (!attacker.isAlive || !attacker.isAttackPeak()) continue;
      const ax = attacker.x + TILE_SIZE * TILE_CENTER;
      const ay = attacker.y + TILE_SIZE * TILE_CENTER;
      const reach = attacker.getMeleeRange() * PROP_HIT_REACH_SHARE;
      const inReach = (tile: TilePoint): boolean => {
        const centre = tileCentre(tile);
        const dx = centre.x - ax;
        const dy = centre.y - ay;
        const dist = Math.hypot(dx, dy);
        if (dist > reach) return false;
        return dist < TILE_SIZE * TILE_CENTER || dx * attacker.facingX + dy * attacker.facingY > 0;
      };
      if (this.beltsLive) {
        for (const treadmill of this.treadmills) {
          if (treadmill.shutoffFrames > 0 || !inReach(treadmill.layout.console)) continue;
          treadmill.shutoffFrames = CONSOLE_SHUTOFF_FRAMES;
          this.pendingSounds.push(['error']);
        }
      }
      const boombox = this.layout?.boombox ?? null;
      if (boombox !== null && this.boomboxHp > 0 && inReach(boombox)) {
        this.boomboxHp--;
        this.pendingSounds.push(this.boomboxHp <= 0 ? WOOD_SMASHING_SOUNDS : ['hammer_strike']);
      }
    }
  }

  /**
   * Carries everything standing on a running belt along it, crawlers and mobs
   * alike, with the same per-axis wall collision a shove uses — so a belt can
   * slide a body into a wall and no further. The belts all run out of the wall
   * into the room.
   */
  private pushBodiesOnBelts(ctx: SystemContext): void {
    if (!this.beltsLive || this.gameMap === null) return;
    const map = this.gameMap;
    const push = (body: Pick<Player, 'x' | 'y' | 'mobility' | 'isCrossingFooting'>): boolean => {
      const belt = this.poweredBeltAt(
        body.x + TILE_SIZE * TILE_CENTER,
        body.y + TILE_SIZE * TILE_CENTER,
      );
      if (belt === null) return false;
      pushPlayerWithCollision(
        body,
        belt.push.dx * TREADMILL_PUSH_PX_PER_FRAME,
        belt.push.dy * TREADMILL_PUSH_PX_PER_FRAME,
        map,
        body.mobility,
      );
      return true;
    };
    for (const crawler of presentCrawlers(ctx)) {
      if (crawler.isAlive) push(crawler);
    }
    for (const mob of ctx.roster.mobs) {
      if (!mob.isAlive || mob.isFlying) continue;
      const ox = mob.x;
      const oy = mob.y;
      if (push(mob)) ctx.roster.grid.move(mob, ox, oy);
    }
  }

  /**
   * Kicks the camera on the frame a wave appears and lets it fall away after,
   * and shakes chalk off the rack nearest the blow.
   *
   * Armed off the marker becoming live rather than off a flag the boss sets,
   * so neither can be re-armed every frame of the wave it belongs to.
   */
  private updateShakeAndChalk(bigRooster: BigRooster | null): void {
    const wave = bigRooster?.slamShockwave ?? null;
    if (wave !== null && !this.shockwaveRunning) {
      this.shakeFrames = SHAKE_FRAMES;
      const rack = this.nearestRackTo(wave.x, wave.y);
      if (rack !== null) this.spawnPuffs(tileCentre(rack), CHALK_PUFFS_PER_SLAM);
    }
    this.shockwaveRunning = wave !== null;

    if (this.shakeFrames > 0) {
      this.shakeFrames--;
      const falloff = this.shakeFrames / SHAKE_FRAMES;
      const amplitude = SHAKE_PEAK_PX * falloff * falloff;
      this.shakeX = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
      this.shakeY = (Math.random() - RANDOM_MIDPOINT) * 2 * amplitude;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  private nearestRackTo(x: number, y: number): TilePoint | null {
    let best: TilePoint | null = null;
    let bestDist = Infinity;
    for (const tile of [
      ...this.racks.map((rack) => rack.tile),
      ...this.squatRacks.map((s) => s.tile),
    ]) {
      const centre = tileCentre(tile);
      const dist = Math.hypot(centre.x - x, centre.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = tile;
      }
    }
    return best;
  }

  /**
   * Puffs scattered round a point on a golden-angle spiral: evenly spread and
   * the same every time, with no randomness to replay.
   */
  private spawnPuffs(at: { x: number; y: number }, count: number): void {
    for (let index = 0; index < count; index++) {
      if (this.puffs.length >= CHALK_PUFF_CAP) this.puffs.shift();
      const angle = index * GOLDEN_ANGLE;
      const radius = TILE_SIZE * CHALK_PUFF_SCATTER_TILES * Math.sqrt((index + 1) / count);
      this.puffs.push({
        x: at.x + Math.cos(angle) * radius,
        y: at.y + Math.sin(angle) * radius,
        // Staggered starts so a burst swells rather than popping all at once.
        age: -index,
      });
    }
  }

  private tickPuffs(): void {
    for (const puff of this.puffs) puff.age++;
    for (let index = this.puffs.length - 1; index >= 0; index--) {
      if (this.puffs[index].age >= CHALK_PUFF_LIFE_FRAMES) this.puffs.splice(index, 1);
    }
  }

  /** How many chalk puffs are alive, for the cap gate. */
  get livePuffCount(): number {
    return this.puffs.length;
  }

  // ── Hazard ground ────────────────────────────────────────────────────────

  /**
   * A kettlebell's shadow is ground to leave before the bell lands, and a
   * rolling ball's path is ground to step out of. Running belts are soft
   * ground — a companion steps off one rather than riding it — and a plate
   * lane is live from the first chalk mark until the plate stops. Lanes,
   * paths and belts all answer with a step square to their run.
   */
  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    if (this.gameMap !== null && this.rain.falling.length > 0) {
      const zones = this.rain.falling.map((bell) => ({
        x: bell.x,
        y: bell.y,
        radiusPx: KETTLEBELL_ESCAPE_RADIUS_PX,
      }));
      const escape = escapeFromCircleZones(this.gameMap, zones, x, y);
      if (escape !== null) return escape;
    }
    const ballEscape = this.balls.escapeFrom(x, y);
    if (ballEscape !== null) return ballEscape;
    const lane = this.bigRooster?.plateRollLane ?? null;
    if (lane !== null) {
      const reach = TILE_SIZE * PLATE_ROLL_HIT_RADIUS_TILES + LANE_ESCAPE_MARGIN_PX;
      for (let index = 0; index + 1 < lane.length; index++) {
        const escape = awayFromSegment(x, y, lane[index], lane[index + 1], reach);
        if (escape !== null) return escape;
      }
    }
    const belt = this.poweredBeltAt(x, y);
    if (belt === null) return null;
    const centre = tileCentre(belt.belt[0]);
    // Square to the run, toward whichever side of the belt the point already leans.
    const sideX = belt.push.dy;
    const sideY = -belt.push.dx;
    const lean = (x - centre.x) * sideX + (y - centre.y) * sideY;
    const sign = lean >= 0 ? 1 : -1;
    return { dx: sideX * sign, dy: sideY * sign };
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  override renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    promptFor: HumanPlayer | CatPlayer | undefined,
  ): void {
    const layout = this.layout;
    if (layout === null) return;
    const ts = TILE_SIZE;

    for (const strip of this.stripLights) {
      drawStripLight(ctx, strip.x - camX, strip.y - camY, strip.widthPx);
    }

    const beltFrame = timeFrameIndex(frameTime, BELT_FRAMES_PER_SECOND, Number.MAX_SAFE_INTEGER);
    for (const treadmill of this.treadmills) {
      if (!this.isPowered(treadmill)) continue;
      for (const tile of treadmill.layout.belt) {
        drawGymBeltSprite(
          ctx,
          tile.x * ts - camX,
          tile.y * ts - camY,
          ts,
          treadmill.layout.push,
          beltFrame,
        );
      }
    }

    if (this.mirrorCracked) this.drawMirrorCrack(ctx, layout, camX, camY);

    const wave = this.bigRooster?.slamShockwave ?? null;
    if (wave !== null) {
      drawSlamShockwave(ctx, {
        cx: wave.x - camX,
        cy: wave.y - camY,
        radius: wave.radiusPx,
        progress: wave.progress,
        seed: wave.seed,
      });
    }

    for (const bench of this.benches) {
      if (!bench.active) continue;
      drawGymPickupSprite(ctx, 'bench', bench.tile.x * ts - camX, bench.tile.y * ts - camY, ts);
    }
    if (promptFor === undefined) return;
    const target = this.interactTarget(promptFor);
    if (target === null) return;
    const promptTile = target.kind === 'rack' ? target.rack.tile : target.bench.tile;
    const tileTop = promptTile.y * ts - camY;
    const artTop =
      target.kind === 'rack' ? gymRackInkTop(tileTop, ts) : gymPickupInkTop('bench', tileTop, ts);
    drawInteractionPrompt(
      ctx,
      promptTile.x * ts - camX,
      artTop,
      ts,
      tileTop + ts,
      target.kind === 'rack' ? 'Take dumbbell' : 'Pick up',
    );
  }

  override renderGroundWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.layout === null) return;
    const lane = this.bigRooster?.plateRollLane ?? null;
    if (lane !== null && lane.length >= 2) this.drawPlateLane(ctx, lane, camX, camY);

    for (const bell of this.rain.falling) {
      const progress = 1 - bell.framesLeft / KETTLEBELL_FALL_FRAMES;
      drawKettlebellShadow(
        ctx,
        bell.x - camX,
        bell.y - camY,
        KETTLEBELL_IMPACT_RADIUS_PX,
        progress,
      );
      drawDangerCircle(
        ctx,
        bell.x - camX,
        bell.y - camY,
        KETTLEBELL_IMPACT_RADIUS_PX,
        KETTLEBELL_WARNING_FADE,
        { fillProgress: progress },
      );
    }
  }

  private drawMirrorCrack(
    ctx: CanvasRenderingContext2D,
    layout: GymLayout,
    camX: number,
    camY: number,
  ): void {
    const tiles = layout.mirror.tiles;
    if (tiles.length < GYM_MIRROR_CRACK_TILES) return;
    const first = tiles[Math.floor((tiles.length - GYM_MIRROR_CRACK_TILES) / 2)];
    drawGymMirrorCrackSprite(
      ctx,
      first.x * TILE_SIZE - camX,
      first.y * TILE_SIZE - camY,
      TILE_SIZE,
      layout.mirror.alongY,
    );
  }

  /** The plate's whole run as a ground warning: every tile its hit circle sweeps on the way. */
  private drawPlateLane(
    ctx: CanvasRenderingContext2D,
    lane: PlateLane,
    camX: number,
    camY: number,
  ): void {
    const onScreen = lane.map((point) => ({ x: point.x - camX, y: point.y - camY }));
    const hitRadiusPx = TILE_SIZE * PLATE_ROLL_HIT_RADIUS_TILES;
    drawDangerPath(ctx, onScreen, hitRadiusPx, PLATE_LANE_FADE, { locked: true });
  }

  override renderEntities(): ReadonlyArray<DressingRenderable> {
    const layout = this.layout;
    this.renderables.length = 0;
    if (layout === null) return this.renderables;
    const overlayFrame = timeFrameIndex(
      frameTime,
      SPRITE_BUILDING_OVERLAY_FPS,
      Number.MAX_SAFE_INTEGER,
    );
    const blink = overlayFrame % 2;

    this.treadmills.forEach((treadmill) => {
      const state: GymConsoleState = !this.isPowered(treadmill)
        ? treadmill.shutoffFrames > 0 &&
          treadmill.shutoffFrames <= CONSOLE_BEEP_FRAMES &&
          this.beltsLive
          ? 'beep'
          : 'off'
        : 'on';
      const tile = treadmill.layout.console;
      this.renderables.push({
        x: tile.x * TILE_SIZE,
        y: tile.y * TILE_SIZE,
        render: (ctx, camX, camY, ts) =>
          drawGymConsoleSprite(ctx, tile.x * ts - camX, tile.y * ts - camY, ts, state, blink),
      });
    });

    const boombox = layout.boombox;
    if (boombox !== null) {
      const look = this.boomboxBroken ? 'broken' : this.beltsLive ? 'thump' : 'intact';
      this.renderables.push({
        x: boombox.x * TILE_SIZE,
        y: boombox.y * TILE_SIZE,
        render: (ctx, camX, camY, ts) =>
          drawGymBoomboxSprite(ctx, boombox.x * ts - camX, boombox.y * ts - camY, ts, look, blink),
      });
    }

    if (this.shutterFrame > 0) {
      const frame = this.shutterFrame;
      for (const doorway of layout.doorways) {
        const acrossY = doorway.side === 'east' || doorway.side === 'west';
        for (const tile of doorway.tiles) {
          const wall = outwardOf(tile, doorway.side);
          this.renderables.push({
            x: wall.x * TILE_SIZE,
            y: wall.y * TILE_SIZE,
            render: (ctx, camX, camY, ts) =>
              drawGymShutterSprite(ctx, wall.x * ts - camX, wall.y * ts - camY, ts, frame, acrossY),
          });
        }
      }
    }

    const spinFrame = Math.floor(this.ballAgeFrames / BALL_SPIN_FRAME_HOLD);
    this.balls.all.forEach((state, index) => {
      const centre = this.balls.centreOf(index);
      const colour = GYM_EXERCISE_BALL_COLOURS[index % GYM_EXERCISE_BALL_COLOURS.length];
      const frame = state.phase === 'rolling' || state.phase === 'stopping' ? spinFrame + index : 0;
      const left = centre.x - TILE_SIZE * TILE_CENTER;
      const top = centre.y - TILE_SIZE * BALL_ART_CENTRE_SHARE;
      this.renderables.push({
        x: left,
        y: top,
        render: (ctx, camX, camY, ts) =>
          drawGymExerciseBallSprite(ctx, left - camX, top - camY, ts, colour, frame),
      });
    });

    const plate = this.bigRooster?.bowledPlate ?? null;
    if (plate !== null) {
      const frame = Math.floor(plate.age / PLATE_SPIN_FRAME_HOLD) % GYM_PLATE_FRAMES;
      const left = plate.x - TILE_SIZE * TILE_CENTER;
      const top = plate.y - TILE_SIZE * TILE_CENTER;
      this.renderables.push({
        x: left,
        y: top,
        render: (ctx, camX, camY, ts) =>
          drawGymPlateSprite(ctx, left - camX, top - camY, ts, frame),
      });
    }
    return this.renderables;
  }

  override renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    // Drawn by the room rather than by Big Rooster, so a dumbbell thrown across
    // the gym stays in the air while he is off screen.
    const thrown = this.bigRooster?.thrownDumbbell ?? null;
    if (thrown !== null) {
      drawThrownDumbbell(
        ctx,
        thrown.x,
        thrown.y,
        camX,
        camY,
        TILE_SIZE,
        thrown.vx,
        thrown.vy,
        thrown.age,
      );
    }
    for (const bell of this.rain.falling) {
      const height =
        TILE_SIZE * KETTLEBELL_DROP_HEIGHT_TILES * (bell.framesLeft / KETTLEBELL_FALL_FRAMES);
      drawGymFallingKettlebellSprite(
        ctx,
        bell.x - TILE_SIZE * TILE_CENTER - camX,
        bell.y - TILE_SIZE * KETTLEBELL_ART_CENTRE_SHARE - height - camY,
        TILE_SIZE,
        bell.band,
      );
    }
    for (const puff of this.puffs) {
      if (puff.age < 0) continue;
      const frame = Math.floor(puff.age / CHALK_PUFF_FRAME_HOLD);
      drawGymChalkPuffSprite(
        ctx,
        puff.x - TILE_SIZE * TILE_CENTER - camX,
        puff.y - TILE_SIZE * TILE_CENTER - camY,
        TILE_SIZE,
        frame,
      );
    }
  }
}

function outwardOf(tile: TilePoint, side: 'north' | 'south' | 'east' | 'west'): TilePoint {
  switch (side) {
    case 'north':
      return { x: tile.x, y: tile.y - 1 };
    case 'south':
      return { x: tile.x, y: tile.y + 1 };
    case 'east':
      return { x: tile.x + 1, y: tile.y };
    case 'west':
      return { x: tile.x - 1, y: tile.y };
  }
}

/** A unit step away from segment a–b for a point within `reach` of it, or null. */
function awayFromSegment(
  x: number,
  y: number,
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  reach: number,
): { dx: number; dy: number } | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return null;
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lengthSq));
  const nearestX = a.x + abx * t;
  const nearestY = a.y + aby * t;
  const dx = x - nearestX;
  const dy = y - nearestY;
  const dist = Math.hypot(dx, dy);
  if (dist >= reach) return null;
  if (dist > 0) return { dx: dx / dist, dy: dy / dist };
  const length = Math.sqrt(lengthSq);
  return { dx: -aby / length, dy: abx / length };
}
