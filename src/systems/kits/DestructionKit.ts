/**
 * DestructionKit — the things a place lets you break, and what falls out of
 * them: smashable props, the loot they and the dead leave on the floor, the
 * visible pickups lying about to be gathered by hand, and thrown dynamite.
 *
 * A scene constructs one of these and barrels start having hit points. Building
 * interiors generate `BARREL` and `CRATE` tiles and never built any of this, so
 * indoors those props were scenery a swing passed straight through.
 *
 * Loot and dynamite are wanted everywhere; smashable props are not. A map whose
 * props are architecture — the outdoor town's street torches and gate braziers —
 * passes an empty `breakableProps` set rather than going without the kit, so
 * every scene builds the same shape and no caller downstream carries a null.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { ALL_BREAKABLE_PROPS, DestructiblePropSystem } from '../DestructiblePropSystem';
import type { DestructiblePropCheckpoint, DestructiblePropKind } from '../DestructiblePropSystem';
import { DynamiteSystem } from '../DynamiteSystem';
import type { SystemContext } from '../GameSystem';
import { LootSystem } from '../LootSystem';
import { GroundPickupSystem, type GroundPickupCheckpoint } from '../GroundPickupSystem';
import type { LootCheckpoint } from '../LootSystem';
import type { TreeSystem } from '../TreeSystem';
import type { SceneWorld } from './SceneWorld';
import {
  playDungeonCue,
  propEventCues,
  wallFixtureEventCues,
  type DungeonCue,
} from '../dungeon/dungeonSoundCues';

/** Coin-purse cue on loot pickup. Matches the vendor-purchase level. */
const COIN_PICKUP_VOLUME = 0.55;

/**
 * A blow a prop survives sounds quieter than its break. The only blows with a
 * sound of their own are sheet metal denting, so in practice this is a dent
 * ringing quieter than the same metal giving way.
 */
const STRUCK_CUE_VOLUME = 0.6;

export interface DestructionKitOptions {
  /** Which props a swing breaks here. Defaults to everything breakable. */
  readonly breakableProps?: ReadonlySet<DestructiblePropKind>;
  /**
   * The trees a blast can fell, read at blast time. A function rather than a
   * reference because `TreeSystem` is built from this kit's own `LootSystem`,
   * so the two cannot both exist at each other's construction.
   */
  readonly trees?: () => TreeSystem | null;
}

/** Everything this kit's owner has to put back on a checkpoint restore. */
export interface DestructionCheckpoint {
  readonly loot: LootCheckpoint;
  readonly destructibles: DestructiblePropCheckpoint;
  readonly groundPickups: GroundPickupCheckpoint;
}

export class DestructionKit {
  readonly loot: LootSystem;
  readonly destructibles: DestructiblePropSystem;
  readonly dynamite: DynamiteSystem;
  /**
   * Visible things lying in the world to be picked up by hand. Here beside the
   * loot because anything that can die can drop one, wherever it dies.
   */
  readonly groundPickups: GroundPickupSystem;

  /** Each cue's next take, so back-to-back breaks never sound identical. */
  private readonly cueTakes = new Map<DungeonCue, number>();
  /** Cues already raised this frame; scratch for {@link drainAudioCues}. */
  private readonly cuesThisFrame = new Set<DungeonCue>();

  constructor(world: SceneWorld, floorNumber: number, options: DestructionKitOptions = {}) {
    this.loot = new LootSystem(world.gameMap);
    // Built before the dynamite, so a blast can be handed the props it flattens.
    this.destructibles = new DestructiblePropSystem(
      world.gameMap,
      this.loot,
      floorNumber,
      options.breakableProps ?? ALL_BREAKABLE_PROPS,
    );
    this.dynamite = new DynamiteSystem(world.gameMap, this.destructibles, options.trees, world.bus);
    this.groundPickups = new GroundPickupSystem(world.gameMap);
  }

  update(ctx: SystemContext): void {
    this.loot.update(ctx);
    this.destructibles.update();
    if (this.destructibles.firesBiteThisFrame) {
      this.destructibles.burnOccupants([ctx.human, ctx.cat, ...ctx.roster.mobs]);
    }
    this.destructibles.knockMobsIntoProps(ctx.roster.mobs, ctx.human);
    this.dynamite.update(ctx);
    this.groundPickups.update();
  }

  /**
   * @returns whether a prop gave way this frame, so an owner whose scenery is
   *   keyed off the layout can re-read it. A brazier is the case that matters —
   *   it is both breakable and an ambient fire emitter, so a smashed one goes on
   *   crackling from bare floor until somebody rescans. Reported for wood breaks
   *   too rather than narrowing to iron: the caller knows which tiles it cares
   *   about, and a rescan of a room-sized grid is cheaper than the coupling.
   */
  drainAudioCues(audio: AudioManager | null): boolean {
    const smashes = this.destructibles.drainSmashes();
    // One take of a cue per frame however many props gave way together:
    // overlapping copies of the same sample stack into a blast rather than a
    // smash.
    this.cuesThisFrame.clear();
    for (const event of this.destructibles.drainPropAudioEvents()) {
      const volume = event.name === 'struck' ? STRUCK_CUE_VOLUME : undefined;
      for (const cue of propEventCues(event)) this.raiseCue(audio, cue, volume);
    }
    for (const event of this.destructibles.drainWallFixtureEvents()) {
      for (const cue of wallFixtureEventCues(event)) this.raiseCue(audio, cue);
    }
    if (this.destructibles.drainFusesLit() > 0) this.raiseCue(audio, 'gasCylinderHiss');

    const pickups = this.loot.drainPickups();
    if (pickups.withCoins > 0) {
      audio?.play('coin_pouch', { volume: COIN_PICKUP_VOLUME });
    }
    if (pickups.withItems > 0) {
      audio?.playRandom(['pickup_1', 'pickup_2']);
    }

    const groundCues = this.groundPickups.drainPickupCues();
    if (groundCues.pickedUp) audio?.play('picking_up_ground_object');
    if (groundCues.refused) audio?.play('error_taking_action');

    if (this.dynamite.explosionSoundPending) {
      this.dynamite.explosionSoundPending = false;
      audio?.play('dynamite_explosion');
    }

    return smashes.wood > 0 || smashes.iron > 0 || smashes.trash > 0;
  }

  private raiseCue(audio: AudioManager | null, cue: DungeonCue, volume?: number): void {
    if (this.cuesThisFrame.has(cue)) return;
    this.cuesThisFrame.add(cue);
    playDungeonCue(audio, cue, this.cueTakes, volume === undefined ? {} : { volume });
  }

  /** Wreckage lies on the floor, so it draws under everything that walks on it. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.destructibles.renderWreckage(ctx, camX, camY);
  }

  /** Splinters, live sticks and their arc — all of it over the entities. */
  renderEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    thrower: HumanPlayer,
  ): void {
    this.destructibles.renderEffects(ctx, camX, camY);
    this.dynamite.render(ctx, camX, camY);
    this.dynamite.renderThrowPath(ctx, camX, camY, thrower);
  }

  /** Floor piles and their labels, drawn with the rest of the world-space chrome. */
  renderLoot(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void {
    this.loot.render(ctx, camX, camY, active);
  }

  captureCheckpoint(): DestructionCheckpoint {
    return {
      loot: this.loot.captureCheckpoint(),
      destructibles: this.destructibles.captureCheckpoint(),
      groundPickups: this.groundPickups.captureCheckpoint(),
    };
  }

  restoreCheckpoint(snapshot: DestructionCheckpoint): void {
    this.loot.restoreCheckpoint(snapshot.loot);
    this.destructibles.restoreCheckpoint(snapshot.destructibles);
    this.groundPickups.restoreCheckpoint(snapshot.groundPickups);
  }

  /** Drops any charging or airborne stick, so a rewound world has none mid-flight. */
  resetForCheckpoint(): void {
    this.dynamite.resetForCheckpoint();
  }
}
