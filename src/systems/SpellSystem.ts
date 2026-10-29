import { TILE_SIZE } from '../core/constants';
import { outgoingHitDamageOn } from '../core/combat/outgoingHit';
import { MAGIC_HIT } from '../core/combat/damageTags';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import { DAMAGE_IMMUNE_LABEL, type Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import { getEnergyShieldStats, type EnergyShieldStats } from '../abilities/energyShield';
import { normalize } from '../utils';
import { worldPalette } from '../ui/theme/worldInk';
import { worldText } from '../ui/world/worldText';
import { progressFrameIndex, timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import {
  drawFigureCached,
  prewarmFigureState,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../sprites/figure/figureFrameCache';
import { figureFrameCount } from '../sprites/figure/figureDef';
import {
  MINI_SHIELD_STATE,
  ENERGY_SHIELD_FIGURE,
  ENERGY_SHIELD_MINI_FIGURE,
  ENERGY_SHIELD_SHOCKWAVE_FIGURE,
  SHIELD_ACTIVE_STATE,
  SHIELD_APPEAR_FULL_POWER_STATE,
  SHIELD_APPEAR_STATE,
  SHIELD_EXPIRE_STATE,
  SHIELD_FULL_POWER_STATE,
  SHOCKWAVE_STATE,
  shieldTileSizeFor,
} from '../sprites/art/energyShieldFigure';
import { worldViewWidth, worldViewHeight } from '../core/rendering/Viewport';
import { standByForShieldCast } from '../creatures/humanGestures';
import { energyShieldMagicScale } from '../core/party/crawlerFormulas';
import type { DynamicLightSink } from './lighting/dynamicLights';
import {
  drawEntanglementRoots,
  ENTANGLE_ROOTS_CRUMBLE_FRAMES,
} from '../sprites/art/entanglementRootsArt';

interface ActiveEnergyShield {
  x: number;
  y: number;
  radiusPx: number;
  framesRemaining: number;
  totalFrames: number;
  didInitialDamage: boolean;
  abilityLevel: number;
  /** What the caster's magic multiplied this cast's duration and expanding blast by. */
  magicScale: number;
  catWasInside: boolean;
  continuousDamageThrottle: number;
  /** Mobs pushed at least once this cast (for touch-XP tracking). */
  touchedMobIds: Set<Mob>;
}

interface MiniShield {
  /** Center x in world pixels (follows cat). */
  framesRemaining: number; // 180 frames = 3 seconds
  radiusPx: number;
}

interface ChainLightningBolt {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  framesLeft: number;
}

interface ShockwaveRipple {
  x: number;
  y: number;
  maxRadius: number;
  currentRadius: number;
  framesLeft: number;
  totalFrames: number;
}

/**
 * One mob held by a Scroll of Entanglement's roots. The hold itself is the
 * root's source, so a later, longer root from anything else is seen as the
 * end of this one.
 */
interface EntanglementHold {
  readonly mob: Mob;
  /** Stable for the hold, so its roots grow their own way and keep it. */
  readonly seed: number;
  heldFrames: number;
  /** Frames since the roots let go; null while they still hold. */
  crumbleFrames: number | null;
}

const TILE_CENTER_OFFSET = 0.5;
const GAME_FRAMES_PER_SECOND = 60;
const SHIELD_COOLDOWN_FRAMES = 7200;
const CHAIN_LIGHTNING_FRAMES = 20;
const INITIAL_SHOCKWAVE_FRAMES = 40;
/** How far from the reader a Scroll of Entanglement's roots burst up, in tiles. */
const ENTANGLE_RADIUS_TILES = 4;
const ENTANGLE_RADIUS_PX = ENTANGLE_RADIUS_TILES * TILE_SIZE;
/** How long the roots hold each mob they catch: five seconds. */
const ENTANGLE_ROOT_FRAMES = 300;
/** Spreads consecutive holds' seeds so no two mobs' roots grow alike. */
const ENTANGLE_SEED_STRIDE = 7919;
const MINI_SHIELD_FRAMES = 180;
const MINI_SHIELD_TILES = 1.5;
const CONTINUOUS_DAMAGE_THROTTLE_FRAMES = 60;
/** What each throttled pulse of the shield's edge does to an enemy pressed against it. */
const SHIELD_EDGE_DAMAGE = 1;
const SHIELD_BUFFER_TILES = 1;
const SHIELD_OUTER_BUFFER_BASE = 4;
const SHIELD_EXPAND_BUFFER = 2;
const SHOCKWAVE_FADE_IN_FRAMES = 30;
const SHIELD_FADE_OUT_FRAMES = 60;
const SHIELD_APPEAR_FRAMES = 30;
const MINI_SHIELD_FADE_OUT_FRAMES = 30;
/**
 * How far ahead of the fade the expiry rows are warmed.
 *
 * The cast itself warms them too, but the figure cache releases a row that has
 * gone `IDLE_FRAMES_BEFORE_RELEASE` rendered frames without being drawn, and a
 * high-level shield outlasts that — so a shield that has run its whole duration
 * would meet the fade cold.
 *
 * Clamped to that window rather than merely written to sit under it: a lead
 * longer than the window is warming the cache sweeps away again before the fade
 * ever plays it, so the two numbers cannot be allowed to drift apart silently.
 */
const SHIELD_EXPIRY_PREWARM_LEAD_TARGET_FRAMES = 120;
const SHIELD_EXPIRY_PREWARM_LEAD_FRAMES = Math.min(
  SHIELD_EXPIRY_PREWARM_LEAD_TARGET_FRAMES,
  IDLE_FRAMES_BEFORE_RELEASE,
);
const MINI_SHIELD_ALPHA_MULT = 0.7;
const CHAIN_LIGHTNING_STEPS = 5;
const CHAIN_LIGHTNING_JITTER_RANGE = 8;
const CHAIN_LIGHTNING_ALPHA_FULL = 0.9;
const CHAIN_LIGHTNING_CORE_ALPHA = 0.5;
const CHAIN_LIGHTNING_CORE_WIDTH = 1;
const CHAIN_LIGHTNING_WIDTH = 2;
const SHOCKWAVE_ALPHA_MULT = 0.7;
const TIMER_ALPHA_MULT = 0.8;
const TIMER_TEXT_SIZE = 10;
const TIMER_Y_OFFSET = 14;
const SHIELD_RENDER_EXTENT = 25;
const FULL_POWER_LEVEL = 15;

export class SpellSystem implements GameSystem {
  private activeEnergyShield: ActiveEnergyShield | null = null;
  private _energyShieldCooldown = 0;
  private _energyShieldCooldownMax = SHIELD_COOLDOWN_FRAMES;
  private entanglements: EntanglementHold[] = [];
  private entanglementsCast = 0;
  private shieldOwner: HumanPlayer | null = null;
  private catMiniShield: MiniShield | null = null;
  private chainLightningBolts: ChainLightningBolt[] = [];

  /** A chain-lightning arc lights the room at its middle as it crackles and fades. */
  collectLights(sink: DynamicLightSink): void {
    for (const bolt of this.chainLightningBolts) {
      sink.add(
        (bolt.fromX + bolt.toX) / 2,
        (bolt.fromY + bolt.toY) / 2,
        'lightning',
        bolt.framesLeft / CHAIN_LIGHTNING_FRAMES,
      );
    }
  }
  private shockwaveRipples: ShockwaveRipple[] = [];

  /** Touch XP pending drain by DungeonScene (1 per unique mob pushed). */
  private _pendingTouchXp = 0;

  /** Block XP pending drain — incremented each time the shield deflects a projectile or tongue. */
  private _pendingBlockXp = 0;

  /** Pending shockwave event for level-15 shield expiry. */
  private _pendingShockwave: { x: number; y: number; radiusPx: number } | null = null;

  /** Pending chain lightning origin points (mob died inside shield). */
  private _pendingChainLightningOrigins: Array<{ x: number; y: number }> = [];

  /** Reusable Set to avoid allocating per queryCircle call each frame. */
  private readonly _querySet = new Set<Mob>();

  /**
   * Drops every active spell effect and pending cross-frame event. Used on a
   * checkpoint respawn so a shield, roots, or an in-flight bolt from the encounter
   * that killed the player doesn't carry into the new frame.
   */
  resetForCheckpoint(): void {
    this.dropWorldEffects();
    this._energyShieldCooldown = 0;
  }

  /**
   * Clears everything this system has standing in the world, and nothing the
   * party has *spent*.
   *
   * Separate from {@link resetForCheckpoint} because leaving a room is not the
   * same as rewinding time: a shield has to stop existing when the map it was
   * cast on stops being drawn, but refunding its cooldown would let a player
   * re-cast it by stepping through a door and back.
   */
  dropWorldEffects(): void {
    this.activeEnergyShield = null;
    // A rewound or abandoned mob must not stay held by roots that are no
    // longer drawn.
    for (const hold of this.entanglements) hold.mob.releaseRoot(hold);
    this.entanglements = [];
    this.shieldOwner = null;
    this.catMiniShield = null;
    this.chainLightningBolts = [];
    this.shockwaveRipples = [];
    this._pendingTouchXp = 0;
    this._pendingBlockXp = 0;
    this._pendingShockwave = null;
    this._pendingChainLightningOrigins = [];
  }

  get energyShieldCooldown(): number {
    return this._energyShieldCooldown;
  }

  get energyShieldCooldownMax(): number {
    return this._energyShieldCooldownMax;
  }

  get activeEnergyShieldLevel(): number {
    return this.activeEnergyShield?.abilityLevel ?? 0;
  }

  /** Returns true if the tile-top-left point (px, py) is inside the active shield. */
  isInsideEnergyShield(px: number, py: number): boolean {
    if (!this.activeEnergyShield) return false;
    const { x, y, radiusPx } = this.activeEnergyShield;
    const cx = px + TILE_SIZE * TILE_CENTER_OFFSET;
    const cy = py + TILE_SIZE * TILE_CENTER_OFFSET;
    return Math.hypot(cx - x, cy - y) < radiusPx;
  }

  drainTouchXp(): number {
    const v = this._pendingTouchXp;
    this._pendingTouchXp = 0;
    return v;
  }

  /** True if the given center point (world pixels) is inside the active shield. */
  isPointInsideEnergyShield(cx: number, cy: number): boolean {
    if (!this.activeEnergyShield) return false;
    return (
      Math.hypot(cx - this.activeEnergyShield.x, cy - this.activeEnergyShield.y) <
      this.activeEnergyShield.radiusPx
    );
  }

  /** Called by mobs when the shield deflects one of their attacks. */
  addBlockXp(amount: number): void {
    this._pendingBlockXp += amount;
  }

  drainBlockXp(): number {
    const v = this._pendingBlockXp;
    this._pendingBlockXp = 0;
    return v;
  }

  drainPendingShockwave(): { x: number; y: number; radiusPx: number } | null {
    const v = this._pendingShockwave;
    this._pendingShockwave = null;
    return v;
  }

  drainChainLightningOrigins(): Array<{ x: number; y: number }> {
    const v = this._pendingChainLightningOrigins;
    this._pendingChainLightningOrigins = [];
    return v;
  }

  /** Queue a chain lightning origin (called from DungeonScene when a mob dies inside the shield). */
  addChainLightningOrigin(x: number, y: number): void {
    this._pendingChainLightningOrigins.push({ x, y });
  }

  /** Add a visual bolt for the chain lightning effect. */
  addChainLightningBolt(fromX: number, fromY: number, toX: number, toY: number): void {
    this.chainLightningBolts.push({ fromX, fromY, toX, toY, framesLeft: CHAIN_LIGHTNING_FRAMES });
  }

  /**
   * Warms every row the cast about to happen will draw.
   *
   * The shield is the one figure here that paints past the fallback threshold —
   * a 400×400 cell of stacked haloes — and a cast is a keypress with no
   * telegraph of its own, so the cast is the earliest moment that knows.
   */
  private prewarmShieldCast(stats: EnergyShieldStats): void {
    prewarmFigureState(
      ENERGY_SHIELD_FIGURE,
      stats.isFullPower ? SHIELD_APPEAR_FULL_POWER_STATE : SHIELD_APPEAR_STATE,
    );
    prewarmFigureState(
      ENERGY_SHIELD_FIGURE,
      stats.isFullPower ? SHIELD_FULL_POWER_STATE : SHIELD_ACTIVE_STATE,
    );
    if (stats.miniShieldEnabled) {
      prewarmFigureState(ENERGY_SHIELD_MINI_FIGURE, MINI_SHIELD_STATE);
    }
    this.prewarmShieldExpiry(stats.isFullPower);
  }

  private prewarmShieldExpiry(isFullPower: boolean): void {
    prewarmFigureState(ENERGY_SHIELD_FIGURE, SHIELD_EXPIRE_STATE);
    if (isFullPower) prewarmFigureState(ENERGY_SHIELD_SHOCKWAVE_FIGURE, SHOCKWAVE_STATE);
  }

  /** Add an expanding shockwave ring for visual effect. */
  addShockwaveRipple(x: number, y: number, radiusPx: number): void {
    this.shockwaveRipples.push({
      x,
      y,
      maxRadius: radiusPx + TILE_SIZE * SHIELD_BUFFER_TILES,
      currentRadius: radiusPx * TILE_CENTER_OFFSET,
      framesLeft: INITIAL_SHOCKWAVE_FRAMES,
      totalFrames: INITIAL_SHOCKWAVE_FRAMES,
    });
  }

  /**
   * Attempt to activate the energy shield.
   * @returns true if the shield was successfully triggered (i.e. not on cooldown).
   */
  triggerEnergyShield(
    human: HumanPlayer,
    cat: CatPlayer,
    mobGrid: SpatialGrid<Mob>,
    abilityLevel: number,
  ): boolean {
    if (this._energyShieldCooldown > 0 || !human.canAct) return false;

    const stats = getEnergyShieldStats(abilityLevel);
    const magicScale = energyShieldMagicScale(human.magic);
    const durationFrames = Math.round(stats.durationFrames * magicScale);
    const radiusPx = stats.radiusTiles * TILE_SIZE;
    const shieldX = human.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const shieldY = human.y + TILE_SIZE * TILE_CENTER_OFFSET;

    this.activeEnergyShield = {
      x: shieldX,
      y: shieldY,
      radiusPx,
      framesRemaining: durationFrames,
      totalFrames: durationFrames,
      didInitialDamage: false,
      abilityLevel,
      magicScale,
      catWasInside: false,
      continuousDamageThrottle: 0,
      touchedMobIds: new Set<Mob>(),
    };

    this.prewarmShieldCast(stats);
    this._energyShieldCooldown = stats.cooldownFrames;
    this._energyShieldCooldownMax = stats.cooldownFrames;
    this.shieldOwner = human;

    // Level 15: instant ally heal + clear status effects
    if (stats.isFullPower) {
      human.hp = human.maxHp;
      human.clearStatusEffects();
      cat.hp = cat.maxHp;
      cat.clearStatusEffects();
    }

    const shield = this.activeEnergyShield;
    const catDist = Math.hypot(
      cat.x + TILE_SIZE * TILE_CENTER_OFFSET - shieldX,
      cat.y + TILE_SIZE * TILE_CENTER_OFFSET - shieldY,
    );
    shield.catWasInside = catDist < radiusPx;

    this.pushMobsFromEnergyShield(mobGrid, stats);

    return true;
  }

  /**
   * Reads a Scroll of Entanglement: roots burst up round `caster` and hold
   * every enemy in reach for {@link ENTANGLE_ROOT_FRAMES}. A boss is too strong
   * to hold and is passed over without a word, the way the brambles pass it
   * over; a flier is out of the roots' reach and says so.
   */
  castEntanglement(caster: HumanPlayer | CatPlayer, mobGrid: SpatialGrid<Mob>): void {
    if (!caster.canAct) return;
    if (!caster.inventory.removeOne('scroll_of_entanglement')) return;
    const cx = caster.x + TILE_SIZE * TILE_CENTER_OFFSET;
    const cy = caster.y + TILE_SIZE * TILE_CENTER_OFFSET;
    this._querySet.clear();
    // The extra tile is the grid's: it keys mobs by their top-left corner
    // while the reach below is measured centre to centre.
    const nearby = mobGrid.queryCircle(cx, cy, ENTANGLE_RADIUS_PX + TILE_SIZE, this._querySet);
    for (const mob of nearby) {
      if (!mob.isHostileTarget || mob.isBoss || mob.wardedFromParty) continue;
      const dx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET - cx;
      const dy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET - cy;
      if (Math.hypot(dx, dy) > ENTANGLE_RADIUS_PX) continue;
      if (mob.isFlying) {
        mob.queueFloatingText(DAMAGE_IMMUNE_LABEL, 'immune');
        continue;
      }
      this.entanglementsCast++;
      const hold: EntanglementHold = {
        mob,
        seed: this.entanglementsCast * ENTANGLE_SEED_STRIDE,
        heldFrames: 0,
        crumbleFrames: null,
      };
      mob.root(ENTANGLE_ROOT_FRAMES, hold);
      this.entanglements.push(hold);
    }
  }

  /**
   * Ages every hold. A hold whose mob is no longer held by it — the time ran
   * out, the mob died, or something rooted it for longer — starts to crumble,
   * and is forgotten once the roots have fallen apart.
   */
  private updateEntanglements(): void {
    for (const hold of this.entanglements) {
      hold.heldFrames++;
      if (hold.crumbleFrames !== null) {
        hold.crumbleFrames++;
        continue;
      }
      const stillHeld = hold.mob.isAlive && hold.mob.rootedBy === hold;
      if (!stillHeld) hold.crumbleFrames = 0;
    }
    this.entanglements = this.entanglements.filter(
      (hold) => hold.crumbleFrames === null || hold.crumbleFrames < ENTANGLE_ROOTS_CRUMBLE_FRAMES,
    );
  }

  /** The roots round every held mob, and those still breaking apart, drawn over the mobs. */
  renderEntanglements(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const hold of this.entanglements) {
      drawEntanglementRoots(ctx, {
        x: hold.mob.x + TILE_SIZE * TILE_CENTER_OFFSET - camX,
        y: hold.mob.y + TILE_SIZE * TILE_CENTER_OFFSET - camY,
        tileSize: TILE_SIZE,
        heldFrames: hold.heldFrames,
        crumbleFrames: hold.crumbleFrames,
        seed: hold.seed,
      });
    }
  }

  /** Called every gameplay frame. Ticks cooldowns, pushes shield mobs, ages the roots. */
  update(ctx: SystemContext): void {
    const { cat, human } = ctx;
    const mobGrid = ctx.roster.grid;

    this._energyShieldCooldown = human.tickCooldown(this._energyShieldCooldown);
    standByForShieldCast(human, this._energyShieldCooldown === 0);

    if (this.activeEnergyShield) {
      // Clear heal boost from previous frame; re-applied below if ally is still inside
      cat.clearRegenModifier('energy_shield');
      human.clearRegenModifier('energy_shield');

      const shield = this.activeEnergyShield;
      const stats = getEnergyShieldStats(shield.abilityLevel);

      shield.framesRemaining--;

      // Push mobs outward every frame
      this.pushMobsFromEnergyShield(mobGrid, stats);

      const catCx = cat.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const catCy = cat.y + TILE_SIZE * TILE_CENTER_OFFSET;
      const catDist = Math.hypot(catCx - shield.x, catCy - shield.y);
      const catIsInside = catDist < shield.radiusPx;
      const humanDist = Math.hypot(
        human.x + TILE_SIZE * TILE_CENTER_OFFSET - shield.x,
        human.y + TILE_SIZE * TILE_CENTER_OFFSET - shield.y,
      );
      const humanIsInside = humanDist < shield.radiusPx;

      if (stats.allyHealingMultiplier > 1) {
        if (catIsInside) cat.setRegenModifier('energy_shield', stats.allyHealingMultiplier);
        if (humanIsInside) human.setRegenModifier('energy_shield', stats.allyHealingMultiplier);
      }

      if (stats.miniShieldEnabled) {
        if (shield.catWasInside && !catIsInside) {
          this.catMiniShield = {
            framesRemaining: MINI_SHIELD_FRAMES,
            radiusPx: TILE_SIZE * MINI_SHIELD_TILES,
          };
        }
        shield.catWasInside = catIsInside;
      }

      // Level 14+: continuous boundary damage (every 60 frames)
      if (stats.continuousDamageEnabled) {
        shield.continuousDamageThrottle++;
        if (shield.continuousDamageThrottle >= CONTINUOUS_DAMAGE_THROTTLE_FRAMES) {
          shield.continuousDamageThrottle = 0;
          this._querySet.clear();
          const boundaryMobs = mobGrid.queryCircle(
            shield.x,
            shield.y,
            shield.radiusPx + TILE_SIZE,
            this._querySet,
          );
          for (const mob of boundaryMobs) {
            if (!mob.isAlive || !mob.takesPlayerDamage('energy_shield')) continue;
            const dx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET - shield.x;
            const dy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET - shield.y;
            const dist = Math.hypot(dx, dy);
            // "On the boundary" = within 1 tile outside the shield edge
            if (dist >= shield.radiusPx && dist < shield.radiusPx + TILE_SIZE) {
              const owner = this.shieldOwner;
              const edge =
                owner === null
                  ? SHIELD_EDGE_DAMAGE
                  : outgoingHitDamageOn(owner, mob, SHIELD_EDGE_DAMAGE, MAGIC_HIT);
              mob.takeDamageFrom(edge, owner, 'energy_shield');
            }
          }
        }
      }

      // Level 15+: magic protection — continuously clear magic-type status effects from human
      if (stats.isFullPower) {
        human.statusEffects = human.statusEffects.filter(
          (e) => e.type !== 'magic_burn' && e.type !== 'electrified',
        );
      }

      const enteringExpiry =
        shield.framesRemaining <= SHIELD_EXPIRY_PREWARM_LEAD_FRAMES &&
        shield.framesRemaining + 1 > SHIELD_EXPIRY_PREWARM_LEAD_FRAMES;
      if (enteringExpiry) this.prewarmShieldExpiry(stats.isFullPower);

      if (shield.framesRemaining <= 0) {
        cat.clearRegenModifier('energy_shield');
        human.clearRegenModifier('energy_shield');
        if (stats.isFullPower) {
          this._pendingShockwave = { x: shield.x, y: shield.y, radiusPx: shield.radiusPx };
        }
        this.activeEnergyShield = null;
        this.shieldOwner = null;
      }
    }

    if (this.catMiniShield) {
      this.catMiniShield.framesRemaining--;

      const miniRadius = this.catMiniShield.radiusPx;
      this._querySet.clear();
      const catCx = cat.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const catCy = cat.y + TILE_SIZE * TILE_CENTER_OFFSET;
      const nearMobs = mobGrid.queryCircle(catCx, catCy, miniRadius + TILE_SIZE, this._querySet);
      for (const mob of nearMobs) {
        if (!mob.isAlive) continue;
        const mcx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET;
        const mcy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET;
        const dx = mcx - catCx;
        const dy = mcy - catCy;
        const dist = Math.hypot(dx, dy);
        if (dist < miniRadius) {
          const ox = mob.x;
          const oy = mob.y;
          const nx = dist > 0 ? dx / dist : 1;
          const ny = dist > 0 ? dy / dist : 0;
          const push = miniRadius - dist + SHIELD_EXPAND_BUFFER;
          mob.shoveTo(mob.x + nx * push, mob.y + ny * push);
          mobGrid.move(mob, ox, oy);
        }
      }

      if (this.catMiniShield.framesRemaining <= 0) {
        this.catMiniShield = null;
      }
    }

    // Tick chain lightning bolts (visual only) — iterate backwards to allow splice
    this.chainLightningBolts = this.chainLightningBolts.filter((bolt) => {
      bolt.framesLeft--;
      return bolt.framesLeft > 0;
    });

    // Tick shockwave ripples (visual only)
    this.shockwaveRipples = this.shockwaveRipples.filter((ripple) => {
      ripple.framesLeft--;
      ripple.currentRadius +=
        (ripple.maxRadius - ripple.currentRadius) / Math.max(1, ripple.framesLeft);
      return ripple.framesLeft > 0;
    });

    this.updateEntanglements();
  }

  private pushMobsFromEnergyShield(mobGrid: SpatialGrid<Mob>, stats: EnergyShieldStats): void {
    if (!this.activeEnergyShield) return;
    const shield = this.activeEnergyShield;
    const { x, y, radiusPx } = shield;

    this._querySet.clear();
    const nearShield = mobGrid.queryCircle(x, y, radiusPx + TILE_SIZE, this._querySet);
    for (const mob of nearShield) {
      if (!mob.isAlive) continue;
      const mcx = mob.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const mcy = mob.y + TILE_SIZE * TILE_CENTER_OFFSET;
      const dx = mcx - x;
      const dy = mcy - y;
      const dist = Math.hypot(dx, dy);
      if (dist < radiusPx) {
        const ox = mob.x;
        const oy = mob.y;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const push = radiusPx - dist + SHIELD_EXPAND_BUFFER;
        mob.shoveTo(mob.x + nx * push, mob.y + ny * push);

        // Expansion damage: only on the very first push frame (initial cast).
        // Allies are still shoved clear — the shield is a wall to everyone — but
        // it only wounds what it is allowed to wound.
        if (
          !shield.didInitialDamage &&
          stats.expandDamageEnabled &&
          mob.takesPlayerDamage('energy_shield')
        ) {
          const expandDamage = Math.round(stats.expandDamage * shield.magicScale);
          const owner = this.shieldOwner;
          const blast =
            owner === null
              ? expandDamage
              : outgoingHitDamageOn(owner, mob, expandDamage, MAGIC_HIT);
          mob.takeDamageFrom(blast, owner, 'energy_shield');
        }

        if (!shield.touchedMobIds.has(mob) && !mob.blowsEarnNothing) {
          shield.touchedMobIds.add(mob);
          this._pendingTouchXp++;
        }

        mobGrid.move(mob, ox, oy);
      } else if (dist < radiusPx + SHIELD_OUTER_BUFFER_BASE) {
        // Thin outer buffer: push mobs back so they can't re-enter from outside
        const ox = mob.x;
        const oy = mob.y;
        const nx = dist > 0 ? dx / dist : 1;
        const ny = dist > 0 ? dy / dist : 0;
        const outerPush = radiusPx + SHIELD_OUTER_BUFFER_BASE - dist;
        mob.shoveTo(mob.x + nx * outerPush, mob.y + ny * outerPush);
        mobGrid.move(mob, ox, oy);
      }
    }
    shield.didInitialDamage = true;
  }

  renderEnergyShield(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.activeEnergyShield) return;
    const { x, y, radiusPx, framesRemaining, totalFrames, abilityLevel } = this.activeEnergyShield;
    const sx = x - camX;
    const sy = y - camY;
    const isFullPower = abilityLevel >= FULL_POWER_LEVEL;

    // Offscreen culling
    const extent = radiusPx + SHIELD_RENDER_EXTENT;
    if (
      sx + extent < 0 ||
      sy + extent < 0 ||
      sx - extent > worldViewWidth() ||
      sy - extent > worldViewHeight()
    )
      return;

    const elapsed = (totalFrames - framesRemaining) / GAME_FRAMES_PER_SECOND;
    const fadeIn = Math.min(1, (totalFrames - framesRemaining) / SHOCKWAVE_FADE_IN_FRAMES);
    const fadeOut = Math.min(1, framesRemaining / SHIELD_FADE_OUT_FRAMES);
    const alpha = Math.min(fadeIn, fadeOut);

    const appearing = totalFrames - framesRemaining < SHIELD_APPEAR_FRAMES;
    const expiring = framesRemaining < SHIELD_FADE_OUT_FRAMES;

    let state: string;
    let frame: number;
    if (appearing) {
      state = isFullPower ? SHIELD_APPEAR_FULL_POWER_STATE : SHIELD_APPEAR_STATE;
      frame = progressFrameIndex(
        (totalFrames - framesRemaining) / SHIELD_APPEAR_FRAMES,
        figureFrameCount(ENERGY_SHIELD_FIGURE, state),
      );
    } else if (expiring) {
      state = SHIELD_EXPIRE_STATE;
      frame = progressFrameIndex(
        1 - framesRemaining / SHIELD_FADE_OUT_FRAMES,
        figureFrameCount(ENERGY_SHIELD_FIGURE, state),
      );
    } else {
      state = isFullPower ? SHIELD_FULL_POWER_STATE : SHIELD_ACTIVE_STATE;
      const cycleFrames = figureFrameCount(ENERGY_SHIELD_FIGURE, state);
      frame = timeFrameIndex(elapsed, cycleFrames, cycleFrames);
    }

    const tileSize = shieldTileSizeFor(ENERGY_SHIELD_FIGURE, radiusPx);
    drawFigureCached(ctx, ENERGY_SHIELD_FIGURE, state, frame, sx, sy, tileSize, { alpha });

    const secs = Math.ceil(framesRemaining / GAME_FRAMES_PER_SECOND);
    const timerColor = isFullPower
      ? worldPalette.spell.energyShieldTimerFull
      : worldPalette.spell.energyShieldTimer;
    worldText(ctx, `${secs}s`, {
      x: sx,
      y: sy - radiusPx - TIMER_Y_OFFSET,
      size: TIMER_TEXT_SIZE,
      bold: true,
      color: timerColor,
      alpha: alpha * TIMER_ALPHA_MULT,
      align: 'center',
    });
  }

  renderCatMiniShield(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    cat: CatPlayer,
  ): void {
    if (!this.catMiniShield) return;
    const { framesRemaining, radiusPx } = this.catMiniShield;
    const sx = cat.x + TILE_SIZE * TILE_CENTER_OFFSET - camX;
    const sy = cat.y + TILE_SIZE * TILE_CENTER_OFFSET - camY;

    const elapsed = (MINI_SHIELD_FRAMES - framesRemaining) / GAME_FRAMES_PER_SECOND;
    const fadeOut = Math.min(1, framesRemaining / MINI_SHIELD_FADE_OUT_FRAMES);
    const alpha = fadeOut * MINI_SHIELD_ALPHA_MULT;
    const cycleFrames = figureFrameCount(ENERGY_SHIELD_MINI_FIGURE, MINI_SHIELD_STATE);
    const frame = timeFrameIndex(elapsed, cycleFrames, cycleFrames);

    const tileSize = shieldTileSizeFor(ENERGY_SHIELD_MINI_FIGURE, radiusPx);
    drawFigureCached(ctx, ENERGY_SHIELD_MINI_FIGURE, MINI_SHIELD_STATE, frame, sx, sy, tileSize, {
      alpha,
    });
  }

  renderChainLightning(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.chainLightningBolts.length === 0) return;
    ctx.save();
    for (const bolt of this.chainLightningBolts) {
      const alpha = bolt.framesLeft / CHAIN_LIGHTNING_FRAMES;
      const fromSx = bolt.fromX - camX;
      const fromSy = bolt.fromY - camY;
      const toSx = bolt.toX - camX;
      const toSy = bolt.toY - camY;

      ctx.globalAlpha = alpha * CHAIN_LIGHTNING_ALPHA_FULL;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = CHAIN_LIGHTNING_WIDTH;
      ctx.beginPath();

      // Jittered midpoints simulate a non-linear lightning arc
      const { x: perpX, y: perpY } = normalize(-(toSy - fromSy), toSx - fromSx);
      ctx.moveTo(fromSx, fromSy);
      for (let i = 1; i < CHAIN_LIGHTNING_STEPS; i++) {
        const t = i / CHAIN_LIGHTNING_STEPS;
        const mx = fromSx + (toSx - fromSx) * t;
        const my = fromSy + (toSy - fromSy) * t;
        const jitter = (Math.random() - TILE_CENTER_OFFSET) * CHAIN_LIGHTNING_JITTER_RANGE;
        ctx.lineTo(mx + perpX * jitter, my + perpY * jitter);
      }
      ctx.lineTo(toSx, toSy);
      ctx.stroke();

      // White core
      ctx.globalAlpha = alpha * CHAIN_LIGHTNING_CORE_ALPHA;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = CHAIN_LIGHTNING_CORE_WIDTH;
      ctx.stroke();
    }
    ctx.restore();
  }

  renderShockwaveRipples(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.shockwaveRipples.length === 0) return;
    for (const ripple of this.shockwaveRipples) {
      if (ripple.currentRadius < 1) continue;
      const sx = ripple.x - camX;
      const sy = ripple.y - camY;
      const alpha = (ripple.framesLeft / ripple.totalFrames) * SHOCKWAVE_ALPHA_MULT;
      const progress = 1 - ripple.framesLeft / ripple.totalFrames;
      const frame = progressFrameIndex(
        progress,
        figureFrameCount(ENERGY_SHIELD_SHOCKWAVE_FIGURE, SHOCKWAVE_STATE),
      );

      const tileSize = shieldTileSizeFor(ENERGY_SHIELD_SHOCKWAVE_FIGURE, ripple.currentRadius);
      drawFigureCached(
        ctx,
        ENERGY_SHIELD_SHOCKWAVE_FIGURE,
        SHOCKWAVE_STATE,
        frame,
        sx,
        sy,
        tileSize,
        { alpha },
      );
    }
  }
}
