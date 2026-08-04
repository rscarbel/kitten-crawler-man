import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import { hasRoomToMove } from '../map/findWalkableTile';
import { EvilClown } from '../creatures/EvilClown';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { CircusLemur } from '../creatures/CircusLemur';
import { Mantid } from '../creatures/Mantid';
import { MantisCrony } from '../creatures/MantisCrony';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { SkeletonWarrior } from '../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { DarkKnight } from '../creatures/DarkKnight';
import { Goblin } from '../creatures/Goblin';
import { RockGolem } from '../creatures/RockGolem';
import { RockGolemBoss } from '../creatures/RockGolemBoss';
import type { GoblinWeapon } from '../sprites/goblinSprite';
import { TILE_SIZE } from '../core/constants';

/** The mobs a bounty encounter puts on the map: one named target plus its escort. */
export interface BountyEncounter {
  boss: Mob;
  minions: Mob[];
}

export interface BountyDef {
  /** Stable registry key, also the key into BountyProgress's per-type name pools. */
  id: string;
  /** Shown on the notice board and in dialog, e.g. "the Mantid". */
  typeLabel: string;
  /** 5–10 unique bounty names; copied + shuffled into BountyProgress. */
  names: readonly string[];
  /**
   * Builds the whole encounter at a site.
   *
   * Implementations must `setMap()` every mob they create. They must NOT push
   * into `mobs`/`mobGrid`, and they must NOT call `applyMobLevel` — BountySystem
   * owns insertion, level scaling and the bounty flags, and applies all three
   * uniformly so a new bounty creature cannot forget any of them.
   *
   * `Mob.applyMobLevel` multiplies its stats off their *current* values rather
   * than off a stored base, so a def that scaled its own mobs would ship an
   * encounter with compounded HP and speed — which reads as a tuning problem,
   * not as a bug. `level` is passed only so a def can size the encounter itself
   * by it (how many minions, which loadout).
   *
   * One thing a def's *classes* do owe: their idle branch should call
   * `returnHomeOrWander()` rather than `doWander()`. BountySystem anchors an
   * un-aggroed encounter to its site with `homePoint`/`leashRadiusTiles`, and
   * only those two methods consult them — a class that plain-wanders drifts off
   * the site the player was sent to.
   */
  spawn(siteTileX: number, siteTileY: number, map: GameMap, level: number): BountyEncounter;
}

/**
 * Where each member of the Evil Clown's troupe stands relative to the site, in
 * tiles. Spread rather than stacked so the encounter is legible the moment the
 * player crests the rise, and so the escort does not all path through one gap.
 */
const CLOWN_TROUPE: ReadonlyArray<{
  readonly dx: number;
  readonly dy: number;
  readonly make: (tileX: number, tileY: number) => Mob;
}> = [
  { dx: -3, dy: -2, make: (x, y) => new StiltClown(x, y, TILE_SIZE) },
  { dx: 3, dy: -2, make: (x, y) => new StiltClown(x, y, TILE_SIZE) },
  { dx: -3, dy: 2, make: (x, y) => new FatClown(x, y, TILE_SIZE) },
  { dx: 3, dy: 2, make: (x, y) => new FatClown(x, y, TILE_SIZE) },
  { dx: 0, dy: 4, make: (x, y) => new CircusLemur(x, y, TILE_SIZE) },
];

/**
 * The Evil Clown and four of Grimaldi's survivors, plus one lemur.
 *
 * The escort is reused wholesale from the circus — zero new minion art — and is
 * chosen for the shape of the fight rather than for flavour: the fat clown
 * bodies the player off the boss, the stilt clown reaches over it, and the
 * lemur throws knives from range, so backing out of the gas is never simply
 * safe. (The plan left the lemur optional; it is in, because without a ranged
 * threat the whole encounter can be kited in a circle around the clouds.)
 */
const EVIL_CLOWN_DEF: BountyDef = {
  id: 'evil_clown',
  typeLabel: 'the Evil Clown',
  names: [
    'Giggles',
    'Honk',
    'Jangles',
    'Grinner',
    'Sniggles',
    'Tumbles',
    'Bubbles',
    'Mister Merriment',
  ],
  spawn(siteTileX, siteTileY, map) {
    const boss = new EvilClown(siteTileX, siteTileY, TILE_SIZE);
    boss.setMap(map);

    // The boss's own tile is claimed up front so no rescued minion lands inside him.
    const claimed = new Set<string>([tileKey(siteTileX, siteTileY)]);
    const escort = CLOWN_TROUPE.map((member) => {
      const tile = placeNearSite(map, siteTileX, siteTileY, member.dx, member.dy, claimed);
      const minion = member.make(tile.x, tile.y);
      minion.setMap(map);
      return minion;
    });

    return { boss, minions: escort };
  },
};

/**
 * Where the two crony mantises stand relative to the Mantid, in tiles.
 *
 * Flanking rather than in front: they are meant to close from the sides while
 * the player is watching the thing in the middle, and a stack in front of the
 * boss would simply be a wall the player fights through first.
 */
const MANTIS_FLANK_OFFSETS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: -3, dy: 1 },
  { dx: 3, dy: 1 },
];

/**
 * The Mantid and two crony mantises.
 *
 * A small escort on purpose. The boss's rage cycle already asks the player to
 * give up their position for four seconds at a time, and every extra body on the
 * field is one more thing between them and the space they have to retreat into.
 */
const MANTID_DEF: BountyDef = {
  id: 'mantid',
  typeLabel: 'the Mantid',
  names: ['Slice', 'Scythe', 'Snips', 'Thresher', 'Sickle', 'Mandible', 'Vesper', 'Cleaver'],
  spawn(siteTileX, siteTileY, map) {
    const boss = new Mantid(siteTileX, siteTileY, TILE_SIZE);
    boss.setMap(map);

    // The boss's own tile is claimed up front so no rescued minion lands inside him.
    const claimed = new Set<string>([tileKey(siteTileX, siteTileY)]);
    const escort = MANTIS_FLANK_OFFSETS.map((offset) => {
      const tile = placeNearSite(map, siteTileX, siteTileY, offset.dx, offset.dy, claimed);
      const minion = new MantisCrony(tile.x, tile.y, TILE_SIZE);
      minion.setMap(map);
      return minion;
    });

    return { boss, minions: escort };
  },
};

/**
 * Where the Skeleton Lord's opening escort stands, in tiles.
 *
 * The two swordsmen ahead of him and the archer behind: he fights from a
 * mid-range band and needs bodies between himself and whatever closes, while the
 * archer is the reason standing off and trading is not free either. He summons
 * this same mix again on a cadence, so the opening formation is also the shape
 * the player learns to break.
 */
const SKELETON_ESCORT: ReadonlyArray<{
  readonly dx: number;
  readonly dy: number;
  readonly make: (tileX: number, tileY: number) => Mob;
}> = [
  { dx: -2, dy: 2, make: (x, y) => new SkeletonWarrior(x, y, TILE_SIZE) },
  { dx: 2, dy: 2, make: (x, y) => new SkeletonWarrior(x, y, TILE_SIZE) },
  { dx: 0, dy: -2, make: (x, y) => new SkeletonArcher(x, y, TILE_SIZE) },
];

/** The Skeleton Lord, two sword skeletons and one archer. */
const SKELETON_LORD_DEF: BountyDef = {
  id: 'skeleton_lord',
  typeLabel: 'the Skeleton Lord',
  names: [
    'Marrow',
    'Ossian',
    'Rattlejack',
    'Gravelow',
    'Hollowcrown',
    'Knuckles',
    'Dustwight',
    'Phalanx',
  ],
  spawn(siteTileX, siteTileY, map) {
    const boss = new SkeletonLord(siteTileX, siteTileY, TILE_SIZE);
    boss.setMap(map);

    // The boss's own tile is claimed up front so no rescued minion lands inside him.
    const claimed = new Set<string>([tileKey(siteTileX, siteTileY)]);
    const escort = SKELETON_ESCORT.map((member) => {
      const tile = placeNearSite(map, siteTileX, siteTileY, member.dx, member.dy, claimed);
      const minion = member.make(tile.x, tile.y);
      minion.setMap(map);
      return minion;
    });

    return { boss, minions: escort };
  },
};

/** How many goblins march with the Dark Knight. */
const DARK_KNIGHT_GOBLIN_COUNT = 10;
/** Radius of the disc his screening force is scattered over, in tiles. */
const DARK_KNIGHT_GOBLIN_SPREAD_TILES = 6;
/** Attempts to find a walkable tile for one goblin before giving up on it. */
const GOBLIN_PLACEMENT_ATTEMPTS = 24;
/**
 * The four goblin archetypes, dealt round-robin so the screen is a mixed line
 * rather than ten copies of one silhouette.
 */
const GOBLIN_WEAPONS: ReadonlyArray<GoblinWeapon> = ['sword', 'axe', 'mace', 'warhammer'];

/**
 * The tile a def actually gets for an intended offset.
 *
 * A site only guarantees that ~80% of the tiles within its clearance disc are
 * open ground, so a fixed offset lands on the other 20% often enough to matter —
 * measured at 4 of 416 staged mobs across two generated maps, all of them
 * embedded in a tree or a boulder. A mob spawned on a blocked tile has a blocked
 * A* origin, so `findPath` returns nothing and it spends the whole fight in
 * collide-follow.
 *
 * The intended offset is tried first and kept whenever it works, so a def's
 * formation stays the formation its author drew; the spiral is only a rescue.
 */
function placeNearSite(
  map: GameMap,
  siteTileX: number,
  siteTileY: number,
  offsetX: number,
  offsetY: number,
  claimed: Set<string>,
): { x: number; y: number } {
  const take = (x: number, y: number): { x: number; y: number } => {
    claimed.add(tileKey(x, y));
    return { x, y };
  };
  const wanted = { x: siteTileX + offsetX, y: siteTileY + offsetY };
  const isFree = (x: number, y: number): boolean => !claimed.has(tileKey(x, y));

  // Two passes, the first demanding somewhere the minion can actually move. A
  // bounty site only has to be 80% open, so its remaining fifth is real
  // scenery — and a gap between two trunks passes `isWalkable` while leaving
  // its occupant able to do nothing but shuffle on the spot.
  for (const needsRoom of [true, false]) {
    const isUsable = (x: number, y: number): boolean =>
      isFree(x, y) && map.isWalkable(x, y) && (!needsRoom || hasRoomToMove(map, x, y));

    if (isUsable(wanted.x, wanted.y)) return take(wanted.x, wanted.y);
    for (let ring = 1; ring <= PLACEMENT_RESCUE_RINGS; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const x = wanted.x + dx;
          const y = wanted.y + dy;
          if (isUsable(x, y)) return take(x, y);
        }
      }
    }
  }
  // Every tile around the intended spot is blocked or taken. Standing the mob on
  // the site itself is worse than standing it where the def asked, so the offset
  // wins — and it is still claimed, so the next minion does not pile onto it too.
  return take(wanted.x, wanted.y);
}

/**
 * A spawn tile as a set key.
 *
 * The rescue spiral has to know what the encounter has already taken, or it
 * happily hands the same tile to two minions — or hands a minion the boss's own
 * tile, since every def's offsets are inside the boss's rescue radius. That is
 * the identical bug the Dark Knight's goblin placement was fixed for.
 */
function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** How far the rescue search spirals before giving the intended offset back. */
const PLACEMENT_RESCUE_RINGS = 3;

/**
 * A free tile inside the site's disc, sampled uniformly over its area.
 *
 * `claimed` is what stops a ten-mob escort stacking two of its members on one
 * tile: an unremembering random draw does that often enough to see, and two
 * goblins sharing a tile push each other apart on the first frame with no
 * explanation the player can read.
 */
function findWalkableTileNearSite(
  map: GameMap,
  centreX: number,
  centreY: number,
  radiusTiles: number,
  claimed: Set<string>,
): { x: number; y: number } | null {
  // As in `placeNearSite`: draw for somewhere with room to move first, and only
  // settle for bare walkability once those draws are spent.
  for (const needsRoom of [true, false]) {
    for (let attempt = 0; attempt < GOBLIN_PLACEMENT_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.sqrt(Math.random()) * radiusTiles;
      const tx = Math.round(centreX + Math.cos(angle) * reach);
      const ty = Math.round(centreY + Math.sin(angle) * reach);
      const key = tileKey(tx, ty);
      if (claimed.has(key)) continue;
      if (!map.isWalkable(tx, ty)) continue;
      if (needsRoom && !hasRoomToMove(map, tx, ty)) continue;
      claimed.add(key);
      return { x: tx, y: ty };
    }
  }
  return null;
}

/**
 * The Dark Knight and ten goblins.
 *
 * The escort is deliberately large and deliberately cheap: ten goblins at the
 * party's own level are a screen the player has to break *while* a telegraphed
 * slam is landing somewhere behind them, which is the whole shape of this
 * fight. They are scattered over the site's disc rather than lined up, so the
 * encounter is a crowd to wade into rather than a wall to fight through.
 */
const DARK_KNIGHT_DEF: BountyDef = {
  id: 'dark_knight',
  typeLabel: 'the Dark Knight',
  names: [
    'Blackgard',
    'Grimhelm',
    'Sir Craven',
    'Dreadmarch',
    'Rustmourn',
    'Vane',
    'Ironwake',
    'Sir Malloch',
  ],
  spawn(siteTileX, siteTileY, map) {
    const boss = new DarkKnight(siteTileX, siteTileY, TILE_SIZE);
    boss.setMap(map);

    const escort: Mob[] = [];
    // The knight's own tile is claimed up front so no goblin is placed inside him.
    const claimed = new Set<string>([tileKey(siteTileX, siteTileY)]);
    for (let i = 0; i < DARK_KNIGHT_GOBLIN_COUNT; i++) {
      const tile = findWalkableTileNearSite(
        map,
        siteTileX,
        siteTileY,
        DARK_KNIGHT_GOBLIN_SPREAD_TILES,
        claimed,
      );
      // A site whose disc has no room left simply fields a smaller screen —
      // stacking the rest on the knight's own tile would be worse than missing.
      if (tile === null) continue;
      const weapon = GOBLIN_WEAPONS[i % GOBLIN_WEAPONS.length];
      const goblin = new Goblin(tile.x, tile.y, TILE_SIZE, weapon);
      goblin.setMap(map);
      escort.push(goblin);
    }

    return { boss, minions: escort };
  },
};

/** Tiles the golem's bodyguard stands from its master. */
const GOLEM_BODYGUARD_OFFSET_TILES = 2;

/**
 * The Rock Golem and one ordinary golem as its bodyguard.
 *
 * The smallest escort of any bounty, and deliberately so: the boulder roll needs
 * open ground to be readable and dodgeable, and the counterplay the fight is
 * built around — dropping gym equipment in the charge lane — only works if the
 * player has room to place it. A crowd would turn the roll from a telegraph into
 * an ambush.
 */
const ROCK_GOLEM_DEF: BountyDef = {
  id: 'rock_golem',
  typeLabel: 'the Rock Golem',
  names: ['Rubble', 'Crag', 'Basalt', 'Cobble', 'Scree', 'Shale', 'Granite', 'Knapper'],
  spawn(siteTileX, siteTileY, map) {
    const boss = new RockGolemBoss(siteTileX, siteTileY, TILE_SIZE);
    boss.setMap(map);
    const claimed = new Set<string>([tileKey(siteTileX, siteTileY)]);
    const guardTile = placeNearSite(
      map,
      siteTileX,
      siteTileY,
      GOLEM_BODYGUARD_OFFSET_TILES,
      0,
      claimed,
    );
    const bodyguard = new RockGolem(guardTile.x, guardTile.y, TILE_SIZE);
    bodyguard.setMap(map);
    return { boss, minions: [bodyguard] };
  },
};

/**
 * Every bounty type Shady can issue.
 *
 * A `debug_ghoul` stand-in lived here while the real bosses were being built, so
 * the loop was exercisable before any of them existed. It was removed once all
 * five landed — `npm run verify:bounty` now builds a real encounter from every
 * entry in this array, so there is nothing left for a placeholder to cover.
 */
export const BOUNTY_DEFS: readonly BountyDef[] = [
  EVIL_CLOWN_DEF,
  MANTID_DEF,
  SKELETON_LORD_DEF,
  DARK_KNIGHT_DEF,
  ROCK_GOLEM_DEF,
];

export function findBountyDef(id: string): BountyDef | null {
  return BOUNTY_DEFS.find((def) => def.id === id) ?? null;
}
