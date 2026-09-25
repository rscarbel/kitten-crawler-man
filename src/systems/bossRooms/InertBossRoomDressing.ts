import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { SystemContext } from '../GameSystem';
import type { BossRoomDressing, DressingRenderable } from './BossRoomDressing';

const NO_RENDERABLES: ReadonlyArray<DressingRenderable> = [];

/**
 * A room dressing with nothing in it: every hook is answered and none acts.
 *
 * A room extends this and overrides the hooks it has content for, so adding a
 * hook to {@link BossRoomDressing} does not force an edit into every room that
 * has no use for it.
 */
export abstract class InertBossRoomDressing implements BossRoomDressing {
  update(_ctx: SystemContext): void {
    // A room with no moving parts has nothing to advance.
  }

  renderGround(
    _ctx: CanvasRenderingContext2D,
    _camX: number,
    _camY: number,
    _active: HumanPlayer | CatPlayer,
  ): void {
    // Its floor is entirely in the chunk bake.
  }

  renderEntities(): ReadonlyArray<DressingRenderable> {
    return NO_RENDERABLES;
  }

  renderAbove(_ctx: CanvasRenderingContext2D, _camX: number, _camY: number): void {
    // Nothing of it crosses in front of a body.
  }

  onSeal(): void {
    // Nothing in the room reacts to the door shutting.
  }

  onBossDefeated(): void {
    // Nothing in the room reacts to the kill.
  }

  onFightAborted(): void {
    // Nothing changed during the fight, so there is nothing to put back.
  }

  resetForCheckpoint(): void {
    // No transient state outlives a death.
  }

  getHazardEscapeVector(_x: number, _y: number): { dx: number; dy: number } | null {
    return null;
  }

  tryInteract(_player: HumanPlayer | CatPlayer): boolean {
    return false;
  }

  wouldInteract(_player: HumanPlayer | CatPlayer): boolean {
    return false;
  }
}
