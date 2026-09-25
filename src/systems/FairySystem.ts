/**
 * Owns what fairies do to a floor beyond their own AI: rooms whose fairy rates
 * rise when a boss dies, the links a living fairy holds to its allies, the ice
 * bolts in the air, and whatever a fairy leaves behind when it dies.
 *
 * Anything that has to outlive a fairy lives here rather than on the creature,
 * because a mob's own state dies with it. Death effects hang off `mobKilled`,
 * never off `dispose`, so a floor-end despawn fires none of them. Event-driven
 * work subscribes in the constructor and is released in {@link dispose};
 * per-frame work goes in {@link update}.
 *
 * The fire fairy's death is the one exception: its flame patch is a hazard
 * that deals damage over time, and `FairyFireballSystem` owns every fairy
 * hazard that does.
 */

import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { SpatialGrid } from '../core/SpatialGrid';
import { TILE_SIZE } from '../core/constants';
import { makeFairyAegis } from '../core/StatusEffect';
import { applyChillOnly } from '../core/frostStatus';
import { applyFairyRateUpgrade, type FairyRoomLedger } from '../levels/fairySpawner';
import { Fairy } from '../creatures/fairies/Fairy';
import { NecroFairy } from '../creatures/fairies/NecroFairy';
import { ShieldFairy } from '../creatures/fairies/ShieldFairy';
import {
  FairyCorpseLedger,
  isCorpseResurrectable,
  setFairyCorpseLedger,
  fairyCorpseLedger,
} from '../creatures/fairies/fairyCorpses';
import { applyHealingWave } from '../creatures/fairies/fairyHeal';
import { mobsWardedBy, stripWardsHeldBy, fairyWardOn } from '../creatures/fairies/fairyWards';
import {
  AEGIS_CHAIN_RADIUS_TILES,
  AEGIS_DURATION_FRAMES,
  CHILL_BLAST_RADIUS_TILES,
  HEAL_WAVE_EXPAND_FRAMES,
  HEAL_WAVE_RADIUS_TILES,
  NECRO_SKELETON_STRENGTH,
  RESURRECT_HP_FRACTION,
  RESURRECT_RISE_FRAMES,
} from '../creatures/fairies/fairyTuning';
import { necroSkeletonLevel } from '../creatures/fairies/fairyPotency';
import { statusRemainingFraction } from '../core/StatusEffect';
import {
  drawAegisChain,
  drawChillBlastRing,
  drawHealingWaveRing,
  drawNecroWisps,
  drawResurrectionColumn,
  drawResurrectionVeil,
  drawShieldDeathBurst,
  drawShieldTether,
  waveFrontFraction,
} from '../sprites/art/fairyEffectsArt';
import type { SkeletonSummonSystem } from './SkeletonSummonSystem';
import { collectFairyPartyTargets } from './fairyPartyTargets';
import { FairyIceBolts } from './fairyIceBolts';
import type { GameSystem, SystemContext } from './GameSystem';

/** What the system reads from and writes to the scene it lives in. */
export interface FairySystemDeps {
  readonly bus: EventBus;
  readonly gameMap: GameMap;
  /**
   * The floor's fairy rooms, or null on a floor with no room pass (the
   * overworld, the tutorial, an interior).
   */
  readonly ledger: FairyRoomLedger | null;
  readonly getMobs: () => readonly Mob[];
  readonly getCrawlers: () => readonly Player[];
  /** The scene's one spawn path. */
  readonly addMob: (mob: Mob) => void;
  /**
   * Where a necro fairy's death skeletons are raised. Null in a scene with no
   * skeleton system, where the necromancer's death raises nothing.
   */
  readonly skeletonSummons?: SkeletonSummonSystem | null;
}

/** A sound this system asks the scene to play; drained with {@link FairySystem.takeCues}. */
export type FairySystemCue =
  | 'shieldDeath'
  | 'healWave'
  | 'chillBlast'
  | 'necroDeath'
  | 'resurrection'
  | 'iceBoltShatter'
  | 'iceBoltHit';

/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE = 0.5;
/** Where a chain or tether meets a mob: its chest rather than its feet. */
const CHEST_HEIGHT_TILES = 0.2;

/** Frames the aegis chains crackle for after a shield fairy dies. */
const AEGIS_CHAIN_FRAMES = 42;
/** Frames the shattered-sigil burst plays at a shield fairy's death point. */
const SHIELD_BURST_FRAMES = 30;
/** Frames the ice fairy's death ring takes to roll out and fade. */
const CHILL_BLAST_FRAMES = 32;
/** Frames the wisps linger where a necro fairy died, covering its skeletons' rise. */
const NECRO_DEATH_WISP_FRAMES = 60;
/** How far into its life a lingering wisp patch starts to fade. */
const NECRO_WISP_FADE_START = 0.6;
/**
 * Frames between sweeps of the corpse ledger against the mob list. A corpse the
 * scene let go of in between is still refused by {@link FairySystem.resurrect},
 * so the sweep only has to stop a necro casting at it for long.
 */
const CORPSE_ROSTER_SWEEP_FRAMES = 30;

/** Distinct seeds per effect, so two effects laid on one frame never animate in lockstep. */
const SEED_STEP = 1;

interface ChainEffect {
  readonly fromX: number;
  readonly fromY: number;
  readonly target: Mob;
  readonly seed: number;
  age: number;
}

interface PointEffect {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
  age: number;
}

interface HealWave extends PointEffect {
  /** Mobs the front has already passed, so each is healed exactly once. */
  readonly reached: Set<Mob>;
}

interface ResurrectionEffect {
  readonly mob: Mob;
  readonly seed: number;
  age: number;
}

export class FairySystem implements GameSystem {
  private readonly unsubscribers: (() => void)[] = [];

  /** Deaths heard this frame whose effects still need the frame's context. */
  private pendingDeaths: Fairy[] = [];

  private readonly corpses = new FairyCorpseLedger();

  private chains: ChainEffect[] = [];
  private shieldBursts: PointEffect[] = [];
  private healWaves: HealWave[] = [];
  private chillBlasts: PointEffect[] = [];
  /** Every ice bolt in the air, whether or not the fairy that loosed it still lives. */
  readonly iceBolts: FairyIceBolts;
  private necroWisps: PointEffect[] = [];
  private resurrections: ResurrectionEffect[] = [];

  private readonly cues = new Set<FairySystemCue>();
  private frame = 0;
  private nextSeed = 0;

  private readonly partyScratch: Player[] = [];
  private readonly wardedScratch: Mob[] = [];
  private readonly mobSeeds = new WeakMap<Mob, number>();

  constructor(private readonly deps: FairySystemDeps) {
    this.iceBolts = new FairyIceBolts(deps.gameMap);
    this.unsubscribers.push(
      deps.bus.on('bossDefeated', (event) => this.applyRateUpgrade(event.bossType)),
      deps.bus.on('mobKilled', (event) => this.onMobKilled(event.mob)),
    );
  }

  /** The floor's fairy rooms, for anything that has to reason about them. */
  get ledger(): FairyRoomLedger | null {
    return this.deps.ledger;
  }

  /** The dead a necro fairy could raise. */
  get corpseLedger(): FairyCorpseLedger {
    return this.corpses;
  }

  /**
   * Raises untouched rooms to the rates `bossType`'s death unlocks, adding the
   * fairies to the roster. Called on the kill, and at build when a resumed save
   * says that boss is already dead. Safe to call more than once: a room is only
   * ever offered one boss's upgrade once.
   */
  applyRateUpgrade(bossType: string): void {
    const ledger = this.deps.ledger;
    if (ledger === null) return;
    const added = applyFairyRateUpgrade(
      ledger,
      bossType,
      this.deps.gameMap,
      this.deps.getMobs(),
      this.deps.getCrawlers(),
    );
    for (const fairy of added) this.deps.addMob(fairy);
  }

  /**
   * Re-aligns with a rewound roster: fairies the rewind removed are forgotten,
   * an upgrade whose boss the rewind brought back can be offered again when that
   * boss dies again, and every death and effect from the run that died is
   * dropped — a corpse the rewind stood back up is not a corpse.
   */
  resetForCheckpoint(roster: readonly Mob[], deadBossTypes: ReadonlySet<string>): void {
    this.corpses.clear();
    this.pendingDeaths = [];
    this.chains = [];
    this.shieldBursts = [];
    this.healWaves = [];
    this.chillBlasts = [];
    this.iceBolts.reset();
    this.necroWisps = [];
    this.resurrections = [];
    this.cues.clear();
    const ledger = this.deps.ledger;
    if (ledger === null) return;
    ledger.pruneMissing(roster);
    for (const upgrade of ledger.def.fairies?.upgrades ?? []) {
      if (!deadBossTypes.has(upgrade.bossType)) ledger.forgetUpgrade(upgrade.bossType);
    }
  }

  /** The cues raised since the last call, for the scene to play. */
  takeCues(): readonly FairySystemCue[] {
    if (this.cues.size === 0) return [];
    const taken = [...this.cues];
    this.cues.clear();
    return taken;
  }

  // ── Deaths ────────────────────────────────────────────────────────────────

  /**
   * One bus serves every storey of a tower, and each storey has its own
   * system, so a death on another storey's roster is not this system's.
   */
  private ownsMob(mob: Mob): boolean {
    return this.deps.getMobs().includes(mob);
  }

  private onMobKilled(mob: Mob): void {
    if (!this.ownsMob(mob)) return;
    this.corpses.record(mob);
    if (!(mob instanceof Fairy)) return;
    // Stripped on the kill itself rather than on the next update: a blow landing
    // later this frame on a mob the fairy was warding must already hit bare HP.
    // A crush already snapped around a vespa is cancelled the same way, so it
    // cannot go on to kill the vespa after the fairy that cast it is gone.
    if (mob instanceof ShieldFairy) {
      stripWardsHeldBy(mob, this.deps.getMobs());
      mob.cancelCrush();
    }
    this.pendingDeaths.push(mob);
  }

  /** Resolves one fairy's death effect. Public so a gate can drive it without a bus. */
  resolveDeath(fairy: Fairy, ctx: SystemContext): void {
    switch (fairy.kind) {
      case 'shield':
        this.resolveShieldDeath(fairy);
        return;
      case 'healer':
        this.beginHealingWave(fairy);
        return;
      case 'ice':
        this.resolveChillBlast(fairy, ctx);
        return;
      case 'necro':
        if (fairy instanceof NecroFairy) this.resolveNecroDeath(fairy);
        return;
      case 'fire':
        // `FairyFireballSystem` owns the flame patch and its explosion.
        return;
    }
  }

  /**
   * The shield fairy's parting gift: every ward it held comes off, and every
   * living hostile in reach — bosses included — takes the aegis instead, along
   * a chain of blue light from where the fairy fell.
   */
  private resolveShieldDeath(fairy: Fairy): void {
    const mobs = this.deps.getMobs();
    stripWardsHeldBy(fairy, mobs);
    const { x, y } = fairy.groundCentre;
    const origin = fairy.castOrigin;
    const radiusPx = TILE_SIZE * AEGIS_CHAIN_RADIUS_TILES;
    for (const mob of mobs) {
      if (mob === fairy || !mob.isAlive || !mob.isHostile) continue;
      const centre = mobCentre(mob);
      if (Math.hypot(centre.x - x, centre.y - y) > radiusPx) continue;
      mob.applyStatus(makeFairyAegis(AEGIS_DURATION_FRAMES));
      this.chains.push({
        fromX: origin.x,
        fromY: origin.y,
        target: mob,
        seed: this.seed(),
        age: 0,
      });
    }
    this.shieldBursts.push({ x: origin.x, y: origin.y, seed: this.seed(), age: 0 });
    this.cues.add('shieldDeath');
  }

  /**
   * The wave heals off screen as well, but only sounds on screen: a heal the
   * player cannot see changes nothing they can act on, and a chime from
   * nowhere reads as a bug.
   */
  private beginHealingWave(fairy: Fairy): void {
    const { x, y } = fairy.groundCentre;
    this.healWaves.push({ x, y, seed: this.seed(), age: 0, reached: new Set() });
    if (fairy.isOnScreen) this.cues.add('healWave');
  }

  /**
   * Advances each healing wave one frame and resolves it on every living
   * hostile its front has now passed — so a mob is healed on the frame the
   * drawn ring reaches it.
   */
  private advanceHealWaves(): void {
    if (this.healWaves.length === 0) return;
    const mobs = this.deps.getMobs();
    const maxRadiusPx = TILE_SIZE * HEAL_WAVE_RADIUS_TILES;
    for (const wave of this.healWaves) {
      wave.age++;
      const progress = Math.min(1, wave.age / HEAL_WAVE_EXPAND_FRAMES);
      const frontPx = maxRadiusPx * waveFrontFraction(progress);
      for (const mob of mobs) {
        if (wave.reached.has(mob) || !mob.isAlive || !mob.isHostile) continue;
        const centre = mobCentre(mob);
        if (Math.hypot(centre.x - wave.x, centre.y - wave.y) > frontPx) continue;
        wave.reached.add(mob);
        applyHealingWave(mob);
      }
    }
    this.healWaves = this.healWaves.filter((wave) => wave.age < HEAL_WAVE_EXPAND_FRAMES);
  }

  /**
   * The ice fairy's parting chill: every party member inside the blast is
   * chilled or has its chill refreshed. It never freezes and never wounds — a
   * death that could lock a crawler in place is a death the player is punished
   * for causing.
   */
  private resolveChillBlast(fairy: Fairy, ctx: SystemContext): void {
    const { x, y } = fairy.groundCentre;
    const radiusPx = TILE_SIZE * CHILL_BLAST_RADIUS_TILES;
    collectFairyPartyTargets(ctx, this.partyScratch);
    for (const target of this.partyScratch) {
      if (!target.isAlive) continue;
      const centre = playerCentre(target);
      if (Math.hypot(centre.x - x, centre.y - y) > radiusPx) continue;
      applyChillOnly(target);
    }
    this.partyScratch.length = 0;
    this.chillBlasts.push({ x, y, seed: this.seed(), age: 0 });
    this.cues.add('chillBlast');
  }

  /**
   * The necro fairy's parting army, sized by the difficulty stamped on it: as
   * lesser as the skeletons it summons in life, on its curve, already hunting,
   * and paying nothing — the fairy that called them is gone, so no cap applies.
   */
  private resolveNecroDeath(fairy: NecroFairy): void {
    const { x, y } = fairy.groundCentre;
    this.deps.skeletonSummons?.requestRaise({
      originX: fairy.x,
      originY: fairy.y,
      army: fairy.deathArmy,
      level: necroSkeletonLevel(fairy.mobLevel),
      curve: fairy.levelledCurve,
      strength: NECRO_SKELETON_STRENGTH,
      paysNoRewards: true,
    });
    this.necroWisps.push({ x, y, seed: this.seed(), age: 0 });
    this.cues.add('necroDeath');
  }

  // ── Resurrection ──────────────────────────────────────────────────────────

  /**
   * Stands `corpse` back up where it fell at a share of its HP, paying nothing
   * on its second death, with a dark column rising around it. Refused, returning
   * false, when the corpse is no longer eligible for `caster` — raised already,
   * out of range or sight, or compacted out of the roster, where a
   * revived body would fight on unseen by every system that walks the mobs.
   */
  resurrect(corpse: Mob, caster: Mob, grid: SpatialGrid<Mob>): boolean {
    const entry = this.corpses.entries.find((candidate) => candidate.mob === corpse);
    if (entry === undefined) return false;
    if (!this.ownsMob(corpse)) return false;
    if (!isCorpseResurrectable(entry, caster, this.deps.gameMap)) return false;
    corpse.reviveInPlace(RESURRECT_HP_FRACTION, grid);
    this.corpses.forget(corpse);
    this.resurrections.push({ mob: corpse, seed: this.seed(), age: 0 });
    this.cues.add('resurrection');
    return true;
  }

  private drainResurrections(ctx: SystemContext): void {
    for (const mob of ctx.roster.mobs) {
      if (!(mob instanceof NecroFairy)) continue;
      for (const corpse of mob.takePendingResurrections()) {
        this.resurrect(corpse, mob, ctx.roster.grid);
      }
    }
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.frame++;
    this.corpses.dropStanding();
    if (this.frame % CORPSE_ROSTER_SWEEP_FRAMES === 0) this.corpses.dropMissing(ctx.roster.mobs);
    setFairyCorpseLedger(this.corpses);

    const deaths = this.pendingDeaths;
    this.pendingDeaths = [];
    for (const fairy of deaths) this.resolveDeath(fairy, ctx);

    this.drainResurrections(ctx);
    collectFairyPartyTargets(ctx, this.partyScratch);
    this.iceBolts.update(ctx.roster.mobs, this.partyScratch);
    this.partyScratch.length = 0;
    for (const impact of this.iceBolts.takeImpacts()) {
      this.cues.add(impact === 'body' ? 'iceBoltHit' : 'iceBoltShatter');
    }
    this.advanceHealWaves();
    this.chains = ageOut(this.chains, AEGIS_CHAIN_FRAMES);
    this.shieldBursts = ageOut(this.shieldBursts, SHIELD_BURST_FRAMES);
    this.chillBlasts = ageOut(this.chillBlasts, CHILL_BLAST_FRAMES);
    this.necroWisps = ageOut(this.necroWisps, NECRO_DEATH_WISP_FRAMES);
    // Kept for as long as the mob is still standing up, read off the mob itself,
    // so the column and the rise it covers can never drift apart; the frame cap
    // only catches a mob that was knocked back down mid-rise.
    this.resurrections = ageOut(this.resurrections, RESURRECT_RISE_FRAMES).filter(
      (rising) => rising.mob.isReviving,
    );
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** Floor-level effects, drawn under every creature. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const maxWavePx = TILE_SIZE * HEAL_WAVE_RADIUS_TILES;
    for (const wave of this.healWaves) {
      const progress = Math.min(1, wave.age / HEAL_WAVE_EXPAND_FRAMES);
      drawHealingWaveRing(
        ctx,
        wave.x - camX,
        wave.y - camY,
        maxWavePx,
        progress,
        this.frame,
        wave.seed,
      );
    }
    const chillPx = TILE_SIZE * CHILL_BLAST_RADIUS_TILES;
    for (const blast of this.chillBlasts) {
      drawChillBlastRing(
        ctx,
        blast.x - camX,
        blast.y - camY,
        chillPx,
        blast.age / CHILL_BLAST_FRAMES,
        this.frame,
        blast.seed,
      );
    }
    for (const wisps of this.necroWisps) {
      const life = wisps.age / NECRO_DEATH_WISP_FRAMES;
      const intensity = Math.min(1, (1 - life) / (1 - NECRO_WISP_FADE_START));
      drawNecroWisps(
        ctx,
        wisps.x - camX,
        wisps.y - camY,
        TILE_SIZE,
        intensity,
        this.frame,
        wisps.seed,
      );
    }
    for (const rising of this.resurrections) {
      const centre = mobCentre(rising.mob);
      drawResurrectionColumn(
        ctx,
        centre.x - camX,
        rising.mob.y + TILE_SIZE - camY,
        TILE_SIZE,
        riseProgress(rising),
        this.frame,
        rising.seed,
      );
    }
    for (const mob of this.deps.getMobs()) {
      if (mob instanceof Fairy && mob.isAlive) {
        mob.drawGroundEffects(ctx, camX, camY, this.frame);
      }
    }
  }

  /** Effects that cross the fight through the air, drawn over every creature. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const mobs = this.deps.getMobs();
    for (const mob of mobs) {
      if (mob instanceof ShieldFairy && mob.isAlive) this.renderTethers(ctx, camX, camY, mob);
    }
    for (const chain of this.chains) {
      const to = chestPoint(chain.target);
      drawAegisChain(
        ctx,
        chain.fromX - camX,
        chain.fromY - camY,
        to.x - camX,
        to.y - camY,
        chain.age / AEGIS_CHAIN_FRAMES,
        this.frame,
        chain.seed,
      );
    }
    for (const burst of this.shieldBursts) {
      drawShieldDeathBurst(
        ctx,
        burst.x - camX,
        burst.y - camY,
        TILE_SIZE,
        burst.age / SHIELD_BURST_FRAMES,
        burst.seed,
      );
    }
    this.iceBolts.render(ctx, camX, camY, this.frame);
    for (const rising of this.resurrections) {
      const centre = mobCentre(rising.mob);
      drawResurrectionVeil(
        ctx,
        centre.x - camX,
        rising.mob.y + TILE_SIZE - camY,
        TILE_SIZE,
        riseProgress(rising),
        this.frame,
        rising.seed,
      );
    }
    for (const mob of mobs) {
      if (mob instanceof Fairy && mob.isAlive) mob.drawAirEffects(ctx, camX, camY, this.frame);
    }
  }

  /**
   * One tether from a living shield fairy to each ally it wards, read straight
   * off the wards themselves — so a tether can never outlive, or go missing
   * from, the ward it stands for.
   */
  private renderTethers(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    fairy: ShieldFairy,
  ): void {
    mobsWardedBy(fairy, this.deps.getMobs(), this.wardedScratch);
    if (this.wardedScratch.length === 0) return;
    const from = fairy.castOrigin;
    for (const ally of this.wardedScratch) {
      const ward = fairyWardOn(ally);
      const strength = ward === null ? 0 : statusRemainingFraction(ward);
      const to = chestPoint(ally);
      drawShieldTether(
        ctx,
        from.x - camX,
        from.y - camY,
        to.x - camX,
        to.y - camY,
        strength,
        this.frame,
        this.stableSeedFor(ally),
      );
    }
    this.wardedScratch.length = 0;
  }

  /** A seed that stays with `mob`, so its tether's pulse never jumps as it moves. */
  private stableSeedFor(mob: Mob): number {
    const known = this.mobSeeds.get(mob);
    if (known !== undefined) return known;
    const fresh = this.seed();
    this.mobSeeds.set(mob, fresh);
    return fresh;
  }

  private seed(): number {
    this.nextSeed += SEED_STEP;
    return this.nextSeed;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    if (fairyCorpseLedger() === this.corpses) setFairyCorpseLedger(null);
  }
}

/** 0 → 1 through a resurrected mob's rise. */
function riseProgress(rising: ResurrectionEffect): number {
  return rising.mob.reviveRiseProgress ?? 1;
}

/** Ages every effect one frame and keeps those still inside their lifetime. */
function ageOut<T extends { age: number }>(effects: T[], lifetimeFrames: number): T[] {
  if (effects.length === 0) return effects;
  for (const effect of effects) effect.age++;
  return effects.filter((effect) => effect.age < lifetimeFrames);
}

function playerCentre(target: Player): { x: number; y: number } {
  return { x: target.x + TILE_SIZE * TILE_CENTRE, y: target.y + TILE_SIZE * TILE_CENTRE };
}

function mobCentre(mob: Mob): { x: number; y: number } {
  return { x: mob.x + TILE_SIZE * TILE_CENTRE, y: mob.y + TILE_SIZE * TILE_CENTRE };
}

function chestPoint(mob: Mob): { x: number; y: number } {
  const centre = mobCentre(mob);
  return { x: centre.x, y: centre.y - TILE_SIZE * CHEST_HEIGHT_TILES };
}
