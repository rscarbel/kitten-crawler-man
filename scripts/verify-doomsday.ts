#!/usr/bin/env tsx
/**
 * Headless checks on the end of the game: the doomsday countdown after the
 * Lich, the escape stairwell by the tower door, and the run-complete screen.
 *
 * - The stairwell is drawn from the moment the countdown starts — while the
 *   crystal is still loose as well as after — and not before or after the
 *   finale. It sorts after the tower above it, and it is on the minimap and in
 *   the Journal for both stages, pointing at the tower and then at the stairs.
 * - Stepping on it before the crystal is contained refuses, once per visit,
 *   and changes nothing.
 * - Reaching it after containment ends the run: the save is written before the
 *   run-complete screen goes up, the saved stage is 'complete', and a scene
 *   rebuilt from that save does not end the run a second time.
 * - The stage and the time left on the clock survive a save and a reload a day
 *   later, and a death that respawns from an older save cannot buy back time.
 * - The expired countdown keeps trying until it catches the party — a revive
 *   is not a respawn and earns no new time — and only the respawn after a
 *   death re-arms it, and only if it had run out.
 *
 *   npx tsx scripts/verify-doomsday.ts
 */

import { createCanvas } from 'canvas';
import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level3 } from '../src/levels/level3';
import { PlayerManager } from '../src/core/PlayerManager';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import type { SystemContext } from '../src/systems/GameSystem';
import {
  DOOMSDAY_TRACKER_ID,
  DoomsdayEscapeSystem,
  STAIRWELL_KNOCKED_OUT_TOAST,
  STAIRWELL_SEALED_TOAST,
} from '../src/systems/DoomsdayEscapeSystem';
import {
  DOOMSDAY_COUNTDOWN_MS,
  DOOMSDAY_STAGES,
  capturePersistedDoomsday,
  createDoomsdayProgress,
  parsePersistedDoomsday,
  rearmExpiredDoomsday,
  restoreDoomsdayProgress,
  triggerDoomsdayExplosionIfExpired,
  type DoomsdayProgress,
} from '../src/core/DoomsdayProgress';
import { GameStats, parseGameStatsSnapshot } from '../src/core/GameStats';
import { RunCompleteScreen, buildRunSummary, finishRun } from '../src/ui/RunCompleteScreen';
import { asGameContext } from './nodeGameContext';
import { MercenarySystem } from '../src/systems/MercenarySystem';
import {
  captureMercenaryRoster,
  createMercenaryRoster,
  type MercenaryRoster,
} from '../src/core/MercenaryRoster';
import { getMercenaryTemplate } from '../src/core/mercenaryTemplates';
import { loadGameSpritesInNode } from './nodeCanvasGlobals';

const WORLD_SEED = 424242;
/** Far enough from the stairs that standing there is plainly not on them. */
const AWAY_TILES = 8;
const VIEW_W = 800;
const VIEW_H = 600;
const HALF_VIEW_TILES_X = VIEW_W / TILE_SIZE / 2;
const HALF_VIEW_TILES_Y = VIEW_H / TILE_SIZE / 2;
const SAVED_REMAINING_MS = 123_456;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LONG_AGO_MS = 1_000;
const RETRY_FRAMES = 5;
const INVULNERABLE_FRAMES = 1_000;
const HUMAN_LEVEL = 9;
const CAT_LEVEL = 8;

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// The stairwell's own art is drawn through the sprite loader, which needs the
// browser's image globals to exist even to report a sheet it has not loaded.
await loadGameSpritesInNode();

const map = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  dungeon: dungeonOptionsForLevel(level3),
  worldSeed: WORLD_SEED,
});
const escapeTile = map.doomsdayEscapeTile;
const towerDoor = map.buildingEntries.find((entry) => entry.type === 'tower');
if (escapeTile === undefined || towerDoor === undefined) {
  console.error('FAIL the overworld has no escape tile or no tower door to test against');
  process.exit(1);
}

const doorTile = towerDoor.doorTile;

interface Harness {
  readonly progress: DoomsdayProgress;
  readonly system: DoomsdayEscapeSystem;
  readonly ctx: SystemContext;
  readonly toasts: string[];
  readonly pm: PlayerManager;
}

function makeHarness(progress = createDoomsdayProgress()): Harness {
  const toasts: string[] = [];
  const pm = new PlayerManager(doorTile.x, doorTile.y + 1, undefined);
  // The scene's own refusal: nobody goes down while a crawler lies knocked out.
  const system = new DoomsdayEscapeSystem(
    map,
    progress,
    (message) => toasts.push(message),
    () => (pm.human.isKnockedOut || pm.cat.isKnockedOut ? STAIRWELL_KNOCKED_OUT_TOAST : null),
  );
  const ctx: SystemContext = {
    human: pm.human,
    cat: pm.cat,
    active: pm.active(),
    inactive: pm.inactive(),
    activeIsMoving: false,
    roster: new MobRoster(map, new SpellSystem()),
    gameMap: map,
  };
  return { progress, system, ctx, toasts, pm };
}

const HIRE = getMercenaryTemplate('gluteus_maxx');
/** Far past any hireling's health, so one hit is sure to put it down. */
const LETHAL_DAMAGE = 100_000;

/** A real hire, spawned by its system and then knocked down, as the party finds one at the stairs. */
function downedHire(): {
  system: MercenarySystem;
  roster: MobRoster;
  contracts: MercenaryRoster;
} | null {
  const h = makeHarness();
  const contracts = createMercenaryRoster();
  contracts.active = { id: HIRE.id, name: HIRE.name, contractLevelId: level3.id, introduced: true };
  const system = new MercenarySystem(contracts, level3.id);
  system.update(h.ctx);
  const merc = system.activeMerc;
  if (merc === null) return null;
  merc.takeDamage(LETHAL_DAMAGE, { kind: 'status', effectType: 'burn', applier: null });
  system.checkHealth();
  return system.downedMerc === merc ? { system, roster: h.ctx.roster, contracts } : null;
}

function arm(progress: DoomsdayProgress, stage: DoomsdayProgress['stage']): void {
  progress.stage = stage;
  progress.deadlineAt =
    stage === 'containment' || stage === 'escape' ? Date.now() + DOOMSDAY_COUNTDOWN_MS : null;
}

function standOnStairs(h: Harness): void {
  h.ctx.active.x = (escapeTile?.x ?? 0) * TILE_SIZE;
  h.ctx.active.y = (escapeTile?.y ?? 0) * TILE_SIZE;
}

function standAway(h: Harness): void {
  h.ctx.active.x = ((escapeTile?.x ?? 0) + AWAY_TILES) * TILE_SIZE;
  h.ctx.active.y = (escapeTile?.y ?? 0) * TILE_SIZE;
}

/** Strokes the stairwell prop draws with the camera centred on it. */
function strokesDrawn(h: Harness): number {
  const canvas = createCanvas(VIEW_W, VIEW_H);
  const ctx = asGameContext(canvas.getContext('2d'));
  let strokes = 0;
  const strokeRect = ctx.strokeRect.bind(ctx);
  ctx.strokeRect = (x, y, w, hgt) => {
    strokes++;
    strokeRect(x, y, w, hgt);
  };
  const camX = ((escapeTile?.x ?? 0) - HALF_VIEW_TILES_X) * TILE_SIZE;
  const camY = ((escapeTile?.y ?? 0) - HALF_VIEW_TILES_Y) * TILE_SIZE;
  h.system.stairwellProp.render(ctx, camX, camY, TILE_SIZE);
  return strokes;
}

section('The stairwell is on show for the whole countdown, and only then');
{
  const h = makeHarness();
  for (const stage of DOOMSDAY_STAGES) {
    arm(h.progress, stage);
    const live = stage === 'containment' || stage === 'escape';
    const drawn = strokesDrawn(h) > 0;
    check(drawn === live, `in '${stage}' the stairwell is ${live ? 'drawn' : 'not drawn'}`);
    const marked = h.system.escapeMarkerTile !== null;
    check(marked === live, `in '${stage}' the minimap ${live ? 'marks' : 'does not mark'} it`);
  }
  const prop = h.system.stairwellProp;
  check(
    prop.y < escapeTile.y * TILE_SIZE,
    'it sorts north of its own tile, so a crawler standing on it is drawn over it',
  );
  check(
    prop.y > towerDoor.doorTile.y * TILE_SIZE,
    'and south of the tower door, so the tower is drawn under it rather than over it',
  );

  arm(h.progress, 'containment');
  const [contain] = h.system.trackerEntries();
  check(
    contain?.id === DOOMSDAY_TRACKER_ID &&
      contain.status === 'active' &&
      contain.target?.x === towerDoor.doorTile.x &&
      contain.target.y === towerDoor.doorTile.y,
    'while containing, the Journal points at the tower door',
  );
  arm(h.progress, 'escape');
  const [escape] = h.system.trackerEntries();
  check(
    escape?.id === DOOMSDAY_TRACKER_ID &&
      escape.target?.x === escapeTile.x &&
      escape.target.y === escapeTile.y,
    'once contained, it points at the stairwell',
  );
  arm(h.progress, 'inactive');
  check(h.system.trackerEntries().length === 0, 'before the finale there is no entry at all');

  const fresh = makeHarness();
  arm(fresh.progress, 'containment');
  standAway(fresh);
  fresh.system.update(fresh.ctx);
  check(fresh.system.pinRequested, 'the first live frame asks the scene to pin the finale');
}

section('The stairs are sealed until the crystal is contained');
{
  const h = makeHarness();
  arm(h.progress, 'containment');
  standOnStairs(h);
  h.system.update(h.ctx);
  h.system.update(h.ctx);
  check(h.progress.stage === 'containment', 'stepping on them changes nothing');
  check(!h.system.floorEscapedPending, 'and does not end the run');
  check(
    h.toasts.length === 1 && h.toasts[0] === STAIRWELL_SEALED_TOAST,
    `the refusal is shown once for the visit (${h.toasts.length})`,
  );
  standAway(h);
  h.system.update(h.ctx);
  standOnStairs(h);
  h.system.update(h.ctx);
  check(h.toasts.length === 2, 'and again on the next visit');
}

section('The open stairs wait for a knocked-out partner');
{
  const h = makeHarness();
  arm(h.progress, 'escape');
  h.pm.cat.isKnockedOut = true;
  standOnStairs(h);
  h.system.update(h.ctx);
  h.system.update(h.ctx);
  check(
    h.progress.stage === 'escape' && !h.system.floorEscapedPending,
    'with the cat knocked out, the run does not end',
  );
  check(
    h.toasts.length === 1 && h.toasts[0] === STAIRWELL_KNOCKED_OUT_TOAST,
    `the player is told why, once (${h.toasts.length})`,
  );
  h.pm.cat.isKnockedOut = false;
  h.system.update(h.ctx);
  check(h.progress.stage === 'complete', 'once she is up, the stairs take them');
}

section('Reaching the stairs after containment ends the run, saved first');
{
  const h = makeHarness();
  arm(h.progress, 'escape');
  standOnStairs(h);
  h.system.update(h.ctx);
  check(h.progress.stage === 'complete', "the stage is 'complete'");
  check(h.progress.deadlineAt === null, 'and the countdown is stopped');
  check(h.system.floorEscapedPending, 'the scene is told the run is over');

  const stats = new GameStats();
  stats.recordKill('Goblin');
  stats.recordDeath();
  const screen = new RunCompleteScreen();
  const order: string[] = [];
  let screenUpWhenSaved = true;
  let savedDoomsday: unknown = null;
  let savedStats: unknown = null;
  const hire = downedHire();
  let hireActiveWhenSaved: unknown = 'not saved';
  finishRun(screen, {
    settleParty: () => {
      order.push('settle');
      hire?.system.forfeitDownedHire(hire.roster.mobs, hire.roster.grid);
    },
    unlockAchievements: () => order.push('achievements'),
    save: () => {
      order.push('save');
      screenUpWhenSaved = screen.isActive;
      hireActiveWhenSaved = hire === null ? null : captureMercenaryRoster(hire.contracts).active;
      // Through JSON, as a save reaches storage.
      savedDoomsday = JSON.parse(JSON.stringify(capturePersistedDoomsday(h.progress, Date.now())));
      savedStats = JSON.parse(JSON.stringify(stats.snapshot()));
    },
    summarize: () => {
      order.push('summary');
      return buildRunSummary({
        stats,
        humanLevel: HUMAN_LEVEL,
        catLevel: CAT_LEVEL,
        mongoLevel: null,
        achievements: { unlocked: 1, total: 1 },
      });
    },
    handlers: { onKeepExploring: () => undefined, onMainMenu: () => undefined },
  });
  check(
    order.join(',') === 'settle,achievements,save,summary',
    `the party settled, achievements, the save, then the summary (${order.join(', ')})`,
  );
  check(hire !== null, 'a hire lay downed on the stairs');
  check(
    hireActiveWhenSaved === null && hire?.contracts.lastDeceased === HIRE.name,
    'the downed hire cannot come down: it is a recorded death before the save, not a standing contract',
  );
  check(!screenUpWhenSaved, 'the save is written before the screen goes up');
  check(screen.isActive, 'the run-complete screen is up');
  check(
    parseGameStatsSnapshot(savedStats)?.deaths === 1,
    'the save carries the run’s tallies for the screen to show after a reload',
  );

  const reloaded = parsePersistedDoomsday(savedDoomsday);
  check(reloaded?.stage === 'complete', "the saved stage is 'complete'");
  if (reloaded !== undefined) {
    const after = makeHarness();
    restoreDoomsdayProgress(after.progress, reloaded, Date.now());
    standOnStairs(after);
    after.system.update(after.ctx);
    check(
      !after.system.floorEscapedPending && after.progress.stage === 'complete',
      'a scene rebuilt from that save does not end the run again',
    );
    check(strokesDrawn(after) === 0, 'and the stairwell is gone from it');
  }
}

section('The stage and the time left survive a save and a reload');
{
  const now = Date.now();
  const live = createDoomsdayProgress();
  live.stage = 'containment';
  live.deadlineAt = now + SAVED_REMAINING_MS;
  live.crystalTile = { x: TILE_SIZE, y: TILE_SIZE };
  const saved = parsePersistedDoomsday(
    JSON.parse(JSON.stringify(capturePersistedDoomsday(live, now))),
  );
  check(saved?.remainingMs === SAVED_REMAINING_MS, 'the save holds the time left, not a deadline');
  if (saved !== undefined) {
    const dayLater = now + MS_PER_DAY;
    const reloaded = createDoomsdayProgress();
    restoreDoomsdayProgress(reloaded, saved, dayLater);
    check(reloaded.stage === 'containment', 'the stage comes back');
    check(
      reloaded.deadlineAt === dayLater + SAVED_REMAINING_MS,
      'a day later, the clock resumes with the time it was saved with',
    );
    check(reloaded.crystalTile?.x === TILE_SIZE, 'and so does the crystal’s spot');

    const running = createDoomsdayProgress();
    running.stage = 'escape';
    running.deadlineAt = now + LONG_AGO_MS;
    restoreDoomsdayProgress(running, saved, now);
    check(
      running.stage === 'escape' && running.deadlineAt === now + LONG_AGO_MS,
      'a respawn from an older save does not wind back a countdown already running',
    );
  }
  check(parsePersistedDoomsday(undefined) === undefined, 'an older save loads as no finale');
  check(parsePersistedDoomsday({ stage: 'nonsense' }) === undefined, 'a damaged one too');
  check(
    parsePersistedDoomsday({ stage: 'escape' })?.remainingMs === DOOMSDAY_COUNTDOWN_MS,
    'a live stage whose time was lost gets a full countdown, not none',
  );
}

section('The expired countdown never lets up, and re-arms only on a respawn');
{
  const h = makeHarness();
  const { human, cat } = h.pm;
  h.progress.stage = 'containment';
  const expiredAt = Date.now() - LONG_AGO_MS;
  h.progress.deadlineAt = expiredAt;

  // The active crawler is warded through the blast and the companion is already
  // down: the party has not died, it has only not been caught yet.
  human.invulnerableFrames = INVULNERABLE_FRAMES;
  cat.hp = 0;
  cat.isKnockedOut = true;
  triggerDoomsdayExplosionIfExpired(h.progress, human, cat);
  check(human.hp > 0, 'a warded crawler outlasts the blast');

  // Revived by the one still standing, with the ward gone.
  cat.isKnockedOut = false;
  cat.hp = cat.maxHp;
  human.invulnerableFrames = 0;
  for (let i = 0; i < RETRY_FRAMES; i++) triggerDoomsdayExplosionIfExpired(h.progress, human, cat);
  check(
    h.progress.deadlineAt === expiredAt,
    'a revive is not a respawn: the countdown stays expired, no fresh seven minutes',
  );
  check(human.hp === 0 && cat.hp === 0, 'and the blast catches both the moment it can');

  const running = createDoomsdayProgress();
  running.stage = 'escape';
  const stillRunning = Date.now() + SAVED_REMAINING_MS;
  running.deadlineAt = stillRunning;
  check(
    !rearmExpiredDoomsday(running, Date.now()) && running.deadlineAt === stillRunning,
    'a respawn after dying to anything else leaves a running countdown as it was',
  );

  const now = Date.now();
  check(rearmExpiredDoomsday(h.progress, now), 'a respawn after the blast re-arms');
  check(
    h.progress.deadlineAt === now + DOOMSDAY_COUNTDOWN_MS,
    'with a full countdown on the stage they failed',
  );
  check(h.progress.stage === 'containment', 'which is still containment');
  human.hp = human.maxHp;
  cat.hp = cat.maxHp;
  triggerDoomsdayExplosionIfExpired(h.progress, human, cat);
  check(human.hp === human.maxHp && cat.hp === cat.maxHp, 'so the respawned party arrives alive');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
