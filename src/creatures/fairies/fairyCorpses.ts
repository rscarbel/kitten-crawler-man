/**
 * The dead a necro fairy may raise, and the one rule for which of them it may.
 *
 * `FairySystem` owns the ledger — it hears every `mobKilled` — and publishes it
 * each frame through {@link setFairyCorpseLedger}, the same way `MobUpdateLoop`
 * publishes the mob grid for pack alerts, so a creature can ask "who can I
 * raise?" without holding a reference to a system.
 */

import type { GameMap } from '../../map/GameMap';
import { TILE_SIZE } from '../../core/constants';
import type { Mob } from '../Mob';
import { BrindleGrub } from '../BrindleGrub';
import { Fairy } from './Fairy';
import { RESURRECT_RANGE_TILES } from './fairyTuning';

/** One death: who, and where it fell (tile centre, world pixels). */
export interface FairyCorpse {
  readonly mob: Mob;
  readonly x: number;
  readonly y: number;
}

/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;

/**
 * The deaths a necromancer could still act on. A corpse never ages out: it is
 * dropped only when it stands back up or leaves the scene's mob list, so the
 * ledger holds no more than the floor's raisable dead.
 */
export class FairyCorpseLedger {
  private readonly corpses: FairyCorpse[] = [];

  get entries(): readonly FairyCorpse[] {
    return this.corpses;
  }

  /** Notes a death. A kind that can never be raised is not recorded at all. */
  record(mob: Mob): void {
    if (!isRaisableKind(mob)) return;
    this.forget(mob);
    this.corpses.push({
      mob,
      x: mob.x + TILE_SIZE * TILE_CENTRE,
      y: mob.y + TILE_SIZE * TILE_CENTRE,
    });
  }

  /** Drops every corpse back on its feet. */
  dropStanding(): void {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      if (this.corpses[i].mob.isAlive) this.corpses.splice(i, 1);
    }
  }

  /**
   * Drops every corpse no longer in `roster`: a body the scene has let go of
   * would, raised, fight on unseen by every system that walks the mobs.
   */
  dropMissing(roster: readonly Mob[]): void {
    if (this.corpses.length === 0) return;
    const present = new Set(roster);
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      if (!present.has(this.corpses[i].mob)) this.corpses.splice(i, 1);
    }
  }

  forget(mob: Mob): void {
    const index = this.corpses.findIndex((corpse) => corpse.mob === mob);
    if (index >= 0) this.corpses.splice(index, 1);
  }

  /** Forgets every death: a checkpoint rewind brought the dead back or removed them. */
  clear(): void {
    this.corpses.length = 0;
  }
}

/**
 * Kinds that may ever be raised: a hostile that is neither a boss, a boss's
 * add, a summon, a fairy nor a brindle grub (at any stage of its evolution),
 * and has not already been raised once. Raising a boss or its adds would undo
 * or rewrite a fight; raising a summon or a fairy would let casters farm each
 * other; and a body that has already come back once stays down.
 */
function isRaisableKind(mob: Mob): boolean {
  const partOfABossFight = mob.isBoss || mob.isBossAdd;
  return (
    mob.isHostile &&
    !partOfABossFight &&
    !mob.isSummon &&
    !mob.wasResurrected &&
    !(mob instanceof Fairy) &&
    !(mob instanceof BrindleGrub)
  );
}

/**
 * Whether `caster` may raise `corpse` now: still dead, however long ago it
 * fell, within {@link RESURRECT_RANGE_TILES} of the caster, and in its line of
 * sight on `map`.
 */
export function isCorpseResurrectable(
  corpse: FairyCorpse,
  caster: Mob,
  map: GameMap | null,
): boolean {
  const { mob } = corpse;
  if (mob.isAlive || !isRaisableKind(mob)) return false;
  const casterX = caster.x + TILE_SIZE * TILE_CENTRE;
  const casterY = caster.y + TILE_SIZE * TILE_CENTRE;
  const rangePx = TILE_SIZE * RESURRECT_RANGE_TILES;
  if (Math.hypot(corpse.x - casterX, corpse.y - casterY) > rangePx) return false;
  return map === null || map.hasLineOfSight(casterX, casterY, corpse.x, corpse.y);
}

let publishedLedger: FairyCorpseLedger | null = null;

/** Called by the corpse ledger's owner every frame it runs, and with null when it is torn down. */
export function setFairyCorpseLedger(ledger: FairyCorpseLedger | null): void {
  publishedLedger = ledger;
}

/** The published ledger, if the scene has one. */
export function fairyCorpseLedger(): FairyCorpseLedger | null {
  return publishedLedger;
}

/** Fills `out` with every corpse `caster` may raise now. Empty when no ledger is published. */
export function collectResurrectableCorpses(
  caster: Mob,
  map: GameMap | null,
  out: FairyCorpse[],
): void {
  out.length = 0;
  const ledger = publishedLedger;
  if (ledger === null) return;
  for (const corpse of ledger.entries) {
    if (isCorpseResurrectable(corpse, caster, map)) out.push(corpse);
  }
}
