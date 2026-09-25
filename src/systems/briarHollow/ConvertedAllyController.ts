/**
 * ConvertedAllyController — the enemies a level-15 snare has turned to the
 * party's side, for as long as their borrowed loyalty lasts.
 *
 * A converted mob keeps its own AI; what changes is what that AI is handed.
 * Every frame this gives each ally the nearest hostile within
 * {@link CONVERTED_AGGRO_TILES} as its only target (through
 * `Mob.allyTargets`, which `MobUpdateLoop` reads in place of the party), and
 * with nothing to fight it rallies back to the crawler who turned it. Its
 * blows land in its own name and credit its converter, the way the party's
 * pet's do.
 *
 * It lives until something kills it or {@link CONVERTED_ALLY_LIFETIME_FRAMES}
 * runs out; then it crumbles — undead to dust, anything else in a wisp — and
 * leaves the world with no loot and no kill, because it was never the party's
 * to kill.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Player } from '../../Player';
import type { Mob } from '../../creatures/Mob';
import { RaisedRatkin } from '../../creatures/RaisedRatkin';
import { isUndeadConvertible } from '../../creatures/convertibleMobs';
import type { MobRoster } from '../kits/SceneWorld';
import type { AudioManager } from '../../audio/AudioManager';
import { UPDATES_PER_SECOND } from './structureRules';
import { drawConvertFlash, drawCrumble, drawPartyMarker } from '../../sprites/art/siegeEffectsArt';

/** A converted ally picks fights with hostiles this close. */
export const CONVERTED_AGGRO_TILES = 8;
/** With nothing to fight, it walks back to within this of its converter. */
export const CONVERTED_RALLY_TILES = 4;
/** How long a conversion lasts before the ally crumbles. */
const CONVERTED_ALLY_LIFETIME_SECONDS = 120;
export const CONVERTED_ALLY_LIFETIME_FRAMES = CONVERTED_ALLY_LIFETIME_SECONDS * UPDATES_PER_SECOND;

const CONVERT_SOUND = 'new_unlock';
const FLASH_FRAMES = 28;
const CRUMBLE_FRAMES = 40;
/** The party mark floats this far above the top of an ally's tile. */
const MARKER_LIFT_TILES = 0.35;
const HALF_TILE = TILE_SIZE / 2;

interface ConvertedAlly {
  readonly mob: Mob;
  framesLeft: number;
}

interface SoulEffect {
  readonly x: number;
  readonly y: number;
  readonly kind: 'flash' | 'dust' | 'wisp';
  age: number;
}

export class ConvertedAllyController {
  private readonly allies: ConvertedAlly[] = [];
  private readonly effects: SoulEffect[] = [];

  constructor(
    private readonly roster: MobRoster,
    private readonly audio: AudioManager | null,
  ) {}

  /** Every ally still standing, for the scene's list of what hostiles may fight. */
  get mobs(): Mob[] {
    return this.allies.map((ally) => ally.mob);
  }

  /** Frames left on an ally's conversion, or null if it is not one of ours. */
  framesLeftFor(mob: Mob): number | null {
    return this.allies.find((ally) => ally.mob === mob)?.framesLeft ?? null;
  }

  /**
   * Turns `mob` to the side of `owner`, the crawler whose snare caught it.
   * Returns whether it turned; the caller has already checked it may.
   */
  convert(mob: Mob, owner: Player): boolean {
    mob.convertToAlly(owner);
    if (!mob.isConverted) return false;
    mob.allyRally = { anchor: owner, radiusPx: CONVERTED_RALLY_TILES * TILE_SIZE };
    this.allies.push({ mob, framesLeft: CONVERTED_ALLY_LIFETIME_FRAMES });
    this.effects.push({ x: mob.x + HALF_TILE, y: mob.y + HALF_TILE, kind: 'flash', age: 0 });
    this.audio?.play(CONVERT_SOUND);
    return true;
  }

  update(): void {
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const ally = this.allies[i];
      const { mob } = ally;
      // Killed, or rewound to before it turned: either way no longer ours.
      if (!mob.isAlive || !mob.isConverted) {
        mob.allyTargets.length = 0;
        this.allies.splice(i, 1);
        continue;
      }
      ally.framesLeft--;
      if (ally.framesLeft <= 0) {
        this.allies.splice(i, 1);
        this.crumble(mob);
        continue;
      }
      this.chooseTargets(mob);
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.age++;
      const life = effect.kind === 'flash' ? FLASH_FRAMES : CRUMBLE_FRAMES;
      if (effect.age > life) this.effects.splice(i, 1);
    }
  }

  /** The nearest hostile in reach, as the ally's only target, or none. */
  private chooseTargets(mob: Mob): void {
    const targets = mob.allyTargets;
    targets.length = 0;
    const reach = CONVERTED_AGGRO_TILES * TILE_SIZE;
    let nearest: Mob | null = null;
    let nearestDistance = reach;
    for (const other of this.roster.grid.queryCircle(mob.x, mob.y, reach)) {
      // Filtered explicitly: the roster holds the party's allies too.
      if (other === mob || !other.isAlive || !other.isHostile) continue;
      if (other.isDefendTarget === true || other.offLimitsToAllies) continue;
      const distance = Math.hypot(other.x - mob.x, other.y - mob.y);
      if (distance < nearestDistance) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    if (nearest !== null) targets.push(nearest);
  }

  /**
   * The borrowed life runs out: the ally leaves the world at once, with no
   * death to pay out. Its HP is zeroed so anything still holding a reference
   * to it (a hostile's retaliation, a camp counting its residents) sees it
   * gone, and it leaves the grid, which is what stops it being drawn. The body
   * stays in the roster, as a corpse's does, so a rewind to before it turned
   * can stand it back up.
   */
  private crumble(mob: Mob): void {
    this.effects.push({
      x: mob.x + HALF_TILE,
      y: mob.y + HALF_TILE,
      kind: isUndeadConvertible(mob) ? 'dust' : 'wisp',
      age: 0,
    });
    mob.allyTargets.length = 0;
    mob.hp = 0;
    // No death to sound and no corpse to play out: a raised ratkin would
    // otherwise squeak and tick an invisible body, and a rewind in that window
    // would put the body back on the grid.
    if (mob instanceof RaisedRatkin) mob.cues.clear();
    mob.vanish();
    this.roster.grid.remove(mob);
  }

  /** Over every body: each ally's party mark, the flash of a conversion, the crumble at its end. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const { mob } of this.allies) {
      drawPartyMarker(ctx, mob.x + HALF_TILE - camX, mob.y - MARKER_LIFT_TILES * TILE_SIZE - camY);
    }
    for (const effect of this.effects) {
      const x = effect.x - camX;
      const y = effect.y - camY;
      if (effect.kind === 'flash')
        drawConvertFlash(ctx, x, y, TILE_SIZE, effect.age / FLASH_FRAMES);
      else drawCrumble(ctx, x, y, TILE_SIZE, effect.age / CRUMBLE_FRAMES, effect.kind === 'dust');
    }
  }

  /** A door visit or a rewind: whoever was converted is judged afresh by the mobs themselves. */
  reset(): void {
    for (const { mob } of this.allies) mob.allyTargets.length = 0;
    this.allies.length = 0;
    this.effects.length = 0;
  }
}
