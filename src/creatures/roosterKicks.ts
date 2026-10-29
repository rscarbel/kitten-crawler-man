/**
 * The kick every rooster in Big Rooster's gym has: a lit stick of the party's
 * dynamite that lands near a bird is walked up to and booted, and Big Rooster
 * boots his exercise balls the same way.
 *
 * Shared by `BigRooster` and `RoosterMinion`, which each own one
 * {@link RoosterKickMotion} and read the gym through the {@link RoosterFlockView}
 * the gym hands every rooster each frame.
 */

import type { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  ROOSTER_PUNCH_IMPACT_PROGRESS,
  ROOSTER_PUNCH_RECOVER_FRAMES,
  ROOSTER_PUNCH_WINDUP_FRAMES,
} from '../sprites/bigRoosterAttackTiming';
import { launchSpeedFor } from '../systems/dynamiteSlide';
import type { ExplosiveVelocity, LiveExplosive, LiveStickId } from '../systems/ExplosiveSource';
import type { TileRect } from '../systems/bossRooms/bossRoomLayout';

/** How near a bird a landed stick has to be before that bird goes and kicks it, in tiles. */
const DYNAMITE_KICK_REACH_TILES = 4;
/** Centre to centre, how near the stick a bird has to stand to kick it, in tiles. */
export const DYNAMITE_KICK_CONTACT_TILES = 0.9;
/** How far a stick kicked clear of the flock is sent, in tiles. */
const KICK_AWAY_DISTANCE_TILES = 7;
/** Headings tried for a kick clear of the flock. */
const KICK_AWAY_HEADINGS = 16;
/** Spacing of the open-floor checks along a kick's line, in tiles. */
const KICK_LINE_STEP_TILES = 0.5;
/** Frames a bird waits after a kick before it will chase another stick. */
export const DYNAMITE_KICK_COOLDOWN_FRAMES = 30;
/** Frames a bird keeps walking to a stick it cannot reach before giving it up. */
export const DYNAMITE_SEEK_GIVE_UP_FRAMES = 150;
const FULL_TURN = Math.PI * 2;
const TILE_CENTRE = 0.5;

/** What every rooster in the gym needs to know about the room and each other, set each frame by the gym. */
export interface RoosterFlockView {
  /** Centres of every living rooster in the gym, Big Rooster's included, in world pixels. */
  readonly members: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  /** The crawler the player is driving, or null when there is none to aim at. */
  readonly active: Player | null;
  /** Both crawlers. */
  readonly crawlers: readonly Player[];
  readonly room: TileRect;
  isWalkable(tileX: number, tileY: number): boolean;
}

/** A grounded stick a bird has picked out to kick. */
export interface KickableStick {
  readonly id: LiveStickId;
  readonly x: number;
  readonly y: number;
  readonly blastRadiusPx: number;
}

/**
 * The nearest grounded stick of the party's dynamite within
 * {@link DYNAMITE_KICK_REACH_TILES} of a bird centred at (cx, cy), or null.
 * A stick still in the air from a throw or a kick is left until it lands.
 */
export function stickToKick(
  cx: number,
  cy: number,
  explosives: readonly LiveExplosive[],
): KickableStick | null {
  let best: KickableStick | null = null;
  let bestDistance = DYNAMITE_KICK_REACH_TILES * TILE_SIZE;
  for (const explosive of explosives) {
    if (explosive.kind !== 'stick' || !explosive.grounded) continue;
    const distance = Math.hypot(explosive.x - cx, explosive.y - cy);
    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = {
      id: explosive.id,
      x: explosive.x,
      y: explosive.y,
      blastRadiusPx: explosive.blastRadiusPx,
    };
  }
  return best;
}

/** The same stick as it is this frame, or null once it has gone off. */
export function stickNow(
  id: LiveStickId,
  explosives: readonly LiveExplosive[],
): KickableStick | null {
  for (const explosive of explosives) {
    if (explosive.kind === 'stick' && explosive.id === id) {
      return { id, x: explosive.x, y: explosive.y, blastRadiusPx: explosive.blastRadiusPx };
    }
  }
  return null;
}

const centreOf = (body: Player): { x: number; y: number } => ({
  x: body.x + TILE_SIZE * TILE_CENTRE,
  y: body.y + TILE_SIZE * TILE_CENTRE,
});

/**
 * Where a kicked stick goes: at the active crawler when no crawler stands
 * within a blast of any rooster, so the blast lands on the party alone;
 * otherwise clear of the flock, toward the open floor furthest from every bird.
 */
export function dynamiteKickVelocity(
  stick: KickableStick,
  view: RoosterFlockView,
): ExplosiveVelocity {
  const crawlerAmongFlock = view.crawlers.some((crawler) => {
    if (!crawler.isAlive) return false;
    const at = centreOf(crawler);
    return view.members.some(
      (member) => Math.hypot(member.x - at.x, member.y - at.y) <= stick.blastRadiusPx,
    );
  });
  const active = view.active;
  if (!crawlerAmongFlock && active?.isAlive === true) {
    const at = centreOf(active);
    const dx = at.x - stick.x;
    const dy = at.y - stick.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const speed = launchSpeedFor(distance);
      return { vx: (dx / distance) * speed, vy: (dy / distance) * speed };
    }
  }
  return awayFromFlock(stick, view);
}

function awayFromFlock(stick: KickableStick, view: RoosterFlockView): ExplosiveVelocity {
  const reach = KICK_AWAY_DISTANCE_TILES * TILE_SIZE;
  let best: { dx: number; dy: number; distance: number } | null = null;
  let bestScore = -Infinity;
  for (let heading = 0; heading < KICK_AWAY_HEADINGS; heading++) {
    const angle = (heading / KICK_AWAY_HEADINGS) * FULL_TURN;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const distance = openRunAlong(stick, dx, dy, reach, view);
    const landX = stick.x + dx * distance;
    const landY = stick.y + dy * distance;
    const score = Math.min(
      ...view.members.map((member) => Math.hypot(member.x - landX, member.y - landY)),
    );
    if (score > bestScore) {
      bestScore = score;
      best = { dx, dy, distance };
    }
  }
  if (best === null) return { vx: 0, vy: 0 };
  const speed = launchSpeedFor(best.distance);
  return { vx: best.dx * speed, vy: best.dy * speed };
}

/** How far a stick can slide from where it lies along (dx, dy) before the room's edge or a wall, up to `reach`. */
function openRunAlong(
  stick: KickableStick,
  dx: number,
  dy: number,
  reach: number,
  view: RoosterFlockView,
): number {
  const step = KICK_LINE_STEP_TILES * TILE_SIZE;
  let travelled = 0;
  while (travelled + step <= reach) {
    const x = stick.x + dx * (travelled + step);
    const y = stick.y + dy * (travelled + step);
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    const room = view.room;
    const inside =
      tileX >= room.x && tileY >= room.y && tileX < room.x + room.w && tileY < room.y + room.h;
    if (!inside || !view.isWalkable(tileX, tileY)) break;
    travelled += step;
  }
  return travelled;
}

/** Game frames of a kick, wind-up to settle: a rooster kicks on its punch's timing and row. */
const KICK_WINDUP_FRAMES = ROOSTER_PUNCH_WINDUP_FRAMES;
const KICK_FRAMES = ROOSTER_PUNCH_WINDUP_FRAMES + ROOSTER_PUNCH_RECOVER_FRAMES;

/**
 * One kick in progress. The roosters have no kicking row, so a kick plays the
 * punch row, the boot landing on the punch's own impact frame.
 */
export class RoosterKickMotion {
  private framesIn = -1;

  get active(): boolean {
    return this.framesIn >= 0;
  }

  /** Where through the punch row the kick is drawn, or null outside one. */
  get progress(): number | null {
    if (this.framesIn < 0) return null;
    if (this.framesIn < KICK_WINDUP_FRAMES) {
      return (this.framesIn / KICK_WINDUP_FRAMES) * ROOSTER_PUNCH_IMPACT_PROGRESS;
    }
    const recovered = (this.framesIn - KICK_WINDUP_FRAMES) / ROOSTER_PUNCH_RECOVER_FRAMES;
    return ROOSTER_PUNCH_IMPACT_PROGRESS + recovered * (1 - ROOSTER_PUNCH_IMPACT_PROGRESS);
  }

  begin(): void {
    this.framesIn = 0;
  }

  reset(): void {
    this.framesIn = -1;
  }

  /** Advances one frame; `'impact'` on the frame the boot lands, `'done'` on the last. */
  tick(): 'impact' | 'done' | 'running' | 'idle' {
    if (this.framesIn < 0) return 'idle';
    this.framesIn++;
    if (this.framesIn === KICK_WINDUP_FRAMES) return 'impact';
    if (this.framesIn >= KICK_FRAMES) {
      this.framesIn = -1;
      return 'done';
    }
    return 'running';
  }
}
