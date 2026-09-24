import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameSystem, SystemContext } from '../GameSystem';
import type { GroundHazardSource } from '../GroundHazardSource';
import type { TownPropRenderable } from '../townPropRenderable';

/**
 * A live object a boss room draws in the scene's Y-sorted entity pass — a prop
 * mid-topple, a lit vat — with the same contract as a town fixture, so the
 * render pipeline sorts both through one path.
 */
export type DressingRenderable = TownPropRenderable;

/**
 * What a room's dressing hears about the fight in it.
 *
 * Kept apart from {@link BossRoomDressing} because the fight owners —
 * `BossRoomSystem`, `SpiderQuestSystem`, `ArenaSystem` — only ever announce, and
 * a narrower type is all they should be able to reach.
 *
 * A death is never announced here. The scene rewinds every dressing itself:
 * `resetForCheckpoint` and then `restoreCheckpoint` from the save, and that
 * restore has the last word — a wipe the fight owner saw a frame earlier and
 * reported as an abort is overwritten by it. So a dressing must come back
 * whole from the restore alone, and `onFightAborted` is only ever the fight
 * ending with the party still playing.
 *
 * `onBossDefeated` may arrive more than once for the same kill: the scene
 * replays it after a build or a load for every boss already dead, since a room
 * built after the kill never heard it. Handling it must be idempotent.
 */
export interface BossFightHooks {
  /** The room has just locked with the party inside. Fires again on every re-lock after an abort. */
  onSeal(): void;
  /** The boss is dead and the room has been won. Idempotent: it is replayed after builds and loads. */
  onBossDefeated(): void;
  /**
   * The fight was abandoned with the boss alive — the party ran, or went down
   * short of a death — and the boss has been healed back to full. Never sent
   * for a dead boss, and never the death path (see above). The room must return to how it
   * looked before the seal, or the next attempt starts on ground the last one
   * wrecked.
   */
  onFightAborted(): void;
}

/**
 * What a gauntlet boss room's fight tells its dressing, by room index — the
 * shape `BossRoomSystem` speaks, since it tracks rooms by index and not by boss.
 */
export interface BossRoomFightListener {
  onSeal(roomIndex: number): void;
  onBossDefeated(roomIndex: number): void;
  onFightAborted(roomIndex: number): void;
}

/**
 * Everything a boss room's own dressing — its props, slow ground, hazards and
 * interactables — gives the scene, beyond the boss itself.
 *
 * Checkpoints are typed per room and live on {@link CheckpointedDressing}, since
 * a shared `unknown` snapshot type could only be restored through a cast.
 */
export interface BossRoomDressing extends GameSystem, GroundHazardSource, BossFightHooks {
  update(ctx: SystemContext): void;
  /** Floor paint over the chunk bake and under every entity: stains, telegraphs, belts. */
  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void;
  /**
   * Live objects to merge into the Y-sorted pass this frame. Return a list the
   * dressing owns and reuses; the pipeline reads it and never keeps it.
   */
  renderEntities(): ReadonlyArray<DressingRenderable>;
  /** Anything that must cross in front of every body: falling debris, sparks, spray. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void;
  /**
   * Drops transient fight state after a death, before the checkpoint restore
   * runs. Together with that restore, the whole of a death's rewind.
   */
  resetForCheckpoint(): void;
  /** The Space press, offered to the room. True when the room consumed it. */
  tryInteract(player: HumanPlayer | CatPlayer): boolean;
}

/** A dressing whose state rewinds with a death. */
export interface CheckpointedDressing<Checkpoint> {
  captureCheckpoint(): Checkpoint;
  restoreCheckpoint(snapshot: Checkpoint): void;
}
