/**
 * Owns everything an Evil Clown's vial turns into once it has left his hand:
 * the bottle arcing through the air, the shatter where it lands, and the gas
 * cloud that sits there afterwards.
 *
 * It is a system rather than state on the creature for one reason. A mob stops
 * being updated and stops being drawn the frame it dies — `MobUpdateLoop` skips
 * the dead, and kill resolution drops them out of the spatial grid the renderer
 * queries. A bottle owned by the clown therefore vanished in mid-air the
 * instant the player landed the killing blow, and every cloud already on the
 * ground went with it. Glass already in the air does not care what happened to
 * the clown who threw it, and now neither does the code.
 *
 * The clowns queue their throws and this drains them, so nothing has to be
 * injected into a mob at spawn time.
 */

import type { Player, DamageSource } from '../Player';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { EvilClown, VIAL_ATTACK_TYPE } from '../creatures/EvilClown';
import { TILE_SIZE } from '../core/constants';
import { drawClownGas, drawClownVial, drawClownVialShatter } from '../sprites/clownGasSprite';
import type { GameSystem, SystemContext } from './GameSystem';
import type { GroundHazardSource } from './GroundHazardSource';

/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const CENTER_OFFSET = 0.5;

/** Frames a lobbed bottle spends in the air, whatever distance it covers. */
const VIAL_FLIGHT_FRAMES = 38;
/** Peak of the lob, in tiles. Visual only — the landing point never moves. */
const VIAL_ARC_HEIGHT_TILES = 2.2;
/** Radius the impact itself damages within, in tiles. Small — it is the glass. */
const IMPACT_RADIUS_TILES = 0.7;

const SHATTER_LIFETIME_FRAMES = 22;

/**
 * Scales the normalised parabola `t(1-t)`, whose own peak is 1/4, so the lob's
 * apex is exactly {@link VIAL_ARC_HEIGHT_TILES}.
 */
const PARABOLA_PEAK_NORMALISER = 4;

/** Radius of a cloud, in tiles. Matches `GAS_RADIUS` in `scripts/clownGasArt.ts`. */
const CLOUD_RADIUS_TILES = 1.5;
/** Frames a cloud lingers (~8 s at 60 fps). */
const CLOUD_FRAMES = 480;
/** Frames the cloud spends welling up as it disperses, and thinning as it dies. */
const CLOUD_RISE_FRAMES = 24;
const CLOUD_FADE_FRAMES = 90;
const CLOUD_CONTACT_DAMAGE = 1;
/** Frames between ticks of contact damage while standing in gas. */
const CLOUD_DAMAGE_INTERVAL = 20;
const CLOUD_DAMAGE_FLASH_FRAMES = 8;

/**
 * Live clouds beyond this are dropped oldest-first rather than drawn. A five
 * second juggling fit throws six or seven bottles; two clowns and a long fight
 * is the case this bounds.
 */
const MAX_CLOUDS = 12;

/**
 * Nobody is standing in the cloud when it burns you — the clown may well be
 * dead by then — so it is environmental rather than attributed, and
 * `takeDamage` only rolls a dodge against `kind: 'mob'`, which makes standing
 * in gas undodgeable for free.
 */
const CLOUD_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'clownGas' };

interface Vial {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** Screen-space height it left the clown's hands at. */
  readonly releaseHeightPx: number;
  readonly damage: number;
  /**
   * The impact is undodgeable: there is no sidestepping a bottle that has
   * already broken on the ground you are standing on.
   */
  readonly source: DamageSource;
  /**
   * The clown that threw it, so a hit can be recorded against him.
   *
   * The whole point of this system is that a bottle outlives its clown, so this
   * may well reference a dead mob — which is fine, it is only ever read to note
   * blood. Held here rather than on the clown precisely because a projectile
   * stored on a mob is deleted in mid-air when that mob dies.
   */
  readonly owner: Mob;
  age: number;
}

interface Shatter {
  readonly x: number;
  readonly y: number;
  tick: number;
}

interface GasCloud {
  readonly x: number;
  readonly y: number;
  /** Staggers the loop so clouds laid together do not billow in lockstep. */
  readonly seed: number;
  tick: number;
  /**
   * The clown whose bottle laid this cloud. A cloud routinely outlives him,
   * which is why choking in one only counts as his blow while he is still
   * alive — see `tickContactFor`.
   */
  readonly owner: Mob;
}

export class ClownGasSystem implements GameSystem, GroundHazardSource {
  private vials: Vial[] = [];
  private shatters: Shatter[] = [];
  private clouds: GasCloud[] = [];
  /**
   * Unbroken frames each victim has spent in gas, keyed by the victim itself.
   *
   * Keyed by victim rather than held in two fields because summons and hired
   * mercenaries breathe too: the impact already counted them, and a follower
   * that could stand in a cloud forever is the kind of asymmetry a player
   * notices immediately.
   *
   * Weak because the key set is not stable. `MongoSystem` and
   * `MercenarySystem` splice their charges out of `extraTargets` on recall or
   * death, and a pet recalled while standing in gas is never visited again — a
   * strong map would pin that whole `Player` for the life of the scene, once per
   * summon, and the toggle is spammable.
   */
  private contactFrames = new WeakMap<Player, number>();
  /** Incremented per cloud so each gets a distinct animation offset. */
  private nextCloudSeed = 0;

  /** Set when a bottle lands; `DungeonScene` reads and clears it to play the smash. */
  shatterSoundPending = false;

  constructor(private readonly gameMap: GameMap) {}

  update(ctx: SystemContext): void {
    this.collectThrows(ctx.roster.mobs);
    this.advanceVials(ctx);
    this.advanceShatters();
    this.advanceClouds();
    for (const victim of this.targetsFor(ctx)) this.tickContactFor(victim);
  }

  /**
   * Drains every Evil Clown's queued throws.
   *
   * Deliberately walks the full mob list rather than only the ones near a
   * player: a clown that releases a bottle and is killed in the same frame is
   * skipped by every activation-radius query from the next frame on, and his
   * throw would be stranded in a queue forever.
   */
  private collectThrows(mobs: readonly Mob[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof EvilClown)) continue;
      for (const vial of mob.takePendingVials()) {
        this.vials.push({
          fromX: vial.fromX,
          fromY: vial.fromY,
          toX: vial.toX,
          toY: vial.toY,
          releaseHeightPx: vial.releaseHeightPx,
          damage: vial.damage,
          source: {
            kind: 'mob',
            mobType: vial.mobType,
            attackType: VIAL_ATTACK_TYPE,
            undodgeable: true,
          },
          owner: mob,
          age: 0,
        });
      }
    }
  }

  private advanceVials(ctx: SystemContext): void {
    const survivors: Vial[] = [];
    for (const vial of this.vials) {
      vial.age++;
      if (vial.age < VIAL_FLIGHT_FRAMES) {
        survivors.push(vial);
        continue;
      }
      this.land(vial, this.targetsFor(ctx));
    }
    this.vials = survivors;
  }

  /**
   * Turns a bottle into a shatter plus the cloud it leaves, and applies the
   * impact's damage.
   *
   * The impact lands here, on the single frame the glass breaks, rather than
   * over the shatter animation: a burst that keeps dealing damage for the
   * length of its own animation punishes a player who was already clear of it
   * by the time they could have reacted.
   */
  private land(vial: Vial, targets: readonly Player[]): void {
    // A bottle that would come down inside a wall is dropped short at the
    // clown's own tile rather than laying gas nobody can reach or leave.
    const landing = this.landingPointFor(vial);
    this.shatters.push({ x: landing.x, y: landing.y, tick: SHATTER_LIFETIME_FRAMES });
    if (this.clouds.length >= MAX_CLOUDS) this.clouds.shift();
    this.clouds.push({
      x: landing.x,
      y: landing.y,
      seed: this.nextCloudSeed++,
      tick: CLOUD_FRAMES,
      owner: vial.owner,
    });
    this.shatterSoundPending = true;

    const radius = TILE_SIZE * IMPACT_RADIUS_TILES;
    for (const target of targets) {
      if (!target.isAlive) continue;
      const cx = target.x + TILE_SIZE * CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * CENTER_OFFSET;
      if (Math.hypot(landing.x - cx, landing.y - cy) > radius) continue;
      const connected = target.takeDamage(vial.damage, vial.source);
      if (connected) vial.owner.noteStruckPlayer(target);
    }
  }

  /** Where the bottle actually breaks — its aim point, or the clown's tile. */
  private landingPointFor(vial: Vial): { x: number; y: number } {
    const tileX = Math.floor(vial.toX / TILE_SIZE);
    const tileY = Math.floor(vial.toY / TILE_SIZE);
    if (this.gameMap.isWalkable(tileX, tileY)) return { x: vial.toX, y: vial.toY };
    return { x: vial.fromX, y: vial.fromY };
  }

  /**
   * Everything a bottle can hit: the two players plus the scene's extra
   * player-like targets (Mongo, hired mercenaries).
   */
  private targetsFor(ctx: SystemContext): readonly Player[] {
    const targets: Player[] = [ctx.human, ctx.cat];
    /**
     * Defend-quest NPCs are escorted, not hunted. `MobUpdateLoop` strips them
     * out of the shared AI target list for exactly this reason, and
     * `DefendQuestSystem` fails the quest the instant the NPC dies — so a
     * scattered bottle that merely landed near the Goblin Mother would lose a
     * quest the player was winning.
     */
    if (ctx.extraTargets) {
      for (const extra of ctx.extraTargets) {
        if (extra.isDefendTarget === true) continue;
        if (!targets.includes(extra)) targets.push(extra);
      }
    }
    return targets;
  }

  private advanceShatters(): void {
    for (const shatter of this.shatters) shatter.tick--;
    this.shatters = this.shatters.filter((shatter) => shatter.tick > 0);
  }

  private advanceClouds(): void {
    for (const cloud of this.clouds) cloud.tick--;
    this.clouds = this.clouds.filter((cloud) => cloud.tick > 0);
  }

  /** True while a cloud is still welling up and has not started choking yet. */
  private isStillWellingUp(cloud: GasCloud): boolean {
    return cloud.tick > CLOUD_FRAMES - CLOUD_RISE_FRAMES;
  }

  /** The choking cloud this position is inside, if any. */
  private cloudAt(x: number, y: number): GasCloud | null {
    const cx = x + TILE_SIZE * CENTER_OFFSET;
    const cy = y + TILE_SIZE * CENTER_OFFSET;
    const radius = TILE_SIZE * CLOUD_RADIUS_TILES;
    for (const cloud of this.clouds) {
      // A cloud that is still welling up does not choke yet; without this the
      // damage lands well before there is any gas drawn to explain it.
      if (this.isStillWellingUp(cloud)) continue;
      if (Math.hypot(cloud.x - cx, cloud.y - cy) < radius) return cloud;
    }
    return null;
  }

  /**
   * One victim's contact damage. Contact is tracked per victim and reset the
   * moment they step out, so the interval measures *unbroken* exposure.
   */
  private tickContactFor(victim: Player): void {
    const cloud = victim.isAlive ? this.cloudAt(victim.x, victim.y) : null;
    if (cloud === null) {
      this.contactFrames.delete(victim);
      return;
    }
    const frames = (this.contactFrames.get(victim) ?? 0) + 1;
    this.contactFrames.set(victim, frames);
    if (frames === 1 || frames % CLOUD_DAMAGE_INTERVAL === 0) {
      const connected = victim.takeDamage(CLOUD_CONTACT_DAMAGE, CLOUD_DAMAGE_SOURCE);
      victim.damageFlash = CLOUD_DAMAGE_FLASH_FRAMES;
      // Choking on a live clown's gas is being in a fight with that clown, so
      // the tick counts as his blow. Only while he lives: a cloud outlasts him,
      // and reviving the flag for a dead clown would keep pointing the companion
      // at a corpse.
      if (connected && cloud.owner.isAlive) cloud.owner.noteStruckPlayer(victim);
    }
  }

  /**
   * `GroundHazardSource` — which way the AI companion should run.
   *
   * Points straight out of the nearest cloud the given position is inside.
   * A companion standing exactly on a cloud's centre gets a fixed direction
   * rather than a zero vector it would normalise into NaN.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * CENTER_OFFSET;
    const cy = y + TILE_SIZE * CENTER_OFFSET;
    const radius = TILE_SIZE * CLOUD_RADIUS_TILES;
    // Deliberately includes clouds still welling up, which `isInGas` excludes:
    // damage should not land before the gas is drawn, but a follower that waits
    // for the cloud to arm before moving is already standing in it.
    let nearest: GasCloud | null = null;
    let nearestDist = radius;
    for (const cloud of this.clouds) {
      const dist = Math.hypot(cx - cloud.x, cy - cloud.y);
      if (dist >= nearestDist) continue;
      nearest = cloud;
      nearestDist = dist;
    }
    if (nearest === null) return null;
    const dx = cx - nearest.x;
    const dy = cy - nearest.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return { dx: 1, dy: 0 };
    return { dx: dx / length, dy: dy / length };
  }

  /** The clouds, drawn under creatures so the party walks in front of them. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const cloud of this.clouds) {
      const elapsed = CLOUD_FRAMES - cloud.tick;
      const rising = Math.min(1, elapsed / CLOUD_RISE_FRAMES);
      const dying = Math.min(1, cloud.tick / CLOUD_FADE_FRAMES);
      const intensity = Math.min(rising, dying);
      if (intensity <= 0) continue;
      drawClownGas(ctx, cloud.x - camX, cloud.y - camY, TILE_SIZE, elapsed, cloud.seed, intensity);
    }
  }

  /** The bottles and shatters, drawn over creatures so neither hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const shatter of this.shatters) {
      const progress = 1 - shatter.tick / SHATTER_LIFETIME_FRAMES;
      drawClownVialShatter(ctx, shatter.x - camX, shatter.y - camY, TILE_SIZE, progress);
    }
    for (const vial of this.vials) {
      const travel = vial.age / VIAL_FLIGHT_FRAMES;
      const x = vial.fromX + (vial.toX - vial.fromX) * travel;
      const y = vial.fromY + (vial.toY - vial.fromY) * travel;
      // The lob's own arc plus the release height decaying to zero, applied as a
      // screen-space lift only: the bottle starts at his hands rather than his
      // feet, and its world position — so where the gas lands — stays the flat
      // interpolation above.
      const arcPx =
        TILE_SIZE * VIAL_ARC_HEIGHT_TILES * PARABOLA_PEAK_NORMALISER * travel * (1 - travel);
      const heightPx = arcPx + vial.releaseHeightPx * (1 - travel);
      drawClownVial(ctx, x - camX, y - camY, TILE_SIZE, vial.age, heightPx);
    }
  }

  /** A checkpoint restore must not resume a bottle thrown in the run that died. */
  resetForCheckpoint(): void {
    this.vials = [];
    this.shatters = [];
    this.clouds = [];
    // A WeakMap has no `clear`; dropping the reference is the reset.
    this.contactFrames = new WeakMap();
    this.nextCloudSeed = 0;
    this.shatterSoundPending = false;
  }
}
