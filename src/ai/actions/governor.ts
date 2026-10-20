/**
 * The game's own gate on every AI action, independent of whatever the server
 * already checked. It holds the AI to `docs/difficulty-fairness-rules.md`: the
 * AI may pressure a crawler, never ambush a beaten one. No hostiles appear
 * while a menu is up or anyone is under a quarter of their health, temporary
 * stat changes never stack, and each floor has a fixed allowance of spawns,
 * gifts, fines and clock changes, scaled by depth where the stakes scale.
 */
import { TILE_SIZE } from '../../core/constants';
import {
  AI_CHARACTER_MORDECAI,
  activeCrawler,
  bothCrawlers,
  floorNumberOf,
  type Crawler,
} from './helpers';
import { MEMORY_ONLY_LEDGER_STORE, type FloorLedgerStore } from './ledgerStore';
import {
  AI_BUDGET_POOLS,
  aiFloorKey,
  type AIActionCall,
  type AIActionDef,
  type AIBudgetDraw,
  type AIBudgetPool,
  type AIContextFlag,
  type AIContextFlags,
  type AISceneContext,
} from './types';

/** Below this share of max HP a crawler is off-limits to anything that hurts or hunts them. */
export const LOW_HP_FRACTION = 0.25;
/**
 * During a fight the shield widens: below this share of max HP a crawler is
 * already losing, and the AI does not pile more on.
 */
export const HURT_IN_COMBAT_FRACTION = 0.4;
const PERCENT = 100;
/** `LOW_HP_FRACTION` as a whole percentage, for text the model and the player read. */
export const LOW_HP_PERCENT = Math.round(LOW_HP_FRACTION * PERCENT);
const HURT_IN_COMBAT_PERCENT = Math.round(HURT_IN_COMBAT_FRACTION * PERCENT);

/** How near a hostile with a target must be for the party to count as fighting. */
const COMBAT_RADIUS_TILES = 10;

interface PoolAllowance {
  readonly perFloor: number;
  /** Multiplied by floor depth, for pools whose stakes grow with the floor (coin and item value). */
  readonly scalesWithDepth: boolean;
}

/** Each floor's allowance, per pool. */
export const FLOOR_BUDGETS: Readonly<Record<AIBudgetPool, PoolAllowance>> = {
  mobsSpawned: { perFloor: 10, scalesWithDepth: false },
  itemValue: { perFloor: 200, scalesWithDepth: true },
  coinsGiven: { perFloor: 150, scalesWithDepth: true },
  coinsFined: { perFloor: 75, scalesWithDepth: true },
  lootBoxPoints: { perFloor: 4, scalesWithDepth: false },
  timerSeconds: { perFloor: 180, scalesWithDepth: false },
};

interface CharacterConditions {
  readonly requires: readonly AIContextFlag[];
  readonly forbids: readonly AIContextFlag[];
}

/** Extra conditions a character's calls must meet, whatever the action. */
const CHARACTER_CONDITIONS: ReadonlyMap<string, CharacterConditions> = new Map([
  // Mordecai only ever deals with the party in his safe room, and never mid-fight.
  [AI_CHARACTER_MORDECAI, { requires: ['inSafeRoom'], forbids: ['isPaused', 'inCombat'] }],
]);

export type GovernorVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

const ALLOW: GovernorVerdict = { ok: true };

function deny(reason: string): GovernorVerdict {
  return { ok: false, reason };
}

interface FloorLedger {
  readonly actionCounts: Map<string, number>;
  readonly spent: Map<AIBudgetPool, number>;
}

function isHostileFighting(scene: AISceneContext): boolean {
  const focus = activeCrawler(scene);
  const radiusPx = COMBAT_RADIUS_TILES * TILE_SIZE;
  return scene
    .getMobs()
    .some(
      (mob) =>
        mob.isAlive &&
        mob.isHostile &&
        mob.currentTarget !== null &&
        Math.hypot(mob.x - focus.x, mob.y - focus.y) <= radiusPx,
    );
}

/** The flags the governor (and the server's tool policy) judge an action against. */
export function computeContextFlags(scene: AISceneContext): AIContextFlags {
  return {
    isPaused: scene.isPaused(),
    inBossFight: scene.isBossFightActive(),
    inSafeRoom: scene.isInSafeRoom?.() ?? false,
    inCombat: scene.isInCombat?.() ?? isHostileFighting(scene),
    indoors: scene.isIndoors?.() ?? false,
  };
}

function floorKeyOf(scene: AISceneContext): string {
  return scene.getFloorKey?.() ?? aiFloorKey(scene.getLevelId(), scene.getGameMap().worldSeed);
}

function hpFraction(crawler: Crawler): number {
  return crawler.maxHp > 0 ? crawler.hp / crawler.maxHp : 0;
}

/** A crawler the fairness rules shield: down (knocked out or dead), or under {@link LOW_HP_FRACTION} of max HP. */
export function isVulnerable(crawler: Crawler): boolean {
  if (crawler.isKnockedOut || !crawler.isAlive) return true;
  return hpFraction(crawler) < LOW_HP_FRACTION;
}

export function anyVulnerable(scene: AISceneContext): boolean {
  return bothCrawlers(scene).some(isVulnerable);
}

/** Whether any crawler is down or under {@link HURT_IN_COMBAT_FRACTION} of max HP. */
function anyHurt(scene: AISceneContext): boolean {
  return bothCrawlers(scene).some(
    (crawler) => isVulnerable(crawler) || hpFraction(crawler) < HURT_IN_COMBAT_FRACTION,
  );
}

/** Whether an action can put new hostiles or harm on the party, which the HP shields govern. */
function canHurtParty(def: AIActionDef): boolean {
  return (
    def.spawnsMobs === true || def.policy.severity === 'harmful' || def.isHarmful !== undefined
  );
}

/**
 * The HP shields stated for the model, appended to the tool description of
 * every action they govern, so the model is told the same rule it is held to.
 */
export function hpShieldNote(def: AIActionDef): string | null {
  if (!canHurtParty(def)) return null;
  const subject = def.spawnsMobs === true ? 'Never spawns' : 'Never harms';
  return `${subject} while a crawler is below ${LOW_HP_PERCENT}% HP, or below ${HURT_IN_COMBAT_PERCENT}% during a fight.`;
}

export class ActionGovernor {
  private readonly lastRunAt = new Map<string, number>();
  private readonly sessionCounts = new Map<string, number>();
  private readonly floors = new Map<string, FloorLedger>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly store: FloorLedgerStore = MEMORY_ONLY_LEDGER_STORE,
  ) {}

  /** Whether `def` may run for `call` right now, and why not when it may not. */
  check(def: AIActionDef, call: AIActionCall): GovernorVerdict {
    const { scene, characterName } = call;
    if (def.characters !== undefined && !def.characters.includes(characterName)) {
      return deny(`${characterName} may not use ${def.name}`);
    }

    const flags = computeContextFlags(scene);
    const characterConditions = CHARACTER_CONDITIONS.get(characterName);
    for (const flag of characterConditions?.requires ?? []) {
      if (!flags[flag]) return deny(`${characterName} acts only when ${flag}`);
    }
    for (const flag of characterConditions?.forbids ?? []) {
      if (flags[flag]) return deny(`${characterName} does not act while ${flag}`);
    }
    for (const flag of def.policy.requiresContext ?? []) {
      if (!flags[flag]) return deny(`${def.name} requires ${flag}`);
    }
    for (const flag of def.policy.forbidsContext ?? []) {
      if (flags[flag]) return deny(`${def.name} is not allowed while ${flag}`);
    }
    if (flags.isPaused && def.policy.severity !== 'benign') {
      return deny('the game is paused or a menu is open');
    }

    if (def.spawnsMobs === true) {
      if (flags.isPaused) return deny('no spawns while a menu is open');
      if (flags.inBossFight) return deny('no spawns during a boss fight');
      if (anyVulnerable(scene))
        return deny(`no spawns while a crawler is below ${LOW_HP_PERCENT}% HP`);
      if (flags.inCombat && anyHurt(scene)) {
        return deny(`no spawns mid-fight while a crawler is below ${HURT_IN_COMBAT_PERCENT}% HP`);
      }
    }

    const harmful = def.isHarmful?.(call) ?? def.policy.severity === 'harmful';
    if (harmful && anyVulnerable(scene)) {
      return deny(`nothing harmful while a crawler is below ${LOW_HP_PERCENT}% HP`);
    }
    if (harmful && flags.inCombat && anyHurt(scene)) {
      return deny(
        `nothing harmful mid-fight while a crawler is below ${HURT_IN_COMBAT_PERCENT}% HP`,
      );
    }

    const lastRun = this.lastRunAt.get(def.name);
    if (lastRun !== undefined && this.now() - lastRun < def.policy.cooldownMs) {
      return deny(`${def.name} is cooling down`);
    }

    const sessionCount = this.sessionCounts.get(def.name) ?? 0;
    const sessionCap = def.policy.maxPerSession;
    if (sessionCap !== undefined && sessionCount >= sessionCap) {
      return deny(`${def.name} has been used its ${sessionCap} times this session`);
    }

    const ledger = this.ledgerFor(scene);
    const floorCount = ledger.actionCounts.get(def.name) ?? 0;
    if (def.maxPerFloor !== undefined && floorCount >= def.maxPerFloor) {
      return deny(`${def.name} has been used its ${def.maxPerFloor} times on this floor`);
    }

    const draw = def.budget?.(call) ?? null;
    if (draw !== null) {
      const remaining = this.remainingBudget(scene, draw.pool);
      if (draw.amount > remaining) {
        return deny(`this floor's ${draw.pool} allowance has ${remaining} left`);
      }
    }

    const ownRefusal = def.refusal?.(call) ?? null;
    if (ownRefusal !== null) return deny(ownRefusal);
    return ALLOW;
  }

  /**
   * Charges a call that ran: its cooldown, its counts and its budget draw.
   * `draw` is the one measured before the call ran, since running it can
   * change what a fresh measurement would say (a fine empties the purse it
   * is sized from).
   */
  record(def: AIActionDef, call: AIActionCall, draw: AIBudgetDraw | null): void {
    this.lastRunAt.set(def.name, this.now());
    this.sessionCounts.set(def.name, (this.sessionCounts.get(def.name) ?? 0) + 1);
    const ledger = this.ledgerFor(call.scene);
    ledger.actionCounts.set(def.name, (ledger.actionCounts.get(def.name) ?? 0) + 1);
    if (draw !== null) {
      ledger.spent.set(draw.pool, (ledger.spent.get(draw.pool) ?? 0) + draw.amount);
    }
    this.store.save(floorKeyOf(call.scene), {
      actionCounts: Object.fromEntries(ledger.actionCounts),
      spent: Object.fromEntries(ledger.spent),
    });
  }

  /** What is left of a pool on the scene's floor. */
  remainingBudget(scene: AISceneContext, pool: AIBudgetPool): number {
    const allowance = FLOOR_BUDGETS[pool];
    const depthScale = allowance.scalesWithDepth ? floorNumberOf(scene) : 1;
    const cap = allowance.perFloor * depthScale;
    const spent = this.ledgerFor(scene).spent.get(pool) ?? 0;
    return Math.max(0, cap - spent);
  }

  /** Forgets every cooldown, count and spend, as a fresh session would. */
  reset(): void {
    this.lastRunAt.clear();
    this.sessionCounts.clear();
    this.floors.clear();
  }

  /**
   * Kept for the session and in the store, so neither walking through a door
   * and back nor reloading the save refills a floor's allowance.
   */
  private ledgerFor(scene: AISceneContext): FloorLedger {
    const key = floorKeyOf(scene);
    const existing = this.floors.get(key);
    if (existing !== undefined) return existing;
    const stored = this.store.load(key);
    const created: FloorLedger = {
      actionCounts: new Map(Object.entries(stored?.actionCounts ?? {})),
      spent: new Map(
        AI_BUDGET_POOLS.flatMap((pool) => {
          const amount = stored?.spent[pool];
          return amount === undefined ? [] : [[pool, amount] as const];
        }),
      ),
    };
    this.floors.set(key, created);
    return created;
  }
}
