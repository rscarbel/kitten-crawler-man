/**
 * The human's Smush passes under every fairy: no damage, no stun, nothing
 * landed, and a "Dodge" label over each fairy the blast reached. Driven
 * through the real stomp — `triggerSmush`, the swing timers, and the combat
 * kit's attack resolution — with a goblin in the same blast as the control.
 */

import { AbilityManager } from '../../src/core/AbilityManager';
import type { FloatingTextStyle } from '../../src/core/FloatingText';
import type { Mob } from '../../src/creatures/Mob';
import { CombatKit } from '../../src/systems/kits/CombatKit';
import { FloatingCombatTextSystem } from '../../src/systems/FloatingCombatTextSystem';
import { SMUSH_DODGE_LABEL } from '../../src/systems/CombatSystem';
import type { FairyGateReport } from './report';
import { buildStage, placeOnTile, withDodgesOff, type Stage } from './stage';

/** Where the human stomps; the goblin and fairy stand one tile off, well inside the inner ring. */
const STOMP_TILE = 10;
const BESIDE_TILES = 1;
/** Smush's first level that stuns what it hits, so the control shows a status the fairy must not get. */
const SMUSH_STUN_LEVEL = 5;
/**
 * Levels the goblin up far enough to live through a stun-level stomp: the stun
 * is only worth checking for on a body still standing to carry it.
 */
const STURDY_MOB_LEVEL = 20;
/** More than a whole Smush, windup to recovery. */
const SMUSH_WATCH_FRAMES = 240;
const FAIRY_KINDS = [
  'fairy_shield',
  'fairy_healer',
  'fairy_ice',
  'fairy_fire',
  'fairy_necro',
] as const;

/** A throttle window, and a repeat inside it. */
const THROTTLE_WINDOW_FRAMES = 30;
const REPEAT_INSIDE_WINDOW_FRAMES = 10;
const THROTTLE_PROBE_TEXT = 'Invulnerable';

interface BodySnapshot {
  readonly hp: number;
  readonly x: number;
  readonly y: number;
  readonly statuses: number;
}

function snapshot(mob: Mob): BodySnapshot {
  return { hp: mob.hp, x: mob.x, y: mob.y, statuses: mob.statusEffects.length };
}

/** Whether the stomp left `mob` exactly as it found it, save a Dodge label. */
function spared(mob: Mob, before: BodySnapshot): boolean {
  const after = snapshot(mob);
  return (
    after.hp === before.hp &&
    after.x === before.x &&
    after.y === before.y &&
    after.statuses === before.statuses
  );
}

function showsDodge(mob: Mob): boolean {
  return mob.pendingFloatingText.some((request) => request.text === SMUSH_DODGE_LABEL);
}

function describe(mob: Mob, before: BodySnapshot): string {
  const after = snapshot(mob);
  return (
    `hp ${before.hp} → ${after.hp}, statuses ${before.statuses} → ${after.statuses}, ` +
    `moved ${after.x !== before.x || after.y !== before.y}, dodge label ${showsDodge(mob)}`
  );
}

/**
 * Runs one Smush start to finish, resolving attacks on every frame the way a
 * scene does. Returns how many frames the blast landed on.
 */
function stomp(s: Stage, combat: CombatKit): number {
  const human = s.pm.human;
  if (!human.triggerSmush()) return 0;
  let peaks = 0;
  for (let frame = 0; frame < SMUSH_WATCH_FRAMES && human.smushTimer > 0; frame++) {
    human.updateAttack();
    if (human.isSmushPeak()) peaks++;
    combat.resolvePlayerAttacks();
    human.tickTimers();
  }
  return peaks;
}

function smushStage(): { s: Stage; combat: CombatKit } {
  const s = buildStage();
  const abilities = new AbilityManager();
  abilities.setGodModeMinLevel(SMUSH_STUN_LEVEL);
  const combat = new CombatKit({
    world: { gameMap: s.map, bus: s.bus, audio: null, pm: s.pm, roster: s.roster },
    abilityManager: abilities,
    safeRoom: null,
  });
  placeOnTile(s.pm.human, STOMP_TILE, STOMP_TILE);
  return { s, combat };
}

function checkEveryKind(report: FairyGateReport): void {
  for (const kind of FAIRY_KINDS) {
    const { s, combat } = smushStage();
    const goblin = s.add('goblin', STOMP_TILE + BESIDE_TILES, STOMP_TILE);
    goblin.applyMobLevel(STURDY_MOB_LEVEL);
    const fairy = s.add(kind, STOMP_TILE, STOMP_TILE + BESIDE_TILES);
    const goblinBefore = snapshot(goblin);
    const fairyBefore = snapshot(fairy);

    const peaks = withDodgesOff(() => stomp(s, combat));
    report.precondition(peaks === 1, `${kind}: the Smush lands exactly once`, `${peaks} peaks`);
    const goblinStunned = goblin.statusEffects.some((effect) => effect.type === 'stun');
    report.precondition(
      goblin.hp < goblinBefore.hp && goblin.isAlive && goblinStunned,
      `${kind}: the same blast hurts and stuns the goblin beside it`,
      describe(goblin, goblinBefore),
    );
    report.check(
      spared(fairy, fairyBefore),
      `${kind}: the Smush deals the fairy nothing and lands nothing on it`,
      describe(fairy, fairyBefore),
    );
    report.check(
      showsDodge(fairy),
      `${kind}: a "${SMUSH_DODGE_LABEL}" label is raised over the fairy`,
    );
    report.checkCatches(
      spared(goblin, goblinBefore) && showsDodge(goblin),
      `${kind}: the goblin the same blast reached is caught being hit and raising no Dodge`,
      describe(goblin, goblinBefore),
    );
  }
}

/** Counts every label the system actually puts on screen. */
class CountingFloatingText extends FloatingCombatTextSystem {
  readonly shown: string[] = [];

  override spawn(worldX: number, worldY: number, text: string, style: FloatingTextStyle): void {
    this.shown.push(text);
    super.spawn(worldX, worldY, text, style);
  }
}

/** Labels shown when the same text is queued twice over one body, `gapFrames` apart. */
function repeatedLabels(throttleFrames: number | undefined, gapFrames: number): number {
  const s = buildStage();
  const goblin = s.add('goblin', STOMP_TILE, STOMP_TILE);
  const labels = new CountingFloatingText();
  const drain = (): void => labels.updateFor(s.pm.human, s.pm.cat, s.roster.mobs);
  goblin.queueFloatingText(THROTTLE_PROBE_TEXT, 'block', { throttleFrames });
  goblin.queueFloatingText(THROTTLE_PROBE_TEXT, 'block', { throttleFrames });
  drain();
  for (let frame = 1; frame < gapFrames; frame++) drain();
  goblin.queueFloatingText(THROTTLE_PROBE_TEXT, 'block', { throttleFrames });
  drain();
  return labels.shown.filter((text) => text === THROTTLE_PROBE_TEXT).length;
}

function checkThrottle(report: FairyGateReport): void {
  const inside = repeatedLabels(THROTTLE_WINDOW_FRAMES, REPEAT_INSIDE_WINDOW_FRAMES);
  report.check(
    inside === 1,
    'a throttled label raised three times inside its window is shown once',
    `${inside} shown`,
  );
  const after = repeatedLabels(THROTTLE_WINDOW_FRAMES, THROTTLE_WINDOW_FRAMES);
  report.check(
    after === 2,
    'a throttled label raised again once its window has passed is shown again',
    `${after} shown`,
  );
  const unthrottled = repeatedLabels(undefined, REPEAT_INSIDE_WINDOW_FRAMES);
  report.checkCatches(
    unthrottled === 1,
    'the same three labels without a throttle are caught stacking',
    `${unthrottled} shown`,
  );
}

export function verifySmushSparesFairies(report: FairyGateReport): void {
  report.section('Smush passes under fairies');
  checkEveryKind(report);
  checkThrottle(report);
}
