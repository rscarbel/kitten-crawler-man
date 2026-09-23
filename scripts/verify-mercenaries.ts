#!/usr/bin/env tsx
/**
 * Headless gate on the Meat Shields hire contract and the hireling shell.
 *
 * - The template table is whole: every id is on the desk once, with a voice,
 *   a figure and a kit behind it.
 * - Every hire survives the save: capture → JSON → parse → restore gives back
 *   exactly what was signed.
 * - A save naming a hire that no longer exists loses the hire and nothing
 *   else, and a contract signed on another floor is never restored.
 * - The shell: a contract spawns its hireling with a hello, a contract from
 *   another floor spawns nothing, talking gets an answer but never takes a
 *   press while a fight is on, the floor ending ends the contract, and a death
 *   — run through the scene's own interception and kill resolution — ends the
 *   contract, leaves a body that fades to a terminal phase and then leaves the
 *   world, and records who died for the desk.
 * - Each kit's own rules, one module per kit under `verifyMercenaries/`.
 * - What every hire shares, in `verifyMercenaries/lifecycle.ts`: spawning
 *   behind the owner, following and the leash, kill credit, friendly fire,
 *   Tumbledown's boulder, the contract across a floor's end, and keeping the
 *   owner up longer than no hire in a standard floor-3 fight.
 *
 * Each rule is also run against a deliberately broken version of the code it
 * guards, and must go red there: a check that cannot fail is not a check.
 *
 * Run: npm run verify:mercenaries
 */

import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mercenary } from '../src/creatures/Mercenary';
import {
  MERCENARY_TEMPLATES,
  MERCENARY_TEMPLATE_IDS,
  getMercenaryTemplate,
  type MercenaryTemplateId,
} from '../src/core/mercenaryTemplates';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  restoreMercenaryRoster,
  type HiredMercenary,
  type MercenaryRoster,
  type MercenaryRosterCheckpoint,
} from '../src/core/MercenaryRoster';
import { parseMercenaryRosterCheckpoint } from '../src/core/PersistedWorldState';
import { MERCENARY_VOICES } from '../src/creatures/mercenaries/mercenaryVoices';
import { MERCENARY_ART } from '../src/sprites/mercenaryArt';
import { createMercenaryKit } from '../src/creatures/mercenaries/mercenaryKits';
import { MercenarySystem } from '../src/systems/MercenarySystem';
import { BodyPartGoreSystem } from '../src/systems/BodyPartGoreSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import type { SystemContext } from '../src/systems/GameSystem';
import { resolveKills, type CombatContext } from '../src/systems/CombatSystem';
import { EventBus } from '../src/core/EventBus';
import { AbilityManager } from '../src/core/AbilityManager';
import { createMob } from '../src/levels/spawner';
import { verifyBrawlerKit } from './verifyMercenaries/brawler';
import { verifyWaterMageKit } from './verifyMercenaries/waterMageKit';
import { verifyLancerKit } from './verifyMercenaries/lancer';
import { verifyMedicKit } from './verifyMercenaries/medicKit';
import { verifyCretinGuardKit } from './verifyMercenaries/cretinGuardKit';
import { verifyMercenaryLifecycle } from './verifyMercenaries/lifecycle';
import { mulberry32 } from '../src/sprites/person/rng';

// ── Harness ────────────────────────────────────────────────────────────────

let failures = 0;
function check(ok: boolean, message: string): void {
  if (ok) {
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

/** A rule run against broken code must fail; this records that it did. */
function checkCatches(ruleHolds: boolean, message: string): void {
  check(!ruleHolds, `negative: ${message}`);
}

const FLOOR = 'level3';
const OTHER_FLOOR = 'level2';
/** A template id an old save can still carry that no longer names a hire. */
const RETIRED_TEMPLATE_ID = 'bruiser';
const DECEASED_NAME = 'Somebody Earlier';

function rosterOn(floorLevelId: string): MercenaryRoster {
  const roster = createMercenaryRoster();
  roster.floorLevelId = floorLevelId;
  return roster;
}

function hireOf(id: MercenaryTemplateId, contractLevelId = FLOOR): HiredMercenary {
  return {
    id,
    name: getMercenaryTemplate(id).name,
    contractLevelId,
    introduced: true,
  };
}

function throughJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function sameHire(a: HiredMercenary | null, b: HiredMercenary | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type Parser = (value: unknown) => MercenaryRosterCheckpoint | undefined;
type Restorer = (roster: MercenaryRoster, snapshot: MercenaryRosterCheckpoint) => void;

// ── Templates ──────────────────────────────────────────────────────────────

function checkTemplateTable(): void {
  section('The hire table is whole');
  const ids = new Set(MERCENARY_TEMPLATE_IDS);
  check(
    ids.size === MERCENARY_TEMPLATE_IDS.length,
    `every id is on the desk once (${MERCENARY_TEMPLATE_IDS.length} listed, ${ids.size} distinct)`,
  );
  check(
    MERCENARY_TEMPLATES.length === MERCENARY_TEMPLATE_IDS.length,
    `the desk lists one template per id (${MERCENARY_TEMPLATES.length})`,
  );
  for (const template of MERCENARY_TEMPLATES) {
    const voice = MERCENARY_VOICES[template.voice];
    const hasSomething =
      Object.keys(voice.lines).length > 0 || Object.keys(voice.grunts ?? {}).length > 0;
    const art = MERCENARY_ART[template.art];
    const kit = createMercenaryKit(template);
    check(
      template.id === getMercenaryTemplate(template.id).id && hasSomething && art.deathFrames > 0,
      `${template.id}: voice, figure (death ${art.deathFrames} frames) and ${template.kit} kit (reach ${kit.strikeRangeTiles} tiles)`,
    );
  }
}

// ── The save ───────────────────────────────────────────────────────────────

function roundTripHolds(id: MercenaryTemplateId, parse: Parser, restore: Restorer): boolean {
  const signed = rosterOn(FLOOR);
  signed.active = hireOf(id);
  signed.lastDeceased = DECEASED_NAME;
  const parsed = parse(throughJson(captureMercenaryRoster(signed)));
  if (parsed === undefined) return false;
  const loaded = rosterOn(FLOOR);
  restore(loaded, parsed);
  return sameHire(loaded.active, signed.active) && loaded.lastDeceased === DECEASED_NAME;
}

/** A saved roster whose hire is `active`, with the rest of it intact. */
function savedRosterWith(active: unknown): unknown {
  return { active, lastDeceased: DECEASED_NAME };
}

function unknownIdDropsOnlyTheHire(parse: Parser): boolean {
  const saved = savedRosterWith({ ...hireOf('sledge'), id: RETIRED_TEMPLATE_ID });
  const parsed = parse(saved);
  // Undefined is what makes `parsePersistedWorldState` reject the whole save.
  return parsed?.active === null && parsed.lastDeceased === DECEASED_NAME;
}

function malformedHireDropsOnlyTheHire(parse: Parser): boolean {
  const { contractLevelId: _dropped, ...withoutFloor } = hireOf('bomo');
  const parsed = parse(savedRosterWith(withoutFloor));
  return parsed?.active === null && parsed.lastDeceased === DECEASED_NAME;
}

function otherFloorContractStaysEnded(restore: Restorer): boolean {
  const snapshot: MercenaryRosterCheckpoint = {
    active: hireOf('tumbledown', OTHER_FLOOR),
    lastDeceased: null,
  };
  const roster = rosterOn(FLOOR);
  restore(roster, snapshot);
  return roster.active === null;
}

/** The parser as it would be if it rejected the roster over one bad hire. */
const strictParser: Parser = (value) => {
  const parsed = parseMercenaryRosterCheckpoint(value);
  if (parsed === undefined) return undefined;
  const record = typeof value === 'object' && value !== null ? value : {};
  const hadHire = 'active' in record && record.active !== null;
  return hadHire && parsed.active === null ? undefined : parsed;
};

/** A parser that forgets which floor a contract was signed on. */
const floorForgettingParser: Parser = (value) => {
  const parsed = parseMercenaryRosterCheckpoint(value);
  if (!parsed?.active) return parsed;
  return { ...parsed, active: { ...parsed.active, contractLevelId: OTHER_FLOOR } };
};

/** A restore that ignores which floor the party is on. */
const floorBlindRestore: Restorer = (roster, snapshot) => {
  roster.active = snapshot.active === null ? null : { ...snapshot.active };
  roster.lastDeceased = snapshot.lastDeceased;
};

function checkSave(): void {
  section('Every hire survives capture → parse → restore');
  for (const id of MERCENARY_TEMPLATE_IDS) {
    check(
      roundTripHolds(id, parseMercenaryRosterCheckpoint, restoreMercenaryRoster),
      `${id} round-trips`,
    );
  }
  checkCatches(
    roundTripHolds('sledge', floorForgettingParser, restoreMercenaryRoster),
    'a parser that loses the contract floor fails the round trip',
  );

  section('A hire the save cannot account for drops only the hire');
  check(
    unknownIdDropsOnlyTheHire(parseMercenaryRosterCheckpoint),
    `retired id '${RETIRED_TEMPLATE_ID}' parses to no hire, keeping the rest of the roster`,
  );
  check(
    malformedHireDropsOnlyTheHire(parseMercenaryRosterCheckpoint),
    'a hire missing its contract floor parses to no hire, keeping the rest',
  );
  checkCatches(
    unknownIdDropsOnlyTheHire(strictParser),
    'a parser that rejects the roster over a retired id is caught',
  );

  section('A contract from another floor is never restored');
  check(
    otherFloorContractStaysEnded(restoreMercenaryRoster),
    'restoring a snapshot signed on another floor leaves no hire',
  );
  checkCatches(
    otherFloorContractStaysEnded(floorBlindRestore),
    'a restore that ignores the floor is caught',
  );
}

// ── The shell ──────────────────────────────────────────────────────────────

const ROOM_SIZE_TILES = 16;
const ROOM_LAST_TILE = ROOM_SIZE_TILES - 1;
const ROOM_MIDDLE_TILE = Math.floor(ROOM_SIZE_TILES / 2);
/** Far more frames than any hireling's death, linger and fade together. */
const CORPSE_FRAME_BUDGET = 2000;
/** Frames run past the body's end, to show the end stays the end. */
const PAST_THE_END_FRAMES = 30;
/** More than any hireling's health, whatever it is scaled by. */
const LETHAL_DAMAGE = 10_000;
/** Inside every crawler's attack reach and every kit's engage radius. */
const NEARBY_HOSTILE_OFFSET_TILES = 4;

function makeRoom(): GameMap {
  const grid: TileContent[][] = Array.from({ length: ROOM_SIZE_TILES }, (_, y) =>
    Array.from({ length: ROOM_SIZE_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === ROOM_LAST_TILE || y === ROOM_LAST_TILE;
      return {
        tileId: `${x}#${y}`,
        type: isBorder ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  // At the real tile height, or every sight test measures against the wrong grid.
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

interface ShellHarness {
  readonly map: GameMap;
  readonly roster: MercenaryRoster;
  readonly system: MercenarySystem;
  readonly mobs: MobRoster;
  readonly ctx: SystemContext;
  readonly combat: CombatContext;
}

function buildShell(hire: HiredMercenary | null): ShellHarness {
  const map = makeRoom();
  const human = new HumanPlayer(ROOM_MIDDLE_TILE, ROOM_MIDDLE_TILE, TILE_SIZE);
  const cat = new CatPlayer(ROOM_MIDDLE_TILE + 1, ROOM_MIDDLE_TILE, TILE_SIZE);
  const spells = new SpellSystem();
  const mobs = new MobRoster(map, spells);
  const roster = createMercenaryRoster();
  roster.active = hire;
  const system = new MercenarySystem(roster, FLOOR);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster: mobs,
    gameMap: map,
  };
  const combat: CombatContext = {
    human,
    cat,
    mobs: mobs.mobs,
    mobGrid: mobs.grid,
    gameMap: map,
    safeRoom: null,
    bus: new EventBus(),
    abilityManager: new AbilityManager(),
    spells,
    hitLanded: false,
  };
  return { map, roster, system, mobs, ctx, combat };
}

function spawned(harness: ShellHarness): Mercenary | null {
  harness.system.update(harness.ctx);
  return harness.system.activeMerc;
}

/** Stands the hireling one tile east of the human, well inside talking range. */
function standBesideHuman(harness: ShellHarness, merc: Mercenary): void {
  merc.x = harness.ctx.human.x + TILE_SIZE;
  merc.y = harness.ctx.human.y;
  merc.speech.clear();
}

function inGrid(harness: ShellHarness, merc: Mercenary): boolean {
  return [...harness.mobs.grid.queryCircle(merc.x, merc.y, TILE_SIZE)].includes(merc);
}

/**
 * One frame of the scene's death path, in the scene's order: the hireling's
 * death interception, then kill resolution (which also plays out every body
 * that `rendersWhenDead`), then the system's own update.
 */
type DeathFrame = (harness: ShellHarness) => void;

const sceneDeathFrame: DeathFrame = (harness) => {
  harness.system.checkHealth();
  resolveKills(harness.combat);
  harness.system.update(harness.ctx);
};

/** The same frame with the death interception missing. */
const uninterceptedDeathFrame: DeathFrame = (harness) => {
  resolveKills(harness.combat);
  harness.system.update(harness.ctx);
};

/**
 * The scene's real death frame, wired the way `DungeonScene` wires it: the
 * interception is handed a gore callback for whichever hireling has a
 * `goreBodyPartKey`, exactly as `checkHealth` documents. `mobKilled` never
 * fires for a hireling — `justDied` is cleared before `resolveKills` sees it —
 * so this callback is the only path any rubble has to spawn at all.
 */
function sceneDeathFrameWithGore(gore: BodyPartGoreSystem): DeathFrame {
  return (harness) => {
    harness.system.checkHealth((merc) => {
      if (merc.bodyPartKey === null) return;
      gore.spawnParts(merc.x, merc.y, merc.bodyPartKey, TILE_SIZE);
    });
    resolveKills(harness.combat);
    harness.system.update(harness.ctx);
  };
}

/** Everything a hireling's death promises, true only if all of it happened. */
function deathEndsEverything(harness: ShellHarness, merc: Mercenary, frame: DeathFrame): boolean {
  merc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
  const killed = !merc.isAlive && merc.justDied;
  frame(harness);
  const contractEnded = harness.roster.active === null;
  const recorded = harness.roster.lastDeceased === merc.displayName;
  const unlatched = !merc.justDied;
  const lastWords =
    merc.speech.current !== null || merc.specialSoundPending || merc.damageSoundPending;
  const bodyDrawn = inGrid(harness, merc);
  const dyingFirst = merc.lifePhase === 'dying';

  let frames = 0;
  while (harness.mobs.mobs.includes(merc) && frames < CORPSE_FRAME_BUDGET) {
    frame(harness);
    frames++;
  }
  for (let extra = 0; extra < PAST_THE_END_FRAMES; extra++) frame(harness);
  const terminal = merc.lifePhase === 'gone' && merc.corpseExpired;
  const leftTheWorld = !harness.mobs.mobs.includes(merc) && !inGrid(harness, merc);
  return (
    killed &&
    contractEnded &&
    recorded &&
    unlatched &&
    lastWords &&
    bodyDrawn &&
    dyingFirst &&
    terminal &&
    leftTheWorld &&
    harness.system.activeMerc === null
  );
}

/** A hostile standing close enough that the press belongs to a fight. */
function addNearbyHostile(harness: ShellHarness): void {
  const goblin = createMob(
    'goblin',
    ROOM_MIDDLE_TILE + NEARBY_HOSTILE_OFFSET_TILES,
    ROOM_MIDDLE_TILE,
    harness.map,
  );
  harness.mobs.add(goblin);
}

/** Talking with a fight on, as the scene would: the whole mob list is consulted. */
function talkRefusedInAFight(talk: (harness: ShellHarness) => boolean): boolean {
  const harness = buildShell(hireOf('bucket_boy'));
  const merc = spawned(harness);
  if (merc === null) return false;
  standBesideHuman(harness, merc);
  addNearbyHostile(harness);
  return !talk(harness) && merc.speech.current === null;
}

function floorEndClearsContract(end: (harness: ShellHarness) => void): boolean {
  const harness = buildShell(hireOf('splash_zone'));
  const merc = spawned(harness);
  if (merc === null) return false;
  merc.speech.clear();
  end(harness);
  return harness.roster.active === null && merc.speech.current !== null;
}

function checkShell(): void {
  section('The hireling shell');

  for (const id of MERCENARY_TEMPLATE_IDS) {
    const harness = buildShell({ ...hireOf(id), introduced: false });
    const merc = spawned(harness);
    const greeted = merc !== null && (merc.speech.current !== null || merc.specialSoundPending);
    check(
      merc !== null && greeted && harness.roster.active?.introduced === true,
      `${id} spawns beside the party and says hello once`,
    );
  }

  const stale = buildShell(hireOf('sledge', OTHER_FLOOR));
  check(
    spawned(stale) === null && stale.roster.active === null,
    'a contract signed on another floor spawns nothing and is cleared',
  );

  section('Talking to the hireling');
  const talker = buildShell(hireOf('dong_quixote'));
  const knight = spawned(talker);
  if (knight !== null) standBesideHuman(talker, knight);
  check(
    knight !== null &&
      talker.system.tryTalk(talker.ctx.human, talker.mobs.mobs) &&
      knight.speech.current !== null,
    'talking to an adjacent hireling gets a line',
  );

  const golemTalk = buildShell(hireOf('tumbledown'));
  const golem = spawned(golemTalk);
  if (golem !== null) standBesideHuman(golemTalk, golem);
  check(
    golem !== null &&
      golemTalk.system.tryTalk(golemTalk.ctx.human, golemTalk.mobs.mobs) &&
      golem.speech.isItalic,
    'Tumbledown answers with a stage direction, not a line',
  );

  check(
    talkRefusedInAFight((h) => h.system.tryTalk(h.ctx.human, h.mobs.mobs)),
    'with a hostile in attack reach, a press beside the hireling is not spent on talk',
  );
  checkCatches(
    talkRefusedInAFight((h) => h.system.tryTalk(h.ctx.human, [])),
    'a talk that cannot see the fight is caught stealing the press',
  );

  section('The contract ends with the floor');
  check(
    floorEndClearsContract((h) => h.system.endContractForFloor()),
    'the floor ending clears the contract, with a goodbye',
  );
  checkCatches(
    floorEndClearsContract((h) => {
      h.system.activeMerc?.bark('floor_end');
    }),
    'a goodbye that leaves the contract running is caught',
  );

  section("Death, through the scene's own kill resolution");
  for (const id of MERCENARY_TEMPLATE_IDS) {
    const harness = buildShell(hireOf(id));
    const merc = spawned(harness);
    check(
      merc !== null && deathEndsEverything(harness, merc, sceneDeathFrame),
      `${id}: death ends the contract, leaves a fading body with a terminal phase, and records the name`,
    );
  }

  const unwatched = buildShell(hireOf('bucket_boy'));
  const unwatchedMerc = spawned(unwatched);
  checkCatches(
    unwatchedMerc !== null &&
      deathEndsEverything(unwatched, unwatchedMerc, uninterceptedDeathFrame),
    'a death nobody intercepts is caught',
  );

  const bodiless = buildShell(hireOf('gluteus_maxx'));
  const bodilessMerc = spawned(bodiless);
  if (bodilessMerc !== null) {
    Object.defineProperty(bodilessMerc, 'rendersWhenDead', { value: false });
  }
  checkCatches(
    bodilessMerc !== null && deathEndsEverything(bodiless, bodilessMerc, sceneDeathFrame),
    'a hireling that leaves no body is caught',
  );

  section('A golem hireling comes apart on death, not through mobKilled');
  const goreHarness = buildShell(hireOf('tumbledown'));
  const goreMerc = spawned(goreHarness);
  const goreSystem = new BodyPartGoreSystem(goreHarness.map);
  if (goreMerc !== null) {
    goreMerc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
    sceneDeathFrameWithGore(goreSystem)(goreHarness);
  }
  check(
    goreMerc !== null && goreSystem.liveCount > 0,
    "Tumbledown's death, wired the way DungeonScene wires it, scatters rubble",
  );

  const unwiredGoreHarness = buildShell(hireOf('tumbledown'));
  const unwiredGoreMerc = spawned(unwiredGoreHarness);
  const unwiredGoreSystem = new BodyPartGoreSystem(unwiredGoreHarness.map);
  if (unwiredGoreMerc !== null) {
    unwiredGoreMerc.takeDamage(LETHAL_DAMAGE, {
      kind: 'status',
      effectType: 'burn',
      applier: null,
    });
    // `checkHealth()` with no callback is exactly what clears `justDied` and
    // skips `resolveKills`'s `mobKilled` emit — nothing left to spawn rubble.
    sceneDeathFrame(unwiredGoreHarness);
  }
  checkCatches(
    unwiredGoreMerc !== null && unwiredGoreSystem.liveCount > 0,
    'a golem death whose gore callback is never wired up is caught leaving no rubble',
  );
}

/**
 * Every random draw in the run — a bark's line, a tactics roll, a dodge —
 * replays from this, so two runs print the same report and a diff between
 * them shows only what changed in the code.
 */
const VERIFY_SEED = 0x3e7c_5eed;
Math.random = mulberry32(VERIFY_SEED);

checkTemplateTable();
checkSave();
checkShell();
verifyBrawlerKit({ section, check, checkCatches });
failures += verifyWaterMageKit();
verifyLancerKit({ section, check, checkCatches });
failures += verifyMedicKit();
verifyCretinGuardKit({ section, check, checkCatches });
verifyMercenaryLifecycle({ section, check, checkCatches });

console.log(
  failures === 0 ? '\nverify:mercenaries passed' : `\nverify:mercenaries: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
