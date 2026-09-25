import { TILE_SIZE } from '../../core/constants';
import type { CanvasSurface } from '../../core/canvasSurface';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { GrotesqueSpider } from '../../creatures/GrotesqueSpider';
import {
  PHASE_ROAR_BUILD_FRAMES,
  isInsideSlamCone,
  type SlamImpact,
} from '../../creatures/grotesqueSpiderTimeline';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { EGG_HATCH_FRAMES } from '../../creatures/SpiderEgg';
import type { ItemId } from '../../core/ItemDefs';
import type { GameMap, SpiderLabRoomData } from '../../map/GameMap';
import {
  registerSpiderLabFloorPlan,
  type SpiderLabFloorPlan,
} from '../../map/tiles/bossRooms/labFloorPlan';
import { tileCoordKey, tileKeyX, tileKeyY } from '../../map/tileIndex';
import {
  LAB_BENCH,
  LAB_WEB,
  PROP_DAMAGE_STAGE_CRACKED,
  PROP_DAMAGE_STAGE_INTACT,
  SPIDER_LAB_FLOOR,
  placeProp,
  positionHash,
  type TileContent,
} from '../../map/tileTypes';
import { drawRadialGlow, type GlowStop } from '../../sprites/radialGlow';
import {
  COCOON_HATCH_FRAMES,
  COCOON_IDLE_FRAMES,
  LIGHT_BANK_TILES,
  WEB_GROWTH_FRAMES,
} from '../../sprites/art/spiderLabArt';
import type { SystemContext } from '../GameSystem';
import type { LootSystem } from '../LootSystem';
import type { CheckpointedDressing, DressingRenderable } from './BossRoomDressing';
import { InertBossRoomDressing } from './InertBossRoomDressing';
import type { CocoonState, SpiderLabDressingCheckpoint } from './spiderLabCheckpoint';
import {
  DARKNESS_MASK_PAD_PX,
  DARKNESS_MASK_SCALE,
  FIRST_DARK_PHASE,
  LAST_LIGHT_PHASE,
  bakeDarknessMask,
  bankLitIn,
  darknessBounds,
  labLightBanks,
  type LabLightPhase,
  type LightBank,
} from './spiderLabLighting';

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Hits a cocoon takes before it tears open. */
export const COCOON_HP = 3;
/** Share of broken cocoons that let a hatchling loose; the rest pay out. */
export const COCOON_HATCHLING_SHARE = 0.5;
/** A laying spider wakes every intact cocoon within this many tiles of her. */
export const COCOON_WAKE_RADIUS_TILES = 5;
/** A melee swing clears web this far round the spot it lands on, in tiles. */
export const MELEE_WEB_CLEAR_RADIUS_TILES = 1;
/** A missile's detonation clears web this far round it, in tiles. */
export const BLAST_WEB_CLEAR_RADIUS_TILES = 2;
/** Frames a cut web takes to spin back over its tile when her last roar calls it. */
export const WEB_REGROW_FRAMES = 60;
/** Most cut web tiles spinning back at once; the rest wait their turn. */
export const MAX_WEBS_REGROWING = 24;
/** Frames the dark takes to come down after a roar blows the banks. */
export const DARKNESS_FADE_FRAMES = 30;
/** Frames the surviving lights take to come back up once she is dead. */
const LIGHTS_RESTORE_FRAMES = 90;

/** The ambient particles the room may keep alive at once: sparks, shards and haze together. */
export const MAX_LAB_PARTICLES = 40;
const SPARKS_PER_BLOWN_BANK = 8;
const SHARDS_PER_BROKEN_BENCH = 3;

/** A crawler's swing lands this share of its reach in front of it. */
const SWING_LANDING_SHARE = 0.5;
/** A cocoon counts as struck when the swing lands within this many tiles of it. */
const COCOON_HIT_REACH_TILES = 1;
/** Coins a cocoon pays, and the chance its loot is a consumable instead. */
const COCOON_COINS_MIN = 2;
const COCOON_COINS_SPREAD = 4;
const COCOON_CONSUMABLE_CHANCE = 0.3;
const COCOON_CONSUMABLES: readonly ItemId[] = ['health_potion', 'speed_fizz'];

/** Cocoon twitches: one in this many beats, a cocoon twitches for a beat. */
const TWITCH_BEAT_FRAMES = 24;
const TWITCH_ODDS = 7;

/** Fluorescent flicker: a bank stutters for a few frames once in a while. */
const FLICKER_PERIOD_FRAMES = 240;
const FLICKER_RUN_FRAMES = 14;
const FLICKER_BEAT_FRAMES = 3;
/** A blown bank still spits a spark now and then, once in this many frames. */
const DEAD_BANK_SPARK_PERIOD = 150;

/** The lab is drawn when it is within this many tiles of the view. */
const VIEW_MARGIN_TILES = 2;
/** The lab's ambience runs while the active crawler is within this many tiles of it. */
const AMBIENCE_REACH_TILES = 12;
/** What a webbed tile shows through the dark. */
const WEB_GLIMMER_COLOR = 'rgba(205,208,196,0.22)';

/** How far above its pool a bank is drawn: it hangs from the ceiling, not the floor. */
const BANK_HANG_TILES = 1.4;

/** Fume-hood haze: which benches steam, how often, and how it drifts. */
const HAZE_EVERY_NTH_BENCH = 7;
const HAZE_PERIOD_FRAMES = 50;
const HAZE_LIFE_FRAMES = 110;
const HAZE_RISE_PX = 0.25;
const HAZE_RADIUS_PX = 9;
const HAZE_GROWTH = 0.8;
const HAZE_STOPS: readonly GlowStop[] = [
  { offset: 0, color: 'rgba(200,240,190,0.32)' },
  { offset: 1, color: 'rgba(200,240,190,0)' },
];

/** Sparks and shards fall under this gravity, in pixels per frame per frame. */
const PARTICLE_GRAVITY = 0.12;
const SPARK_LIFE_FRAMES = 40;
const SHARD_LIFE_FRAMES = 30;
const SPARK_SPEED = 1.6;
const SHARD_SPEED = 2.2;
const SPARK_COLOR = '#fff3b0';
const SHARD_COLOR = '#dff6ff';
const PARTICLE_SIZE_PX = 2;

/** Eye-shine: how far ahead of centre her eyes sit, in tiles, and the glint itself. */
const SPIDER_EYE_FORWARD_TILES = 0.55;
const HATCHLING_EYE_FORWARD_TILES = 0.2;
const EYE_SPACING_PX = 3;
const EYE_GLINT_PX = 2;
const EYE_COLOR = '#ff4a3a';

/** The regrowing web plays its frames over the regrow. */
const WEB_GROWTH_TOTAL = WEB_GROWTH_FRAMES;

const HALF = 0.5;
const TILE_CENTRE = 0.5;

// ── State ────────────────────────────────────────────────────────────────────

interface Cocoon {
  readonly tileX: number;
  readonly tileY: number;
  hp: number;
  state: CocoonState;
  /** Frames left before a woken cocoon splits. */
  hatchFramesLeft: number;
  readonly renderable: DressingRenderable;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly maxLife: number;
  readonly kind: 'spark' | 'shard' | 'haze';
}

/**
 * What the lab asks of the quest that owns its fight: the egg sac's look, the
 * brood it shares a cap with, and the people it draws in the room.
 */
export interface SpiderLabQuestView {
  /** The egg sac's row and frame this tick. */
  eggSacLook(): { state: 'whole' | 'opening' | 'opened'; frame: number };
  /** Live eggs plus hatchlings, against the brood cap. */
  liveBroodCount(): number;
  /** The most brood the room may hold at once. */
  broodCap(): number;
  /** Lets one hatchling loose at a tile, counted in the brood. */
  spawnHatchling(tileX: number, tileY: number): void;
  /** Whether a hatchling may be let loose now: never once the lab is won. */
  hatchlingsAllowed(): boolean;
  /** Anyone the quest stands in the room — the scientist, living or not. */
  people(): ReadonlyArray<DressingRenderable>;
}

/** The part of the loot system a cocoon pays out through. */
export type LabLootSink = Pick<LootSystem, 'addLoot'>;

/**
 * The Grotesque Spider's lab: its webbing, its cocooned staff, its lighting,
 * the glassware on its benches, and the egg sac she hatches from.
 *
 * Owned by `SpiderQuestSystem`, which runs the lab's lock, cutscene and fight,
 * announces each turn of the fight to this, and hands over what her attacks
 * did (`observeFight`) so the room can answer. Kept out of that system so the
 * room's furniture does not have to live inside the quest's state machine.
 */
export class SpiderLabDressing
  extends InertBossRoomDressing
  implements CheckpointedDressing<SpiderLabDressingCheckpoint>
{
  /** Her slam just smashed glassware; the scene plays it and clears it. */
  glassShatterSoundPending = false;
  /** A cocoon split, or tore under a blow; the scene plays it and clears it. */
  cocoonSplatSoundPending = false;

  private readonly plan: SpiderLabFloorPlan;
  private readonly originalWebs: ReadonlySet<number>;
  /** Cut webs spinning back, by tile key, with frames left. */
  private readonly regrowing = new Map<number, number>();
  private readonly cocoons: Cocoon[];
  private readonly benchKeys: readonly number[];
  private readonly hazeBenches: ReadonlyArray<{ x: number; y: number }>;
  private readonly banks: readonly LightBank[];
  private lightPhase: LabLightPhase = 1;
  private lightsRestored = false;
  /** Frames since the lighting last changed, for its fade. */
  private lightChangeFrames = DARKNESS_FADE_FRAMES;
  private readonly masks = new Map<LabLightPhase, CanvasSurface>();
  private readonly particles: Particle[] = [];
  private readonly renderables: DressingRenderable[] = [];
  /** Missiles already counted as detonated, so each clears the web once. */
  private readonly spentMissiles = new WeakSet();
  private preSeal: SpiderLabDressingCheckpoint | null = null;
  private quest: SpiderLabQuestView | null = null;
  private lootSink: LabLootSink | null = null;
  private clock = 0;
  private readonly eggSacRenderable: DressingRenderable;

  constructor(
    readonly gameMap: GameMap,
    readonly room: SpiderLabRoomData,
  ) {
    super();
    this.plan = registerSpiderLabFloorPlan(gameMap.structure, room);
    this.originalWebs = new Set(room.webTiles.map((t) => tileCoordKey(t.x, t.y)));
    this.benchKeys = room.benchTiles.map((t) => tileCoordKey(t.x, t.y));
    this.hazeBenches = room.benchTiles.filter((_tile, i) => i % HAZE_EVERY_NTH_BENCH === 0);
    this.banks = labLightBanks(room);
    this.cocoons = room.cocoonTiles.map((tile) => {
      const cocoon: Cocoon = {
        tileX: tile.x,
        tileY: tile.y,
        hp: COCOON_HP,
        state: 'intact',
        hatchFramesLeft: 0,
        renderable: {
          x: tile.x * TILE_SIZE,
          y: tile.y * TILE_SIZE,
          render: (ctx, camX, camY, tileSize) => this.drawCocoon(ctx, cocoon, camX, camY, tileSize),
        },
      };
      return cocoon;
    });
    const egg = room.spiderEggTile;
    this.eggSacRenderable = {
      x: egg.x * TILE_SIZE,
      y: egg.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) => {
        const look = this.quest?.eggSacLook() ?? { state: 'whole', frame: 0 };
        drawSpriteKey(
          ctx,
          'spider_lab_egg_sac',
          look.state,
          look.frame,
          egg.x * tileSize - camX,
          egg.y * tileSize - camY,
          tileSize,
        );
      },
    };
  }

  /** Connects the quest that runs the lab's fight. */
  attachQuest(quest: SpiderLabQuestView): void {
    this.quest = quest;
  }

  /** Where a broken cocoon's loot goes. Without one, a cocoon pays nothing. */
  setLootSink(sink: LabLootSink): void {
    this.lootSink = sink;
  }

  // ── Fight hooks ────────────────────────────────────────────────────────────

  override onSeal(): void {
    this.preSeal = this.captureCheckpoint();
    // Painted now, while the door shuts, rather than on the roar that needs
    // them: the roar is the busiest frame of the fight.
    this.maskFor(FIRST_DARK_PHASE);
    this.maskFor(LAST_LIGHT_PHASE);
  }

  override onFightAborted(): void {
    if (this.preSeal !== null) this.restoreCheckpoint(this.preSeal);
    this.dropTransients();
  }

  override onBossDefeated(): void {
    if (this.lightsRestored) return;
    this.lightsRestored = true;
    this.lightChangeFrames = 0;
    for (const cocoon of this.cocoons) {
      if (cocoon.state === 'hatching') cocoon.state = 'burst';
    }
  }

  override resetForCheckpoint(): void {
    this.dropTransients();
    this.preSeal = null;
  }

  private dropTransients(): void {
    this.particles.length = 0;
    this.regrowing.clear();
    this.glassShatterSoundPending = false;
    this.cocoonSplatSoundPending = false;
    this.lightChangeFrames = DARKNESS_FADE_FRAMES;
  }

  /**
   * What her fight did this tick, from the quest that drained it off her: the
   * slams that landed, the eggs she laid, and her roar.
   */
  observeFight(spider: GrotesqueSpider, slams: readonly SlamImpact[], laidEggs: number): void {
    for (const slam of slams) this.shatterGlassUnder(slam);
    const roarBurst = spider.roarFrame === PHASE_ROAR_BUILD_FRAMES;
    const phase = spider.hpPhase;
    if (roarBurst && phase > this.lightPhase) this.enterLightPhase(phase);
    if (laidEggs > 0 && phase === LAST_LIGHT_PHASE) this.wakeCocoonsNear(spider);
  }

  /**
   * Blows the banks her roar takes and brings the dark down. At her last roar
   * the web she lost in the far half of the room spins back.
   */
  enterLightPhase(phase: LabLightPhase): void {
    if (phase <= this.lightPhase) return;
    for (const bank of this.banks) {
      if (bankLitIn(bank, this.lightPhase) && !bankLitIn(bank, phase)) {
        this.spawnParticles(
          bank.x,
          bank.y - BANK_HANG_TILES * TILE_SIZE,
          SPARKS_PER_BLOWN_BANK,
          'spark',
        );
      }
    }
    this.lightPhase = phase;
    this.lightChangeFrames = 0;
    this.maskFor(phase);
    if (phase === LAST_LIGHT_PHASE) this.regrowFarWebs();
  }

  private regrowFarWebs(): void {
    const halfway = this.plan.frame.depthMax / 2;
    for (const key of this.originalWebs) {
      if (!this.isCleared(key)) continue;
      const tile = this.tileOf(key);
      if (this.plan.frame.toFrame(tile).depth <= halfway) continue;
      this.regrowing.set(key, WEB_REGROW_FRAMES);
    }
  }

  private wakeCocoonsNear(spider: GrotesqueSpider): void {
    const herTileX = (spider.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE;
    const herTileY = (spider.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE;
    for (const cocoon of this.cocoons) {
      if (cocoon.state !== 'intact') continue;
      const distance = Math.hypot(
        cocoon.tileX + TILE_CENTRE - herTileX,
        cocoon.tileY + TILE_CENTRE - herTileY,
      );
      if (distance > COCOON_WAKE_RADIUS_TILES) continue;
      cocoon.state = 'hatching';
      cocoon.hatchFramesLeft = EGG_HATCH_FRAMES;
    }
  }

  /** Smashes the glassware on every bench a slam cone reaches. */
  shatterGlassUnder(slam: SlamImpact): void {
    let shattered = false;
    for (const key of this.benchKeys) {
      const tile = this.tileOf(key);
      const content = this.tileAt(tile);
      if (content?.type !== LAB_BENCH) continue;
      if ((content.damageStage ?? PROP_DAMAGE_STAGE_INTACT) !== PROP_DAMAGE_STAGE_INTACT) continue;
      const cx = (tile.x + TILE_CENTRE) * TILE_SIZE;
      const cy = (tile.y + TILE_CENTRE) * TILE_SIZE;
      if (!isInsideSlamCone(slam, cx, cy)) continue;
      content.damageStage = PROP_DAMAGE_STAGE_CRACKED;
      this.gameMap.markTileDirty(tile.x, tile.y);
      this.spawnParticles(cx, cy - TILE_SIZE * HALF, SHARDS_PER_BROKEN_BENCH, 'shard');
      shattered = true;
    }
    if (shattered) this.glassShatterSoundPending = true;
  }

  // ── Per frame ──────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    this.clock++;
    if (this.lightChangeFrames < LIGHTS_RESTORE_FRAMES) this.lightChangeFrames++;
    for (const crawler of [ctx.human, ctx.cat]) {
      if (crawler.isAlive && crawler.isAttackPeak()) this.resolveSwing(crawler);
    }
    for (const missile of ctx.cat.getMissiles()) {
      if (missile.state !== 'exploding' || this.spentMissiles.has(missile)) continue;
      this.spentMissiles.add(missile);
      this.clearWebAround(missile.x, missile.y, BLAST_WEB_CLEAR_RADIUS_TILES);
      this.strikeCocoonsNear(missile.x, missile.y, ctx.cat);
    }
    this.advanceRegrowth();
    this.advanceCocoons();
    if (this.isPartyNear(ctx.active)) this.advanceAmbience();
    this.advanceParticles();
  }

  private resolveSwing(crawler: HumanPlayer | CatPlayer): void {
    const reach = crawler.getMeleeRange() * SWING_LANDING_SHARE;
    const x = crawler.x + TILE_SIZE * TILE_CENTRE + crawler.facingX * reach;
    const y = crawler.y + TILE_SIZE * TILE_CENTRE + crawler.facingY * reach;
    this.clearWebAround(x, y, MELEE_WEB_CLEAR_RADIUS_TILES);
    this.strikeCocoonsNear(x, y, crawler);
  }

  /** Tears the web within `radiusPx` of a point: what her own slam and screech shake loose. */
  tearWeb(x: number, y: number, radiusPx: number): void {
    this.clearWebAround(x, y, radiusPx / TILE_SIZE);
  }

  private clearWebAround(x: number, y: number, radiusTiles: number): void {
    const centreX = x / TILE_SIZE;
    const centreY = y / TILE_SIZE;
    const reach = Math.ceil(radiusTiles);
    for (let ty = Math.floor(centreY) - reach; ty <= Math.floor(centreY) + reach; ty++) {
      for (let tx = Math.floor(centreX) - reach; tx <= Math.floor(centreX) + reach; tx++) {
        const within =
          Math.hypot(tx + TILE_CENTRE - centreX, ty + TILE_CENTRE - centreY) <= radiusTiles + HALF;
        if (!within) continue;
        const key = tileCoordKey(tx, ty);
        if (!this.originalWebs.has(key)) continue;
        this.regrowing.delete(key);
        this.setWebbed(key, false);
      }
    }
  }

  private strikeCocoonsNear(x: number, y: number, attacker: HumanPlayer | CatPlayer): void {
    for (const cocoon of this.cocoons) {
      if (cocoon.state === 'burst') continue;
      const cx = (cocoon.tileX + TILE_CENTRE) * TILE_SIZE;
      const cy = (cocoon.tileY + TILE_CENTRE) * TILE_SIZE;
      if (Math.hypot(cx - x, cy - y) > COCOON_HIT_REACH_TILES * TILE_SIZE) continue;
      cocoon.hp--;
      if (cocoon.hp > 0) continue;
      this.breakCocoon(cocoon, attacker);
    }
  }

  /**
   * Tears a cocoon open under a crawler's blows. One already splitting holds a
   * spider that dies with it; a sleeping one holds a spider or a payout, even odds.
   */
  private breakCocoon(cocoon: Cocoon, attacker: HumanPlayer | CatPlayer): void {
    const wasHatching = cocoon.state === 'hatching';
    cocoon.state = 'burst';
    cocoon.hp = 0;
    this.cocoonSplatSoundPending = true;
    if (wasHatching) return;
    if (Math.random() < COCOON_HATCHLING_SHARE && this.releaseHatchling(cocoon)) return;
    this.payOut(cocoon, attacker);
  }

  private releaseHatchling(cocoon: Cocoon): boolean {
    const quest = this.quest;
    if (quest?.hatchlingsAllowed() !== true) return false;
    if (quest.liveBroodCount() >= quest.broodCap()) return false;
    quest.spawnHatchling(cocoon.tileX, cocoon.tileY);
    return true;
  }

  private payOut(cocoon: Cocoon, attacker: HumanPlayer | CatPlayer): void {
    if (this.lootSink === null) return;
    const x = (cocoon.tileX + TILE_CENTRE) * TILE_SIZE;
    const y = (cocoon.tileY + TILE_CENTRE) * TILE_SIZE;
    const consumable =
      Math.random() < COCOON_CONSUMABLE_CHANCE
        ? COCOON_CONSUMABLES[Math.floor(Math.random() * COCOON_CONSUMABLES.length)]
        : undefined;
    const coins = COCOON_COINS_MIN + Math.floor(Math.random() * COCOON_COINS_SPREAD);
    this.lootSink.addLoot(
      x,
      y,
      consumable === undefined
        ? { coins, items: [] }
        : { coins: 0, items: [{ id: consumable, quantity: 1 }] },
      attacker,
      false,
      true,
      true,
    );
  }

  private advanceRegrowth(): void {
    // Tiles past the cap wait their turn, so however much web was cut, no
    // more than the cap spins at once and the regrowth's cost stays bounded.
    let spinning = 0;
    for (const [key, framesLeft] of this.regrowing) {
      if (spinning >= MAX_WEBS_REGROWING) break;
      spinning++;
      if (framesLeft > 1) {
        this.regrowing.set(key, framesLeft - 1);
        continue;
      }
      this.regrowing.delete(key);
      this.setWebbed(key, true);
    }
  }

  private advanceCocoons(): void {
    for (const cocoon of this.cocoons) {
      if (cocoon.state !== 'hatching') continue;
      cocoon.hatchFramesLeft--;
      if (cocoon.hatchFramesLeft > 0) continue;
      cocoon.state = 'burst';
      cocoon.hp = 0;
      this.cocoonSplatSoundPending = true;
      this.releaseHatchling(cocoon);
    }
  }

  /** Whether the active crawler is in or near the lab: its ambience runs for nobody otherwise. */
  private isPartyNear(active: { x: number; y: number }): boolean {
    const b = darknessBounds(this.room);
    const margin = AMBIENCE_REACH_TILES * TILE_SIZE;
    return (
      active.x >= b.x * TILE_SIZE - margin &&
      active.x <= (b.x + b.w) * TILE_SIZE + margin &&
      active.y >= b.y * TILE_SIZE - margin &&
      active.y <= (b.y + b.h) * TILE_SIZE + margin
    );
  }

  private advanceAmbience(): void {
    if (this.clock % HAZE_PERIOD_FRAMES === 0 && this.hazeBenches.length > 0) {
      const bench = this.hazeBenches[(this.clock / HAZE_PERIOD_FRAMES) % this.hazeBenches.length];
      {
        this.pushParticle({
          x: (bench.x + TILE_CENTRE) * TILE_SIZE,
          y: bench.y * TILE_SIZE,
          vx: 0,
          vy: -HAZE_RISE_PX,
          life: HAZE_LIFE_FRAMES,
          maxLife: HAZE_LIFE_FRAMES,
          kind: 'haze',
        });
      }
    }
    if (this.clock % DEAD_BANK_SPARK_PERIOD === 0) {
      const dead = this.banks.filter((bank) => !bankLitIn(bank, this.lightPhase));
      if (dead.length > 0) {
        const bank = dead[(this.clock / DEAD_BANK_SPARK_PERIOD) % dead.length];
        this.spawnParticles(bank.x, bank.y - BANK_HANG_TILES * TILE_SIZE, 2, 'spark');
      }
    }
  }

  private spawnParticles(x: number, y: number, count: number, kind: 'spark' | 'shard'): void {
    const speed = kind === 'spark' ? SPARK_SPEED : SHARD_SPEED;
    const life = kind === 'spark' ? SPARK_LIFE_FRAMES : SHARD_LIFE_FRAMES;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.pushParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - speed,
        life,
        maxLife: life,
        kind,
      });
    }
  }

  private pushParticle(particle: Particle): void {
    if (this.particles.length >= MAX_LAB_PARTICLES) this.particles.shift();
    this.particles.push(particle);
  }

  private advanceParticles(): void {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind !== 'haze') p.vy += PARTICLE_GRAVITY;
      p.life--;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }
  }

  /** How many ambient particles are alive, for the cap gate. */
  get liveParticleCount(): number {
    return this.particles.length;
  }

  // ── Webs ───────────────────────────────────────────────────────────────────

  /** The map tile at a lab position, or null off the map. */
  private tileAt(tile: { x: number; y: number }): TileContent | null {
    const { structure } = this.gameMap;
    if (tile.y < 0 || tile.y >= structure.length) return null;
    const row = structure[tile.y];
    return tile.x >= 0 && tile.x < row.length ? row[tile.x] : null;
  }

  private tileOf(key: number): { x: number; y: number } {
    return { x: tileKeyX(key), y: tileKeyY(key) };
  }

  private isCleared(key: number): boolean {
    const tile = this.tileOf(key);
    return this.tileAt(tile)?.type !== LAB_WEB;
  }

  private setWebbed(key: number, webbed: boolean): void {
    const tile = this.tileOf(key);
    const content = this.tileAt(tile);
    if (content === null) return;
    const isWebbed = content.type === LAB_WEB;
    if (isWebbed === webbed) return;
    if (webbed) {
      placeProp(content, LAB_WEB);
      this.plan.tornWebTiles.delete(key);
    } else {
      content.type = content.groundType ?? SPIDER_LAB_FLOOR;
      this.plan.tornWebTiles.add(key);
    }
    // A web tile's strands run to its web neighbours, so every neighbour's
    // picture changes with it — and a neighbour may sit in another chunk.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) this.gameMap.markTileDirty(tile.x + dx, tile.y + dy);
    }
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  captureCheckpoint(): SpiderLabDressingCheckpoint {
    return {
      clearedWebs: [...this.originalWebs].filter((key) => this.isCleared(key)),
      cocoons: this.cocoons.map((cocoon) => ({ hp: cocoon.hp, state: cocoon.state })),
      lightPhase: this.lightPhase,
      lightsRestored: this.lightsRestored,
      brokenBenches: this.benchKeys.filter((key) => {
        const tile = this.tileOf(key);
        const stage = this.tileAt(tile)?.damageStage;
        return (stage ?? PROP_DAMAGE_STAGE_INTACT) !== PROP_DAMAGE_STAGE_INTACT;
      }),
    };
  }

  restoreCheckpoint(snapshot: SpiderLabDressingCheckpoint): void {
    const cleared = new Set(snapshot.clearedWebs);
    for (const key of this.originalWebs) this.setWebbed(key, !cleared.has(key));
    this.regrowing.clear();
    this.cocoons.forEach((cocoon, i) => {
      // A cocoon caught mid-split has no clock to resume on: it is put back whole.
      const savedState: CocoonState =
        i < snapshot.cocoons.length ? snapshot.cocoons[i].state : 'intact';
      const state = savedState === 'hatching' ? 'intact' : savedState;
      cocoon.state = state;
      cocoon.hp = state === 'intact' ? COCOON_HP : 0;
      cocoon.hatchFramesLeft = 0;
    });
    this.lightPhase = snapshot.lightPhase;
    this.lightsRestored = snapshot.lightsRestored;
    this.lightChangeFrames = LIGHTS_RESTORE_FRAMES;
    const broken = new Set(snapshot.brokenBenches);
    for (const key of this.benchKeys) {
      const tile = this.tileOf(key);
      const content = this.tileAt(tile);
      if (content?.type !== LAB_BENCH) continue;
      const stage = broken.has(key) ? PROP_DAMAGE_STAGE_CRACKED : PROP_DAMAGE_STAGE_INTACT;
      if ((content.damageStage ?? PROP_DAMAGE_STAGE_INTACT) === stage) continue;
      content.damageStage = stage;
      this.gameMap.markTileDirty(tile.x, tile.y);
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  override renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.isInView(camX, camY)) return;
    let spinning = 0;
    for (const [key, framesLeft] of this.regrowing) {
      if (spinning >= MAX_WEBS_REGROWING) break;
      spinning++;
      const tile = this.tileOf(key);
      const progress = 1 - framesLeft / WEB_REGROW_FRAMES;
      const frame = Math.min(WEB_GROWTH_TOTAL - 1, Math.floor(progress * WEB_GROWTH_TOTAL));
      drawSpriteKey(
        ctx,
        'spider_lab_web_growth',
        'grow',
        frame,
        tile.x * TILE_SIZE - camX,
        tile.y * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }
  }

  override renderEntities(): ReadonlyArray<DressingRenderable> {
    this.renderables.length = 0;
    this.renderables.push(this.eggSacRenderable);
    for (const cocoon of this.cocoons) this.renderables.push(cocoon.renderable);
    if (this.quest !== null)
      for (const person of this.quest.people()) this.renderables.push(person);
    return this.renderables;
  }

  private drawCocoon(
    ctx: CanvasRenderingContext2D,
    cocoon: Cocoon,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = cocoon.tileX * tileSize - camX;
    const sy = cocoon.tileY * tileSize - camY;
    if (cocoon.state === 'burst') {
      drawSpriteKey(ctx, 'spider_lab_cocoon', 'burst', 0, sx, sy, tileSize);
      return;
    }
    if (cocoon.state === 'hatching') {
      const progress = 1 - cocoon.hatchFramesLeft / EGG_HATCH_FRAMES;
      const frame = Math.min(COCOON_HATCH_FRAMES - 1, Math.floor(progress * COCOON_HATCH_FRAMES));
      drawSpriteKey(ctx, 'spider_lab_cocoon', 'hatching', frame, sx, sy, tileSize);
      return;
    }
    drawSpriteKey(ctx, 'spider_lab_cocoon', 'idle', this.twitchFrame(cocoon), sx, sy, tileSize);
  }

  /** Which idle pose a cocoon hangs in: still, mostly, with a twitch on a beat its hash picks. */
  private twitchFrame(cocoon: Cocoon): number {
    const beat = Math.floor(this.clock / TWITCH_BEAT_FRAMES);
    const roll = positionHash(cocoon.tileX + beat, cocoon.tileY) % TWITCH_ODDS;
    if (roll !== 0) return 0;
    return 1 + (beat % (COCOON_IDLE_FRAMES - 1));
  }

  override renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.isInView(camX, camY)) return;
    for (const p of this.particles) {
      if (p.kind !== 'haze') continue;
      const age = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.sin(age * Math.PI);
      drawRadialGlow(
        ctx,
        p.x - camX,
        p.y - camY,
        HAZE_RADIUS_PX * (1 + age * HAZE_GROWTH),
        HAZE_STOPS,
      );
    }
    ctx.globalAlpha = 1;
  }

  /** How dark the room is this frame, 0 to 1 of the current phase's mask. */
  private darknessLevel(): number {
    if (this.lightsRestored) return Math.max(0, 1 - this.lightChangeFrames / LIGHTS_RESTORE_FRAMES);
    if (this.lightPhase === 1) return 0;
    return 1;
  }

  /** Whether any darkness is on the room this frame. */
  get isDark(): boolean {
    return this.darknessLevel() > 0 && this.lightPhase > 1;
  }

  private maskFor(phase: LabLightPhase): CanvasSurface {
    const cached = this.masks.get(phase);
    if (cached !== undefined) return cached;
    const mask = bakeDarknessMask(this.room, this.banks, phase);
    this.masks.set(phase, mask);
    return mask;
  }

  /** The masks painted so far, for the memory gate. */
  get bakedMaskCount(): number {
    return this.masks.size;
  }

  /**
   * The darkness: the current phase's mask blitted over the room, fading in
   * from the last phase's, then the ceiling banks — lit, flickering or blown —
   * and their falling sparks. Drawn over the bodies and under everything that
   * warns of danger, which the quest draws straight after this.
   */
  /** Screen rectangles the ceiling banks cover, for a warning that must be drawn back over them. */
  bankScreenRects(
    camX: number,
    camY: number,
  ): Array<{ x: number; y: number; w: number; h: number }> {
    return this.banks.map((bank) => ({
      x: bank.x - (LIGHT_BANK_TILES / 2) * TILE_SIZE - camX,
      y: bank.y - BANK_HANG_TILES * TILE_SIZE - camY,
      w: LIGHT_BANK_TILES * TILE_SIZE,
      h: TILE_SIZE,
    }));
  }

  /** Whether any of the lab is within a couple of tiles of the view: nothing of it is drawn otherwise. */
  isInView(camX: number, camY: number): boolean {
    const b = darknessBounds(this.room);
    const margin = VIEW_MARGIN_TILES * TILE_SIZE;
    return (
      (b.x + b.w) * TILE_SIZE >= camX - margin &&
      b.x * TILE_SIZE <= camX + viewportWidth() + margin &&
      (b.y + b.h) * TILE_SIZE >= camY - margin &&
      b.y * TILE_SIZE <= camY + viewportHeight() + margin
    );
  }

  /**
   * Blits the part of a mask the view can see, and only that: the mask covers
   * the whole room and its walls, and stretching all of it is most of a
   * frame's budget on a CPU canvas for pixels that land off screen. The source
   * rectangle is snapped to whole mask pixels so the stretch stays an exact
   * integer factor, and kept inside the mask's clear pad. Alpha is only
   * touched while the dark is fading; the mask's own alpha is the steady
   * darkness.
   */
  private blitMask(
    ctx: CanvasRenderingContext2D,
    mask: CanvasSurface,
    camX: number,
    camY: number,
    alpha: number,
  ): void {
    const bounds = darknessBounds(this.room);
    const worldPerMaskPx = 1 / DARKNESS_MASK_SCALE;
    // Where mask pixel 0 would fall in the world: the room's corner, less the pad.
    const originX = bounds.x * TILE_SIZE - DARKNESS_MASK_PAD_PX * worldPerMaskPx;
    const originY = bounds.y * TILE_SIZE - DARKNESS_MASK_PAD_PX * worldPerMaskPx;
    const pad = DARKNESS_MASK_PAD_PX;
    const left = Math.max(pad, Math.floor((camX - originX) / worldPerMaskPx));
    const top = Math.max(pad, Math.floor((camY - originY) / worldPerMaskPx));
    const right = Math.min(
      mask.width - pad,
      Math.ceil((camX + viewportWidth() - originX) / worldPerMaskPx),
    );
    const bottom = Math.min(
      mask.height - pad,
      Math.ceil((camY + viewportHeight() - originY) / worldPerMaskPx),
    );
    if (right <= left || bottom <= top) return;
    const fading = alpha < 1;
    if (fading) ctx.globalAlpha = alpha;
    ctx.drawImage(
      mask,
      left,
      top,
      right - left,
      bottom - top,
      originX + left * worldPerMaskPx - camX,
      originY + top * worldPerMaskPx - camY,
      (right - left) * worldPerMaskPx,
      (bottom - top) * worldPerMaskPx,
    );
    if (fading) ctx.globalAlpha = 1;
  }

  /** The dark over the room: the current phase's mask, fading in from the last phase's. */
  renderDarkness(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const level = this.darknessLevel();
    if (this.lightPhase > 1 && level > 0) {
      const blit = (phase: LabLightPhase, alpha: number): void => {
        if (phase === 1 || alpha <= 0) return;
        this.blitMask(ctx, this.maskFor(phase), camX, camY, alpha);
      };
      const fade = Math.min(1, this.lightChangeFrames / DARKNESS_FADE_FRAMES);
      if (this.lightsRestored || fade >= 1) {
        blit(this.lightPhase, level);
      } else {
        const previous: LabLightPhase = this.lightPhase === LAST_LIGHT_PHASE ? FIRST_DARK_PHASE : 1;
        blit(previous, 1 - fade);
        blit(this.lightPhase, fade);
      }
      this.renderWebGlimmer(ctx, camX, camY, level);
    }
  }

  /**
   * Silk catches what light there is: each tile still webbed is lifted out of
   * the dark, so slow ground stays readable in it. Drawn from the live web
   * every frame rather than baked into the mask, because the web is cut and
   * regrown after the mask is painted.
   */
  private renderWebGlimmer(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    level: number,
  ): void {
    ctx.fillStyle = WEB_GLIMMER_COLOR;
    ctx.globalAlpha = level;
    const minX = Math.floor(camX / TILE_SIZE) - 1;
    const minY = Math.floor(camY / TILE_SIZE) - 1;
    const maxX = Math.ceil((camX + viewportWidth()) / TILE_SIZE) + 1;
    const maxY = Math.ceil((camY + viewportHeight()) / TILE_SIZE) + 1;
    for (const key of this.originalWebs) {
      const tile = this.tileOf(key);
      if (tile.x < minX || tile.x > maxX || tile.y < minY || tile.y > maxY) continue;
      if (this.isCleared(key)) continue;
      ctx.fillRect(tile.x * TILE_SIZE - camX, tile.y * TILE_SIZE - camY, TILE_SIZE, TILE_SIZE);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The ceiling: the light banks — lit, flickering or blown — and the sparks
   * and glass falling from them. Hung above every body, so drawn after the
   * entity pass; the quest draws her warnings back over it.
   */
  renderCeiling(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const [i, bank] of this.banks.entries()) {
      const lit = bankLitIn(bank, this.lightPhase) || this.lightsRestored;
      const look = lit ? this.flickerLook(i) : 'dead';
      drawSpriteKey(
        ctx,
        'spider_lab_light_bank',
        look,
        0,
        bank.x - (LIGHT_BANK_TILES / 2) * TILE_SIZE - camX,
        bank.y - BANK_HANG_TILES * TILE_SIZE - camY,
        TILE_SIZE,
      );
    }
    for (const p of this.particles) {
      if (p.kind === 'haze') continue;
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.kind === 'spark' ? SPARK_COLOR : SHARD_COLOR;
      ctx.fillRect(p.x - camX, p.y - camY, PARTICLE_SIZE_PX, PARTICLE_SIZE_PX);
    }
    ctx.globalAlpha = 1;
  }

  /** A lit bank's tube this frame: steady, with a short stutter on its own hash-picked beat. */
  private flickerLook(bankIndex: number): 'lit' | 'dim' | 'off' {
    const offset = positionHash(bankIndex, FLICKER_PERIOD_FRAMES) % FLICKER_PERIOD_FRAMES;
    const inCycle = (this.clock + offset) % FLICKER_PERIOD_FRAMES;
    if (inCycle >= FLICKER_RUN_FRAMES) return 'lit';
    const beat = Math.floor(inCycle / FLICKER_BEAT_FRAMES);
    return beat % 2 === 0 ? 'dim' : 'off';
  }

  /**
   * A two-pixel glint of eye-shine on each threat, drawn over the dark so a
   * spider can be found in it by its eyes.
   */
  renderEyeShine(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    spider: GrotesqueSpider | null,
    hatchlings: ReadonlyArray<{
      x: number;
      y: number;
      facingX: number;
      facingY: number;
      isAlive: boolean;
    }>,
  ): void {
    if (!this.isDark) return;
    ctx.fillStyle = EYE_COLOR;
    const glint = (
      cx: number,
      cy: number,
      facingX: number,
      facingY: number,
      forward: number,
      pairs: number,
    ): void => {
      const ex = cx + facingX * forward * TILE_SIZE;
      const ey = cy + facingY * forward * TILE_SIZE;
      for (let i = 0; i < pairs; i++) {
        const spread = (i + HALF) * EYE_SPACING_PX;
        ctx.fillRect(
          ex - facingY * spread - camX,
          ey + facingX * spread - camY,
          EYE_GLINT_PX,
          EYE_GLINT_PX,
        );
        ctx.fillRect(
          ex + facingY * spread - camX,
          ey - facingX * spread - camY,
          EYE_GLINT_PX,
          EYE_GLINT_PX,
        );
      }
    };
    if (spider?.isAlive === true) {
      glint(
        spider.x + TILE_SIZE * TILE_CENTRE,
        spider.y + TILE_SIZE * TILE_CENTRE,
        spider.facingX,
        spider.facingY,
        SPIDER_EYE_FORWARD_TILES,
        SPIDER_EYE_PAIRS,
      );
    }
    for (const hatchling of hatchlings) {
      if (!hatchling.isAlive) continue;
      glint(
        hatchling.x + TILE_SIZE * TILE_CENTRE,
        hatchling.y + TILE_SIZE * TILE_CENTRE,
        hatchling.facingX,
        hatchling.facingY,
        HATCHLING_EYE_FORWARD_TILES,
        1,
      );
    }
  }
}
const SPIDER_EYE_PAIRS = 2;
