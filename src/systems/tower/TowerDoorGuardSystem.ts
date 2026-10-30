/**
 * The two guards posted at the Town Center Tower's front door on the floor-3
 * overworld. They stand either side of the doorway for the whole floor,
 * before, during and after the missing-cats questline: they never leave, never
 * path and are never fought. Talking to one gets a short refusal in his own
 * voice; the door itself refuses through {@link towerDoorRefusal}.
 */

import { TILE_SIZE } from '../../core/constants';
import { TowerGuard } from '../../creatures/TowerGuard';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { Conversation } from '../../dialog/Conversation';
import type { DialogLine } from '../../dialog/line';
import type { ConversationHandle } from '../../dialog/request';
import { pickFreshLine } from '../../dialog/scripts/scenes/cloggedBathroom';
import {
  TOWER_DOOR_GUARD_LINES,
  TOWER_DOOR_PROMPTS,
  type TowerDoorPost,
  type TowerDoorStanding,
} from '../../dialog/scripts/scenes/towerDoor';
import type { GameMap } from '../../map/GameMap';
import type { Point } from '../../map/roomDoorways';
import type { TilePoint } from '../../map/town/townPlan';
import { drawInteractionPromptOver } from '../../ui/InteractionPrompt';
import type { GameSystem, SystemContext } from '../GameSystem';
import type { MobRoster } from '../kits/SceneWorld';

export interface TowerDoorGuardDeps {
  readonly gameMap: GameMap;
  readonly roster: MobRoster;
  readonly conversation: Conversation;
  /** What the door and its guards answer with this frame; read on every talk. */
  readonly standing: () => TowerDoorStanding;
}

/** How close, in tiles, a crawler must stand to talk to a door guard. */
const TOWER_DOOR_GUARD_TALK_RANGE_TILES = 1.6;
const TALK_RANGE_PX = TOWER_DOOR_GUARD_TALK_RANGE_TILES * TILE_SIZE;
/** At their posts the guards look out over the terrace, away from the door. */
const FACING_SOUTH_RADIANS = Math.PI / 2;
const HALF = 0.5;

/** The look each post's guard wears, so the pair never stands as twins. */
const LOOK_VARIANT_BY_POST: Readonly<Record<TowerDoorPost, number>> = {
  west: 0,
  east: 1,
};
const POSTS: readonly TowerDoorPost[] = ['west', 'east'];

interface PostedGuard {
  readonly post: TowerDoorPost;
  readonly mob: TowerGuard;
  talks: number;
  lastLine: DialogLine | null;
}

function centreOf(entity: { readonly x: number; readonly y: number }): Point {
  return { x: entity.x + TILE_SIZE * HALF, y: entity.y + TILE_SIZE * HALF };
}

export class TowerDoorGuardSystem implements GameSystem {
  private readonly guards: readonly PostedGuard[];
  private conversationHandle: ConversationHandle | null = null;
  private talkingTo: PostedGuard | null = null;

  constructor(private readonly deps: TowerDoorGuardDeps) {
    const posts = deps.gameMap.townPlan?.towerGuardPosts;
    this.guards = posts === undefined ? [] : POSTS.map((post) => this.postGuard(post, posts[post]));
  }

  private postGuard(post: TowerDoorPost, tile: TilePoint): PostedGuard {
    const mob = new TowerGuard(tile.x, tile.y, TILE_SIZE, LOOK_VARIANT_BY_POST[post]);
    mob.setFacingAngle(FACING_SOUTH_RADIANS);
    this.deps.roster.add(mob);
    return { post, mob, talks: 0, lastLine: null };
  }

  private nearestGuard(active: { readonly x: number; readonly y: number }): PostedGuard | null {
    const from = centreOf(active);
    let best: PostedGuard | null = null;
    let bestDistance = TALK_RANGE_PX;
    for (const guard of this.guards) {
      const at = centreOf(guard.mob);
      const distance = Math.hypot(at.x - from.x, at.y - from.y);
      if (distance > bestDistance) continue;
      best = guard;
      bestDistance = distance;
    }
    return best;
  }

  /** Whether a press from `active` would reach a door guard. */
  wouldInteract(active: { readonly x: number; readonly y: number }): boolean {
    return this.nearestGuard(active) !== null;
  }

  /** The tower door's link in the interact chain. Returns whether it took the press. */
  tryInteract(active: HumanPlayer | CatPlayer): boolean {
    const guard = this.nearestGuard(active);
    if (guard === null) return false;
    this.talkTo(guard, active);
    return true;
  }

  private talkTo(guard: PostedGuard, active: HumanPlayer | CatPlayer): void {
    const pool = TOWER_DOOR_GUARD_LINES[guard.post][this.deps.standing()];
    const line = pickFreshLine(pool, guard.mob.seed, guard.talks, guard.lastLine);
    guard.lastLine = line;
    guard.talks++;
    guard.mob.faceTile({
      x: Math.round(active.x / TILE_SIZE),
      y: Math.round(active.y / TILE_SIZE),
    });
    this.talkingTo = guard;
    this.conversationHandle = this.deps.conversation.open({
      lines: [line],
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => undefined },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: false,
      anchor: {
        position: () => ({ x: guard.mob.x, y: guard.mob.y }),
        talkRangeTiles: TOWER_DOOR_GUARD_TALK_RANGE_TILES,
      },
      locksKeyboard: false,
    });
  }

  /** Whether the conversation on screen is one this system opened. */
  get isDialogOpen(): boolean {
    return (
      this.conversationHandle !== null && this.deps.conversation.isActive(this.conversationHandle)
    );
  }

  update(_ctx: SystemContext): void {
    const talking = this.isDialogOpen ? this.talkingTo : null;
    for (const guard of this.guards) {
      if (guard === talking) {
        guard.mob.setActivity('talk');
        continue;
      }
      guard.mob.setActivity('idle');
      guard.mob.setFacingAngle(FACING_SOUTH_RADIANS);
    }
    if (talking === null) this.talkingTo = null;
  }

  /** Draws the prompt over the guard a press from `promptFor` would reach; pass none where a press would not. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    promptFor: HumanPlayer | CatPlayer | undefined,
  ): void {
    if (promptFor === undefined) return;
    const guard = this.nearestGuard(promptFor);
    if (guard === null) return;
    drawInteractionPromptOver(ctx, guard.mob, camX, camY, TOWER_DOOR_PROMPTS.talkToGuard);
  }
}
