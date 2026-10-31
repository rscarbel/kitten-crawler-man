/**
 * While the party hides from a watcher, every companion walks the leader's own
 * trail, and none is stood up on a map its crawler is not on.
 *
 * - Deinonychus and the attack cow, put on the trail as a scene puts every
 *   companion while the party hides, stay within a step of the crawler they
 *   follow as she creeps from cover to cover; left to their own follow, each is
 *   caught straying further, so the bound is one only the trail keeps.
 * - The whole party on one line (the partner crawler, the cat ally,
 *   Deinonychus, a hire and the attack cow behind the steered crawler) walks
 *   in single file: each body within a step of the body ahead of it, no two
 *   on one spot, and every companion found by the mob grid where it really
 *   stands, once and only once, however far the walk carries it from where it
 *   started.
 * - A knocked-down cat ally lies where she fell rather than gliding along the
 *   line, and a knocked-out partner crawler is left lying while the
 *   companions close up behind the crawler still walking.
 * - The attack cow is never stood up beside a human crawler who is away in a
 *   split, nor caught up to where he stood: the control, with him present,
 *   shows the same reading does move her.
 */

import { PLAYER_SPEED, TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../src/core/constants';
import { PetNameBook } from '../../src/core/party/petNames';
import { createAttackCowState } from '../../src/core/state/AttackCowState';
import { createDeinonychusPetState } from '../../src/core/state/DeinonychusPetState';
import { getDeinonychusStats } from '../../src/abilities/deinonychus';
import { cameraAt, UNZOOMED } from '../../src/core/rendering/camera.js';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import type { CatAlly } from '../../src/creatures/CatAlly';
import type { Mob } from '../../src/creatures/Mob';
import { HIRELING_STUCK_FRAMES } from '../../src/creatures/mercenaries/hirelingCatchUp';
import { GameMap } from '../../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../../src/map/tileTypes';
import type { Player } from '../../src/Player';
import { AttackCowSystem } from '../../src/systems/AttackCowSystem';
import { DeinonychusSystem } from '../../src/systems/DeinonychusSystem';
import type { SystemContext } from '../../src/systems/GameSystem';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import {
  PARTY_LINE_ORDER,
  PARTY_TRAIL_SPACING_TILES,
  PartyLine,
  type PartyLinePlace,
  type TrailFollowSwitch,
} from '../../src/systems/partyTrail';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { CatAllySystem } from '../../src/systems/CatAllySystem';
import { CompanionSystem } from '../../src/systems/CompanionSystem';
import { MercenarySystem } from '../../src/systems/MercenarySystem';
import { createMercenaryRoster } from '../../src/core/party/MercenaryRoster';
import {
  getMercenaryTemplate,
  type MercenaryTemplateId,
} from '../../src/core/party/mercenaryTemplates';
import type { CatAllyId } from '../../src/core/party/partySplit';

type Check = (ok: boolean, message: string) => void;

const ROOM_W_TILES = 24;
const ROOM_H_TILES = 16;
const FLOOR_NUMBER = 3;
const DEINONYCHUS_LEVEL = 5;

/**
 * The furthest a companion on the trail may stand from the crawler it follows,
 * in tiles: one step behind, where she stood a step ago, so it hides where she hid.
 */
const HIDING_FOLLOW_BOUND_TILES = PARTY_TRAIL_SPACING_TILES;
/** Room for the trail's sub-pixel strides past the bound. */
const HIDING_FOLLOW_SLACK_TILES = 0.05;
/** How long a companion is given, once on the trail, to close the gap it starts from. */
const HIDING_SETTLE_FRAMES = WORLD_TICKS_PER_SECOND * 2;
/** Her creep from cover to cover, in tiles walked one leg after another from where she starts. */
const HIDING_CREEP_LEGS = [
  { dx: 6, dy: 0 },
  { dx: 0, dy: 4 },
  { dx: -4, dy: 0 },
  { dx: 0, dy: -3 },
] as const;
/** How long she waits behind each piece of cover before the next leg. */
const HIDING_WAIT_FRAMES = WORLD_TICKS_PER_SECOND;
const HIDING_START_TILE = { x: 6, y: 6 } as const;
/** Where the other crawler waits, out of the way: the hiding crawler is on her own, as in a split. */
const OTHER_CRAWLER_TILE = { x: ROOM_W_TILES - 2, y: ROOM_H_TILES - 2 } as const;
/** Where the cow is left for the catch-up checks: across the room from the human. */
const LEFT_BEHIND_TILE = { x: ROOM_W_TILES - 3, y: 2 } as const;

function makeRoom(): GameMap {
  const lastX = ROOM_W_TILES - 1;
  const lastY = ROOM_H_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ROOM_H_TILES }, (_, y) =>
    Array.from({ length: ROOM_W_TILES }, (_, x) => ({
      tileId: `${x}#${y}`,
      type:
        x === 0 || y === 0 || x === lastX || y === lastY
          ? FloorTypeValue.wall
          : FloorTypeValue.tile_floor,
    })),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

const COMPANION_KINDS = ['deinonychus', 'attack_cow'] as const;
type CompanionKind = (typeof COMPANION_KINDS)[number];

interface HidingScene {
  readonly ctx: SystemContext;
  /** The crawler creeping from cover to cover, whom the companion follows. */
  readonly leader: Player;
  readonly body: Mob;
  readonly trail: TrailFollowSwitch;
  /** The companion's system's frame, after the mob loop's. */
  readonly update: () => void;
}

function makeDeinonychusSystem(): DeinonychusSystem {
  const ignore = (): void => {
    // Nothing here reads XP or announcements.
  };
  const maxHp = getDeinonychusStats(DEINONYCHUS_LEVEL).maxHp;
  const system = new DeinonychusSystem(
    createDeinonychusPetState(maxHp, maxHp),
    () => DEINONYCHUS_LEVEL,
    ignore,
    () => 0,
    { post: ignore, isShowing: () => false },
    new PetNameBook(),
  );
  system.unlocked = true;
  return system;
}

function contextFor(
  human: HumanPlayer,
  cat: CatPlayer,
  leader: SystemContext['active'],
  map: GameMap,
  roster: MobRoster,
  extras: Player[],
): SystemContext {
  return {
    human,
    cat,
    active: leader,
    partner: null,
    activeIsMoving: false,
    roster,
    gameMap: map,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
    extraTargets: extras,
  };
}

/** A room with the companion's crawler on her own at the start of her creep and the companion out beside her. */
function hidingScene(kind: CompanionKind): HidingScene | null {
  const map = makeRoom();
  const roster = new MobRoster(map, new SpellSystem());
  const extras: Player[] = [];
  switch (kind) {
    case 'deinonychus': {
      const human = new HumanPlayer(OTHER_CRAWLER_TILE.x, OTHER_CRAWLER_TILE.y, TILE_SIZE);
      const cat = new CatPlayer(HIDING_START_TILE.x, HIDING_START_TILE.y, TILE_SIZE);
      cat.setMap(map);
      cat.isActive = true;
      const ctx = contextFor(human, cat, cat, map, roster, extras);
      const system = makeDeinonychusSystem();
      const body = system.summon(cat, map);
      if (body === null) return null;
      roster.add(body);
      extras.push(body);
      return { ctx, leader: cat, body, trail: system, update: () => system.update(ctx) };
    }
    case 'attack_cow': {
      const human = new HumanPlayer(HIDING_START_TILE.x, HIDING_START_TILE.y, TILE_SIZE);
      const cat = new CatPlayer(OTHER_CRAWLER_TILE.x, OTHER_CRAWLER_TILE.y, TILE_SIZE);
      cat.setMap(map);
      human.isActive = true;
      const ctx = contextFor(human, cat, human, map, roster, extras);
      const system = new AttackCowSystem(
        createAttackCowState(true),
        FLOOR_NUMBER,
        new PetNameBook(),
      );
      system.update(ctx);
      const body = system.standingCow;
      if (body === null) return null;
      extras.push(body);
      return { ctx, leader: human, body, trail: system, update: () => system.update(ctx) };
    }
    default: {
      const unhandled: never = kind;
      throw new Error(`unhandled companion ${JSON.stringify(unhandled)}`);
    }
  }
}

function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

function approach(from: number, to: number, stride: number): number {
  const gap = to - from;
  return Math.abs(gap) <= stride ? to : from + Math.sign(gap) * stride;
}

/**
 * Walks the companion's crawler from cover to cover and reports the
 * companion's farthest from her once it has settled: on her trail
 * (`onTrail`) as a scene puts it while the party hides, or left to its own follow.
 */
function farthestWhileHiding(kind: CompanionKind, onTrail: boolean): number | null {
  const scene = hidingScene(kind);
  if (scene === null) return null;
  const { ctx, leader, body } = scene;
  const mobLoop = new MobUpdateLoop();
  if (onTrail) scene.trail.setTrailFollow(new PartyLine(PARTY_TRAIL_SPACING_TILES * TILE_SIZE));
  let frame = 0;
  let farthest = 0;
  const tick = (): void => {
    mobLoop.update(ctx);
    scene.update();
    frame++;
    if (frame > HIDING_SETTLE_FRAMES) farthest = Math.max(farthest, tilesBetween(body, leader));
  };
  for (let wait = 0; wait < HIDING_SETTLE_FRAMES; wait++) tick();
  for (const leg of HIDING_CREEP_LEGS) {
    const goalX = leader.x + leg.dx * TILE_SIZE;
    const goalY = leader.y + leg.dy * TILE_SIZE;
    while (leader.x !== goalX || leader.y !== goalY) {
      leader.x = approach(leader.x, goalX, PLAYER_SPEED);
      leader.y = approach(leader.y, goalY, PLAYER_SPEED);
      leader.isMoving = true;
      tick();
    }
    leader.isMoving = false;
    for (let wait = 0; wait < HIDING_WAIT_FRAMES; wait++) tick();
  }
  return body.isAlive ? farthest : null;
}

function checkEveryCompanionHidesTogether(check: Check): void {
  const bound = HIDING_FOLLOW_BOUND_TILES + HIDING_FOLLOW_SLACK_TILES;
  for (const kind of COMPANION_KINDS) {
    const onTrail = farthestWhileHiding(kind, true);
    check(
      onTrail !== null && onTrail <= bound,
      `${kind} on the trail stays within ${HIDING_FOLLOW_BOUND_TILES} tile of the crawler it follows as she creeps cover to cover (${onTrail?.toFixed(2) ?? 'not out'} at most)`,
    );
    const loose = farthestWhileHiding(kind, false);
    check(
      loose !== null && loose > bound,
      `${kind} left to its own follow strays past ${HIDING_FOLLOW_BOUND_TILES} tile, so the bound is the trail's to keep (${loose?.toFixed(2) ?? 'not out'} at most)`,
    );
  }
}

// ── The whole party on one line ──────────────────────────────────────────────

const LINE_HIRE: MercenaryTemplateId = 'crush';
const LINE_HIRE_FLOOR = 'level3';
const LINE_CAT_ALLY: CatAllyId = 'tower_cattery_cellmate';
/** Closer than this, two bodies on the line are standing on one another. */
const LINE_APART_MIN_TILES = PARTY_TRAIL_SPACING_TILES / 2;
/** How many times the line walks the creep: far enough to carry every body many grid cells from where it started. */
const LINE_CREEP_LAPS = 3;
/** The companions behind the partner crawler on a full line. */
const LINE_COMPANION_COUNT = PARTY_LINE_ORDER.length - 1;
/**
 * Past this from the crawler still walking, a companion has been left parked
 * by a knocked-out partner: closed up behind him, the last is that many links back.
 */
const PARKED_BY_PARTNER_TILES =
  LINE_COMPANION_COUNT * PARTY_TRAIL_SPACING_TILES + HIDING_FOLLOW_SLACK_TILES;
/** The cat ally's last point of health, where a blow knocks her down rather than further. */
const ALLY_KNOCKDOWN_HP = 1;
/**
 * How far a downed cat ally may drift while she lies there. The bodies
 * closing up past her jostle her a little; walking the line would carry her a
 * whole link and more.
 */
const DOWNED_DRIFT_TILES = PARTY_TRAIL_SPACING_TILES / 2;
/** The first lap unfolds the line from the bunch it starts in; only after it does every body stand a link apart. */
const LINE_UNFOLD_LAPS = 1;

type LineCompanionPlace = Exclude<PartyLinePlace, 'partner_crawler'>;

interface LineParty {
  readonly ctx: SystemContext;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly roster: MobRoster;
  /** Every body on the line, by its place; the partner crawler is the cat. */
  readonly companions: Readonly<Record<LineCompanionPlace, Mob>>;
  readonly ally: CatAlly;
  /** One world frame: the mob loop, then each system in the order a scene runs them. */
  readonly tick: () => void;
}

/** The human steering with the cat as his partner, and one of every companion out beside them, all on one line. */
function partyOnLine(): LineParty | null {
  const map = makeRoom();
  const roster = new MobRoster(map, new SpellSystem());
  const extras: Player[] = [];
  const human = new HumanPlayer(HIDING_START_TILE.x, HIDING_START_TILE.y, TILE_SIZE);
  const cat = new CatPlayer(HIDING_START_TILE.x, HIDING_START_TILE.y + 1, TILE_SIZE);
  cat.setMap(map);
  human.isActive = true;
  const ctx: SystemContext = {
    ...contextFor(human, cat, human, map, roster, extras),
    partner: cat,
  };

  const partnerSystem = new CompanionSystem(map, HIDING_START_TILE.x, HIDING_START_TILE.y);
  const hireRoster = createMercenaryRoster();
  hireRoster.floorLevelId = LINE_HIRE_FLOOR;
  hireRoster.active = {
    id: LINE_HIRE,
    name: getMercenaryTemplate(LINE_HIRE).name,
    terms: 'paid',
    contract: { kind: 'floor', levelId: LINE_HIRE_FLOOR },
    introduced: true,
  };
  const hireSystem = new MercenarySystem(hireRoster, null);
  const deinonychusSystem = makeDeinonychusSystem();
  const cowSystem = new AttackCowSystem(
    createAttackCowState(true),
    FLOOR_NUMBER,
    new PetNameBook(),
  );
  const allySystem = new CatAllySystem(LINE_CAT_ALLY);
  allySystem.followCrawler('human');

  hireSystem.update(ctx);
  cowSystem.update(ctx);
  const hire = hireSystem.activeMerc;
  const deinonychus = deinonychusSystem.summon(cat, map);
  const cow = cowSystem.standingCow;
  const ally = allySystem.bringOut(human, map, roster);
  if (hire === null || deinonychus === null || cow === null || ally === null) return null;
  roster.add(deinonychus);
  extras.push(hire, deinonychus, cow, ally);

  const line = new PartyLine(PARTY_TRAIL_SPACING_TILES * TILE_SIZE);
  const switches: TrailFollowSwitch[] = [
    partnerSystem,
    allySystem,
    deinonychusSystem,
    hireSystem,
    cowSystem,
  ];
  for (const system of switches) system.setTrailFollow(line);
  const mobLoop = new MobUpdateLoop();
  return {
    ctx,
    human,
    cat,
    roster,
    companions: { cat_ally: ally, deinonychus, hire, attack_cow: cow },
    ally,
    tick: () => {
      mobLoop.update(ctx);
      partnerSystem.update(ctx);
      allySystem.update(ctx);
      deinonychusSystem.update(ctx);
      hireSystem.update(ctx);
      cowSystem.update(ctx);
    },
  };
}

/** The bodies of the line front to back, the steered crawler first, leaving out any that are not walking it. */
function lineFrontToBack(party: LineParty): Player[] {
  const bodies: Player[] = [party.human];
  for (const place of PARTY_LINE_ORDER) {
    const body = place === 'partner_crawler' ? party.cat : party.companions[place];
    if (body.isKnockedOut) continue;
    bodies.push(body);
  }
  return bodies;
}

/** Walks the steered crawler through the creep `laps` times, calling `afterFrame` after every frame. */
function walkTheCreep(
  leader: Player,
  laps: number,
  tick: () => void,
  afterFrame: () => void,
): void {
  const frame = (): void => {
    tick();
    afterFrame();
  };
  for (let lap = 0; lap < laps; lap++) {
    for (const leg of HIDING_CREEP_LEGS) {
      const goalX = leader.x + leg.dx * TILE_SIZE;
      const goalY = leader.y + leg.dy * TILE_SIZE;
      while (leader.x !== goalX || leader.y !== goalY) {
        leader.x = approach(leader.x, goalX, PLAYER_SPEED);
        leader.y = approach(leader.y, goalY, PLAYER_SPEED);
        leader.isMoving = true;
        frame();
      }
      leader.isMoving = false;
      for (let wait = 0; wait < HIDING_WAIT_FRAMES; wait++) frame();
    }
  }
}

interface LineReading {
  /** Each body's farthest from the body ahead of it, by its index behind the steered crawler. */
  readonly farthestLinkTiles: number[];
  /** The nearest any two bodies on the line came to each other, once it had unfolded. */
  nearestPairTiles: number;
  /** The first companion the grid did not find where it stood, or found more than once. */
  lostInGrid: string | null;
}

function readLine(party: LineParty, reading: LineReading, unfolded: boolean): void {
  const bodies = lineFrontToBack(party);
  for (let i = 1; i < bodies.length; i++) {
    const link = tilesBetween(bodies[i], bodies[i - 1]);
    reading.farthestLinkTiles[i - 1] = Math.max(reading.farthestLinkTiles[i - 1] ?? 0, link);
    if (!unfolded) continue;
    for (let j = 0; j < i; j++) {
      reading.nearestPairTiles = Math.min(
        reading.nearestPairTiles,
        tilesBetween(bodies[i], bodies[j]),
      );
    }
  }
  if (reading.lostInGrid !== null) return;
  const everywhere = party.roster.grid.queryRect(
    0,
    0,
    ROOM_W_TILES * TILE_SIZE,
    ROOM_H_TILES * TILE_SIZE,
  );
  for (const [place, body] of Object.entries(party.companions)) {
    const here = party.roster.grid.queryRect(body.x, body.y, TILE_SIZE, TILE_SIZE);
    const entries = everywhere.filter((indexed) => indexed === body).length;
    if (!here.includes(body) || entries !== 1) {
      reading.lostInGrid = `${place} at (${(body.x / TILE_SIZE).toFixed(1)}, ${(body.y / TILE_SIZE).toFixed(1)}), indexed ${entries} time(s)`;
      return;
    }
  }
}

function checkWholePartyWalksInSingleFile(check: Check): void {
  const party = partyOnLine();
  check(party !== null, 'the whole party is out beside the crawlers for the line');
  if (party === null) return;
  for (let wait = 0; wait < HIDING_SETTLE_FRAMES; wait++) party.tick();
  const reading: LineReading = {
    farthestLinkTiles: [],
    nearestPairTiles: Number.POSITIVE_INFINITY,
    lostInGrid: null,
  };
  walkTheCreep(party.human, LINE_UNFOLD_LAPS, party.tick, () => readLine(party, reading, false));
  walkTheCreep(party.human, LINE_CREEP_LAPS, party.tick, () => readLine(party, reading, true));
  const bound = HIDING_FOLLOW_BOUND_TILES + HIDING_FOLLOW_SLACK_TILES;
  const places = ['partner crawler', ...PARTY_LINE_ORDER.slice(1)];
  places.forEach((place, index) => {
    const farthest = reading.farthestLinkTiles[index];
    check(
      farthest !== undefined && farthest <= bound,
      `the ${place} on the party's line stays within ${HIDING_FOLLOW_BOUND_TILES} tile of the body ahead of it (${farthest?.toFixed(2) ?? 'not out'} at most)`,
    );
  });
  check(
    reading.nearestPairTiles >= LINE_APART_MIN_TILES,
    `no two bodies on the party's line stand on one another (${reading.nearestPairTiles.toFixed(2)} tiles at the nearest)`,
  );
  check(
    reading.lostInGrid === null,
    `every companion walking the line is found by the mob grid where it stands, once (${reading.lostInGrid ?? 'all found'})`,
  );
}

function checkDownedAllyLiesStill(check: Check): void {
  const party = partyOnLine();
  if (party === null) return;
  for (let wait = 0; wait < HIDING_SETTLE_FRAMES; wait++) party.tick();
  const ally = party.ally;
  ally.hp = ALLY_KNOCKDOWN_HP;
  party.tick();
  const fellX = ally.x;
  const fellY = ally.y;
  let drift = 0;
  walkTheCreep(party.human, 1, party.tick, () => {
    if (ally.isDowned) drift = Math.max(drift, tilesBetween(ally, { x: fellX, y: fellY }));
  });
  check(
    drift <= DOWNED_DRIFT_TILES,
    `a knocked-down cat ally lies where she fell while the line walks on (${drift.toFixed(2)} tiles moved)`,
  );
}

function checkKnockedOutPartnerIsLeftLying(check: Check): void {
  const party = partyOnLine();
  if (party === null) return;
  for (let wait = 0; wait < HIDING_SETTLE_FRAMES; wait++) party.tick();
  party.cat.isKnockedOut = true;
  for (let wait = 0; wait < HIDING_SETTLE_FRAMES; wait++) party.tick();
  let farthest = 0;
  walkTheCreep(party.human, 1, party.tick, () => {
    for (const body of Object.values(party.companions)) {
      farthest = Math.max(farthest, tilesBetween(body, party.human));
    }
  });
  check(
    farthest <= PARKED_BY_PARTNER_TILES,
    `with the partner crawler knocked out, the companions close up behind the crawler still walking (${farthest.toFixed(2)} tiles at the farthest, ${PARKED_BY_PARTNER_TILES.toFixed(2)} allowed)`,
  );
}

/** Whether a cow left stuck across the room is moved by her system's frame, with the human present or away. */
function cowCaughtUp(humanAway: boolean): boolean | null {
  const map = makeRoom();
  const roster = new MobRoster(map, new SpellSystem());
  const human = new HumanPlayer(HIDING_START_TILE.x, HIDING_START_TILE.y, TILE_SIZE);
  const cat = new CatPlayer(OTHER_CRAWLER_TILE.x, OTHER_CRAWLER_TILE.y, TILE_SIZE);
  cat.setMap(map);
  human.isActive = true;
  const ctx = contextFor(human, cat, human, map, roster, []);
  const system = new AttackCowSystem(createAttackCowState(true), FLOOR_NUMBER, new PetNameBook());
  system.update(ctx);
  const cow = system.standingCow;
  if (cow === null) return null;
  const previousX = cow.x;
  const previousY = cow.y;
  cow.x = LEFT_BEHIND_TILE.x * TILE_SIZE;
  cow.y = LEFT_BEHIND_TILE.y * TILE_SIZE;
  roster.grid.move(cow, previousX, previousY);
  cow.followStallFrames = HIRELING_STUCK_FRAMES;
  human.bindPresence(() => !humanAway);
  const leftAtX = cow.x;
  const leftAtY = cow.y;
  system.update(ctx);
  return cow.x !== leftAtX || cow.y !== leftAtY;
}

function checkCowStaysOffAnAwayHumansMap(check: Check): void {
  const map = makeRoom();
  const roster = new MobRoster(map, new SpellSystem());
  const human = new HumanPlayer(HIDING_START_TILE.x, HIDING_START_TILE.y, TILE_SIZE);
  const cat = new CatPlayer(OTHER_CRAWLER_TILE.x, OTHER_CRAWLER_TILE.y, TILE_SIZE);
  cat.setMap(map);
  cat.isActive = true;
  human.bindPresence(() => false);
  const ctx = contextFor(human, cat, cat, map, roster, []);
  const system = new AttackCowSystem(createAttackCowState(true), FLOOR_NUMBER, new PetNameBook());
  system.update(ctx);
  check(
    system.cow === null && roster.mobs.length === 0,
    'the attack cow is not stood up on the map of a split whose human crawler is away',
  );

  const presentCatchUp = cowCaughtUp(false);
  check(
    presentCatchUp === true,
    `a stuck attack cow is caught up to the human crawler while he is here (${String(presentCatchUp)})`,
  );
  const awayCatchUp = cowCaughtUp(true);
  check(
    awayCatchUp === false,
    `a stuck attack cow is not caught up to where the human crawler stood once he is away (${String(awayCatchUp)})`,
  );
}

export function checkHidingTrail(check: Check): void {
  checkEveryCompanionHidesTogether(check);
  checkWholePartyWalksInSingleFile(check);
  checkDownedAllyLiesStill(check);
  checkKnockedOutPartnerIsLeftLying(check);
  checkCowStaysOffAnAwayHumansMap(check);
}
