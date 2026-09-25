/**
 * Ice fairies' bolts once they have left the fairy: their straight flight,
 * the first party member each one meets, and the frost it leaves.
 *
 * Owned by `FairySystem` rather than by the creature because a bolt in the air
 * outlives the fairy that loosed it: a mob stops updating and drawing the frame
 * it dies, and a bolt that vanished with it would make killing the fairy a way
 * to dodge a shot already fired.
 */

import type { DamageSource, Player } from '../Player';
import type { GameMap } from '../map/GameMap';
import { Mob } from '../creatures/Mob';
import { TILE_SIZE } from '../core/constants';
import { applyChillOnly, applyIceHit } from '../core/frostStatus';
import { ICE_BOLT_ATTACK_TYPE, IceFairy } from '../creatures/fairies/IceFairy';
import {
  CHILL_BLAST_RADIUS_TILES,
  ICE_BOLT_HIT_RADIUS_PX,
  ICE_BOLT_MAX_TRAVEL_TILES,
  ICE_BOLT_SPEED,
} from '../creatures/fairies/fairyTuning';
import {
  drawChillBlastRing,
  drawIceBolt,
  type IceBoltTrailPoint,
} from '../sprites/art/fairyEffectsArt';

/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;

/** Past positions drawn behind a bolt, and the frames between them. */
const TRAIL_POINTS = 6;
const TRAIL_STEP_FRAMES = 2;

/** Frames the shatter plays where a bolt struck a body or a wall. */
const SHATTER_FRAMES = 18;
/** The shatter's reach, as a share of the ice fairy's death burst. */
const SHATTER_RADIUS_SHARE = 0.2;

interface IceBolt {
  readonly fromX: number;
  readonly fromY: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly damage: number;
  readonly liftPx: number;
  /**
   * The fairy that loosed it. May well be dead by the time it lands; read only
   * to name the blow and to note blood while the fairy lives.
   */
  readonly owner: IceFairy;
  readonly seed: number;
  age: number;
}

interface Shatter {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
  age: number;
}

/** Where an ice bolt ended its flight. */
export type IceBoltImpact = 'body' | 'wall' | 'spent';

export class FairyIceBolts {
  private bolts: IceBolt[] = [];
  private shatters: Shatter[] = [];
  private nextSeed = 0;
  /** Impacts since the last {@link takeImpacts}, for the scene's sound. */
  private impacts: IceBoltImpact[] = [];

  constructor(private readonly gameMap: GameMap) {}

  /** Bolts in the air, for gates. */
  get liveBolts(): readonly {
    readonly x: number;
    readonly y: number;
    readonly owner: IceFairy;
  }[] {
    return this.bolts.map((bolt) => ({ ...boltPoint(bolt, bolt.age), owner: bolt.owner }));
  }

  /** Drains the impacts since the last call. */
  takeImpacts(): readonly IceBoltImpact[] {
    if (this.impacts.length === 0) return [];
    const taken = this.impacts;
    this.impacts = [];
    return taken;
  }

  /**
   * Drains every ice fairy's loosed bolts, the dead included — a fairy killed
   * on the frame it fired still fired — then flies every bolt one frame.
   */
  update(mobs: readonly Mob[], party: readonly Player[]): void {
    for (const mob of mobs) {
      if (!(mob instanceof IceFairy)) continue;
      for (const loosed of mob.takePendingIceBolts()) {
        this.bolts.push({ ...loosed, owner: mob, seed: this.seed(), age: 0 });
      }
    }
    const flying: IceBolt[] = [];
    for (const bolt of this.bolts) {
      bolt.age++;
      const impact = this.advance(bolt, party);
      if (impact === null) flying.push(bolt);
      else this.impacts.push(impact);
    }
    this.bolts = flying;
    for (const shatter of this.shatters) shatter.age++;
    this.shatters = this.shatters.filter((shatter) => shatter.age < SHATTER_FRAMES);
  }

  /** Flies `bolt` to where it is this frame; how it ended, or null while it flies on. */
  private advance(bolt: IceBolt, party: readonly Player[]): IceBoltImpact | null {
    const now = boltPoint(bolt, bolt.age);
    const tileX = Math.floor(now.x / TILE_SIZE);
    const tileY = Math.floor(now.y / TILE_SIZE);
    if (!this.gameMap.isWalkable(tileX, tileY)) {
      const last = boltPoint(bolt, bolt.age - 1);
      this.shatter(last.x, last.y);
      return 'wall';
    }
    const struck = firstBodyStruck(party, now.x, now.y);
    if (struck !== null) {
      this.strike(bolt, struck, now.x, now.y);
      this.shatter(now.x, now.y);
      return 'body';
    }
    const travelled = ICE_BOLT_SPEED * bolt.age;
    if (travelled >= TILE_SIZE * ICE_BOLT_MAX_TRAVEL_TILES) return 'spent';
    return null;
  }

  /**
   * One party member met by a bolt: the blow, less what ice gear keeps out,
   * then the frost. A blow that never connects — dodged, or held off by a ward
   * — carries no frost in behind it.
   *
   * Mongo and the mercenaries are only ever chilled, never frozen: their AI
   * does not read the frozen state, and an encased pet still biting would be a
   * picture the fight contradicts.
   */
  private strike(bolt: IceBolt, target: Player, x: number, y: number): void {
    const damage = target.resistedDamage(bolt.damage, 'ice');
    const source: DamageSource = bolt.owner.stampHarmLimits({
      kind: 'mob',
      mobType: bolt.owner.mobType,
      attackType: ICE_BOLT_ATTACK_TYPE,
      from: { x, y },
    });
    const connected = target.takeDamage(damage, source);
    if (!connected || !target.isAlive) return;
    if (bolt.owner.isAlive) bolt.owner.noteStruckPlayer(target);
    if (target instanceof Mob) {
      applyChillOnly(target);
      return;
    }
    applyIceHit(target);
  }

  private shatter(x: number, y: number): void {
    this.shatters.push({ x, y, seed: this.seed(), age: 0 });
  }

  private seed(): number {
    this.nextSeed++;
    return this.nextSeed;
  }

  /** Bolts and their shatters, over creatures so a bolt never hides behind one. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, frame: number): void {
    for (const bolt of this.bolts) {
      const trail: IceBoltTrailPoint[] = [];
      for (let step = TRAIL_POINTS; step >= 1; step--) {
        const point = boltPoint(bolt, Math.max(0, bolt.age - step * TRAIL_STEP_FRAMES));
        trail.push({ x: point.x - camX, y: point.y - bolt.liftPx - camY });
      }
      const now = boltPoint(bolt, bolt.age);
      drawIceBolt(
        ctx,
        trail,
        now.x - camX,
        now.y - bolt.liftPx - camY,
        bolt.dirX,
        bolt.dirY,
        TILE_SIZE,
        frame,
        bolt.seed,
      );
    }
    const shatterPx = TILE_SIZE * CHILL_BLAST_RADIUS_TILES * SHATTER_RADIUS_SHARE;
    for (const shatter of this.shatters) {
      drawChillBlastRing(
        ctx,
        shatter.x - camX,
        shatter.y - camY,
        shatterPx,
        shatter.age / SHATTER_FRAMES,
        frame,
        shatter.seed,
      );
    }
  }

  /** A checkpoint restore must not resume bolts from the run that died. */
  reset(): void {
    this.bolts = [];
    this.shatters = [];
    this.impacts = [];
  }
}

/** Where `bolt` is `age` frames into its flight, on the ground plane. */
function boltPoint(bolt: IceBolt, age: number): { x: number; y: number } {
  const travelled = ICE_BOLT_SPEED * age;
  return { x: bolt.fromX + bolt.dirX * travelled, y: bolt.fromY + bolt.dirY * travelled };
}

/** The living party member nearest (x, y) within the bolt's reach, or null. */
function firstBodyStruck(party: readonly Player[], x: number, y: number): Player | null {
  let nearest: Player | null = null;
  let nearestDistance = ICE_BOLT_HIT_RADIUS_PX;
  for (const member of party) {
    if (!member.isAlive) continue;
    const centreX = member.x + TILE_SIZE * TILE_CENTRE;
    const centreY = member.y + TILE_SIZE * TILE_CENTRE;
    const distance = Math.hypot(centreX - x, centreY - y);
    if (distance > nearestDistance) continue;
    nearest = member;
    nearestDistance = distance;
  }
  return nearest;
}
