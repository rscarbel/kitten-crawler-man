/**
 * BriarHollowKit — the one field `DungeonScene` gets for the whole Ratkin
 * village, the way `CombatKit` and `DestructionKit` are the one field each of
 * their domains gets.
 *
 * Follows the scene-kit pattern: concrete typed members, not a `GameSystem[]`,
 * because the village's own systems (harvesting, construction, the siege) will
 * have update signatures as varied as combat's do. Every hook below is an
 * empty, typed stub — the village has no behaviour yet — so the call sites that
 * wire it into `DungeonScene` never have to change shape once the systems
 * behind them are filled in.
 *
 * Constructed only when `gameMap.briarHollow` is non-null — every generated
 * floor-3 overworld, and no other map. Everywhere else this kit is never
 * built, and every call site that reaches it is a no-op through optional
 * chaining.
 *
 * Durable village state — the quest phase, the structures, the soldier orders,
 * the talk counts — lives in `deps.state` (a `BriarHollowState`), threaded by
 * reference from `DungeonScene` and already captured and restored with the
 * rest of the world checkpoint. Nothing in this kit may hold its own copy of
 * any of that. `captureCheckpoint` / `restoreCheckpoint` here exist only for
 * state that is *not* durable — transient per-system bookkeeping (an open
 * menu's scroll position, a timer mid-countdown) that a death rewind on the
 * same scene instance should still put back, but that a save file has no
 * business remembering.
 */

import { HumanPlayer } from '../../creatures/HumanPlayer';
import {
  CAT_ATTACK_RANGE_TILES,
  HUMAN_ATTACK_RANGE_TILES,
  snapTargetAlong,
} from '../GameLoopPhases';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { AudioManager } from '../../audio/AudioManager';
import type { PartyTools } from '../../core/PartyTools';
import type { PartyCraftsState } from '../../core/partyCrafts';
import type { BriarHollowState } from '../../core/briarHollowState';
import type { keybindings } from '../../core/Keybindings';
import type { SceneWorld } from '../kits/SceneWorld';
import type { MenusKit } from '../kits/MenusKit';
import type { OverlayInputClaim } from '../kits/OverlayClaims';
import type { SystemContext } from '../GameSystem';
import type { TownPropRenderable } from '../townPropRenderable';
import type { QuestMarkerType } from '../MiniMapSystem';
import type { TrackerEntry } from '../questTracker';
import { RatkinCastPrewarm } from './ratkinCastPrewarm';
import { VillageAmbience } from './VillageAmbience';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import { MAX_TOOL_TIER, TOOL_TIER_BASIC, isToolTier, type ToolTier } from '../../core/toolTiers';
import { VILLAGER_TALK_RANGE_TILES, VillagerSystem } from './VillagerSystem';
import { TILE_SIZE } from '../../core/constants';
import type { VillagerPartyState } from './villagerCircumstances';
import { partyCount } from '../../core/partyResources';
import { hostileWithinAttackRange } from '../interactionPromptGate';
import { interactionPromptsDrawnThisFrame } from '../../ui/InteractionPrompt';
import type { GroundPickupSystem } from '../GroundPickupSystem';
import {
  type BlastThreat,
  LivestockSystem,
  PANIC_RADIUS_TILES,
  PET_RANGE_TILES,
} from './LivestockSystem';
import type { DynamiteSystem } from '../DynamiteSystem';
import { ConstructionKit } from './ConstructionKit';
import { VillageServices } from './services/VillageServices';
import { SoldierSystem } from './SoldierSystem';
import type { Player } from '../../Player';
import { renderNecromancerTelegraphs } from '../../creatures/Necromancer';
import type { ItemId } from '../../core/ItemDefs';
import { activeDifficultyProfile } from '../../core/difficultyProfiles';
import type { MiniMapSystem } from '../MiniMapSystem';
import type { Rect } from '../DungeonUIRenderer';
import { siegeHudSlot } from './siegeHudLayout';
import { VillageAssaultSystem, type SiegeMusicClaim } from './VillageAssaultSystem';
import { VillageQuestSystem } from './VillageQuestSystem';
import { RecruiterSystem } from './RecruiterSystem';

/** The live `Keybindings` singleton's own type, which the class itself does not export. */
type KeybindingsHost = typeof keybindings;

/** A tile-anchored point, matching what every other `humanTalkSpeaker` in this codebase returns. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Transient, non-durable kit state a death rewind on the same scene instance
 * should restore. Empty today: no system inside the kit holds anything yet.
 */
export type BriarHollowKitCheckpoint = Record<string, never>;

export interface BriarHollowKitDeps {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** Wraps `deps.partyCrafts.tools` — the party-wide axe/pickaxe tier state. */
  readonly partyTools: PartyTools;
  readonly partyCrafts: PartyCraftsState;
  /** The village's durable state, threaded by reference from `DungeonScene`. */
  readonly state: BriarHollowState;
  readonly menus: MenusKit;
  readonly audio: AudioManager | null;
  readonly keybindings: KeybindingsHost;
  /** Where a dead cow's burgers land. */
  readonly groundPickups: GroundPickupSystem;
  /** Read for the sticks alight near the herd, so it can warm what a blast would draw. */
  readonly dynamite: DynamiteSystem;
  /** Keeps the resource strip up while something is being built or loaded. */
  readonly noteResourceActivity: () => void;
  /** Told of every village tile whose type changed at runtime, for the minimap. */
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /**
   * Whether the world is stopped under a menu. The kit is ticked through
   * those, so anything timed that the player is meant to watch — a cut at the
   * sawmill, Sella's treatment — asks this and waits. Absent means never.
   */
  readonly worldHalted?: () => boolean;
  /** The level the siege's undead come at, which the militia is levelled to meet. */
  readonly assaultLevel: () => number;
  /**
   * Whether a body stands in a safe room, where nothing the village's
   * defences throw may land. Absent means nowhere is.
   */
  readonly isInSafeRoom?: (point: { readonly x: number; readonly y: number }) => boolean;
  /** The overworld's zone music, which the siege's track takes over from while it runs. */
  readonly music?: () => SiegeMusicClaim | null;
  /** Plays a boss's intro: the necromancer's, as he arrives with the last wave. */
  readonly bossIntro?: (name: string, color: string) => void;
  /** Drops items on the floor as a loot pile, for a quest reward that does not fit the bag. */
  readonly dropItems?: (
    x: number,
    y: number,
    items: ReadonlyArray<{ id: ItemId; quantity: number }>,
  ) => void;
  /** A quest coin reward was just granted — for a fly-to-HUD effect. */
  readonly onCoinsGranted?: (coins: number, worldX: number, worldY: number) => void;
  /** A quest item reward was just granted straight into the bag (not dropped) — for a fly-to-HUD effect. */
  readonly onItemGranted?: (id: ItemId, quantity: number, worldX: number, worldY: number) => void;
}

export class BriarHollowKit {
  private readonly world: SceneWorld;
  private readonly deps: BriarHollowKitDeps;
  private readonly castPrewarm = new RatkinCastPrewarm();
  /**
   * The village's moving dressing — the bell, the sawmill blade, hearth fires,
   * smoke, lamp glow, laundry. `ambience.sawmill.working` and
   * `ambience.bell.ringing` are the switches the sawmill and the siege flip.
   */
  readonly ambience = new VillageAmbience();
  /** Reused every frame so the merged entity list costs no allocation. */
  private readonly entityBuffer: TownPropRenderable[] = [];

  /** The sawmill's switch: set `working` while it processes, and the blade spins. */
  get sawmill(): { working: boolean } {
    return this.ambience.sawmill;
  }

  /** The bell's switch: set `ringing` during the siege, and it swings and rings. */
  get bell(): { ringing: boolean } {
    return this.ambience.bell;
  }
  /** The village's civilians and the conversation panel; null on a map with no village. */
  readonly villagers: VillagerSystem | null;
  /** The herd in the paddock; null on a map with no village. */
  readonly livestock: LivestockSystem | null;
  /** The palisade, the gate, trebuchets and snares, and building them; null on a map with no village. */
  readonly defences: ConstructionKit | null;
  /** The shops, the infirmary, the forge and wood processing; null on a map with no village. */
  readonly services: VillageServices | null;
  /** The militia and their orders; null on a map with no village. */
  readonly soldiers: SoldierSystem | null;
  /** The siege: the countdown, the waves, the bell and how it ends; null on a map with no village. */
  readonly assault: VillageAssaultSystem | null;
  /** "Briar Hollow's Plea", the questline; null on a map with no village. */
  readonly quest: VillageQuestSystem | null;
  /** The recruiter posted in the Over City's own square; null on a map with no village. */
  readonly recruiter: RecruiterSystem | null;

  constructor(sceneWorld: SceneWorld, deps: BriarHollowKitDeps) {
    this.world = sceneWorld;
    this.deps = deps;
    const site = sceneWorld.gameMap.briarHollow;
    this.villagers =
      site === null
        ? null
        : new VillagerSystem({
            gameMap: sceneWorld.gameMap,
            site,
            state: deps.state,
            bus: sceneWorld.bus,
            audio: deps.audio,
            party: () => this.partyState(),
          });
    this.livestock =
      site === null
        ? null
        : new LivestockSystem({
            gameMap: sceneWorld.gameMap,
            site,
            roster: sceneWorld.roster,
            bus: sceneWorld.bus,
            groundPickups: deps.groundPickups,
            questPhase: () => deps.state.quest.phase,
            blastThreats: () => this.blastThreats(),
          });
    this.defences =
      site === null
        ? null
        : new ConstructionKit({
            world: sceneWorld,
            site,
            human: deps.human,
            cat: deps.cat,
            state: deps.state,
            menus: deps.menus,
            audio: deps.audio,
            noteResourceActivity: deps.noteResourceActivity,
            onTileChanged: deps.onTileChanged,
            villagers: () => this.villagers?.villagers ?? [],
            clockSeconds: () => deps.state.villagers.clockSeconds,
            isInSafeRoom: (point) => deps.isInSafeRoom?.(point) === true,
            worldHalted: () => deps.worldHalted?.() === true,
          });
    const villagers = this.villagers;
    this.services =
      site === null || villagers === null
        ? null
        : new VillageServices({
            human: deps.human,
            cat: deps.cat,
            state: deps.state,
            partyTools: deps.partyTools,
            partyCrafts: deps.partyCrafts,
            site,
            villagers,
            bus: sceneWorld.bus,
            audio: deps.audio,
            sawmill: this.ambience.sawmill,
            menus: {
              enqueueReward: (reward) => deps.menus.rewardGrantedDialog.enqueue(reward),
              afterRewardsDrain: (run) => deps.menus.rewardGrantedDialog.afterQueueDrains(run),
              openResourcingExplainer: () => void deps.menus.craftExplainers.open('resourcing'),
              announce: (message) => deps.menus.announce(message),
            },
            isInteractKey: (key) => deps.keybindings.actionFor(key) === 'attack',
            noteResourceActivity: deps.noteResourceActivity,
            worldHalted: () => deps.worldHalted?.() === true,
          });
    this.soldiers =
      site === null || villagers === null
        ? null
        : new SoldierSystem({
            gameMap: sceneWorld.gameMap,
            site,
            roster: sceneWorld.roster,
            state: deps.state,
            villagers,
            defense: () => this.defences?.defense ?? null,
            audio: deps.audio,
            human: deps.human,
            cat: deps.cat,
            level: deps.assaultLevel,
            // Lazy: the assault is built after the militia it moves.
            battleLane: () => this.assault?.attackSide ?? null,
            worldHalted: () => deps.worldHalted?.() === true,
          });
    const defense = this.defences?.defense ?? null;
    if (defense !== null) {
      deps.dynamite.onStructureBlast = (cx, cy, radiusPx) =>
        defense.blastInRadius(cx, cy, radiusPx);
    }
    // The questline first: a siege the scene is rebuilt in the middle of is
    // settled as the assault system is built, and settling it moves the phase.
    this.quest =
      site === null || villagers === null || defense === null
        ? null
        : new VillageQuestSystem({
            bus: sceneWorld.bus,
            audio: deps.audio,
            state: deps.state,
            site,
            human: deps.human,
            cat: deps.cat,
            partyCrafts: deps.partyCrafts,
            villagers,
            defense,
            assault: () => this.assault,
            active: () => (deps.human.isActive ? deps.human : deps.cat),
            openConstructionExplainer: () => void deps.menus.craftExplainers.open('construction'),
            enqueueReward: (reward) => deps.menus.rewardGrantedDialog.enqueue(reward),
            afterRewardsDrain: (run) => deps.menus.rewardGrantedDialog.afterQueueDrains(run),
            announce: (message) => deps.menus.announce(message),
            groundPickups: deps.groundPickups,
            dropItems: (x, y, items) => deps.dropItems?.(x, y, items),
            onCoinsGranted: (coins, worldX, worldY) => deps.onCoinsGranted?.(coins, worldX, worldY),
            onItemGranted: (id, quantity, worldX, worldY) =>
              deps.onItemGranted?.(id, quantity, worldX, worldY),
            // Lazy: the recruiter is built after the questline it reads from.
            recruiter: () => this.recruiter?.post ?? null,
          });
    this.recruiter =
      site === null || this.quest === null
        ? null
        : new RecruiterSystem({
            gameMap: sceneWorld.gameMap,
            bus: sceneWorld.bus,
            state: deps.state,
            audio: deps.audio,
            quest: this.quest,
          });
    const soldiers = this.soldiers;
    this.assault =
      site === null || defense === null
        ? null
        : new VillageAssaultSystem({
            gameMap: sceneWorld.gameMap,
            site,
            state: deps.state,
            bus: sceneWorld.bus,
            roster: sceneWorld.roster,
            defense,
            ambience: this.ambience,
            audio: deps.audio,
            setPhase: (phase) => this.quest?.setPhase(phase),
            waveLevel: deps.assaultLevel,
            difficulty: activeDifficultyProfile,
            downedSoldiers: () => soldiers?.soldiers.filter((soldier) => soldier.isDowned) ?? [],
            mayorBark: () => void this.villagers?.bark('bramblewick', 'attack_started', true),
            bossIntro: (name, color) => deps.bossIntro?.(name, color),
            music: () => deps.music?.() ?? null,
            crawlers: () => [deps.human, deps.cat],
          });
  }

  /**
   * Every bang that may be coming: each burning stick, which can only go off
   * where it lies; a stick in Carl's hand, which could land anywhere he can
   * throw it; and a Smush winding up, which lands round his feet.
   */
  private blastThreats(): BlastThreat[] {
    const { human, dynamite } = this.deps;
    const threats: BlastThreat[] = dynamite.pendingBlastPoints(human).map((point) => ({
      x: point.x,
      y: point.y,
      reachTiles: point.inHand ? STICK_IN_HAND_REACH_TILES : PANIC_RADIUS_TILES,
      // Where a stick still in hand will kill is not known until it lands.
      killReachTiles: point.inHand ? 0 : point.radiusPx / TILE_SIZE,
    }));
    if (human.smushTimer > 0) {
      threats.push({
        x: human.x + TILE_SIZE * TILE_CENTRE_FRACTION,
        y: human.y + TILE_SIZE * TILE_CENTRE_FRACTION,
        reachTiles: SMUSH_REACH_TILES,
        killReachTiles: SMUSH_REACH_TILES,
      });
    }
    return threats;
  }

  /** The party as a villager sees it: combined stone, shared tools, and each crawler's own Construction. */
  private partyState(): VillagerPartyState {
    const { human, cat, partyCrafts } = this.deps;
    const constructionLevel = (crawler: HumanPlayer | CatPlayer): number =>
      crawler.craftSkills.isLearned('construction')
        ? crawler.craftSkills.getLevel('construction')
        : 0;
    return {
      hpFractions: { human: human.hp / human.maxHp, cat: cat.hp / cat.maxHp },
      stone: partyCount(human, cat, 'stone'),
      axeTier: partyCrafts.tools.axeTier,
      pickaxeTier: partyCrafts.tools.pickaxeTier,
      constructionLevels: { human: constructionLevel(human), cat: constructionLevel(cat) },
      constructionLearned:
        human.craftSkills.isLearned('construction') || cat.craftSkills.isLearned('construction'),
    };
  }

  /** The scene's shared map, event bus, audio and population — read by whichever system built inside this kit needs it. */
  protected get sceneWorld(): SceneWorld {
    return this.world;
  }

  /** What this kit was constructed with. Read by every stub above once it has behaviour to fill in. */
  protected get kitDeps(): BriarHollowKitDeps {
    return this.deps;
  }

  /**
   * Runs once per gameplay frame, in the phase `TownLifeSystem` runs in — the
   * "the village keeps living" block that ticks even while a street
   * conversation or another non-halting overlay is open, and stops only for a
   * hard halt (game over, the pause menu, a level- or run-complete screen).
   */
  update(ctx: SystemContext): void {
    const site = ctx.gameMap.briarHollow;
    // Not while the siege is on: the civilians are all in shelter, and warming
    // their rows would claim the figure cache the waves' arrivals are held in.
    if (site !== null && this.assault?.inSiege !== true) {
      this.castPrewarm.update(ctx.active.x, ctx.active.y, site.palisadeBounds);
    }
    this.villagers?.update({ human: ctx.human, cat: ctx.cat, active: ctx.active });
    this.livestock?.update({ human: ctx.human, cat: ctx.cat, active: ctx.active });
    this.defences?.update();
    this.services?.update();
    this.soldiers?.update({ human: ctx.human, cat: ctx.cat, active: ctx.active });
    this.recruiter?.update();
    const tools = this.deps.partyCrafts.tools;
    this.ambience.setToolTiers(nextToolTier(tools.axeTier), nextToolTier(tools.pickaxeTier));
    this.ambience.update(ctx.gameMap, SECONDS_PER_UPDATE);
  }

  /**
   * Ground-layer painting — anything that must sit under every body, drawn
   * immediately after `RenderPipeline.renderWorld` and before the Y-sorted
   * entity pass.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.defences?.renderGround(ctx, camX, camY);
    renderNecromancerTelegraphs(ctx, camX, camY, this.world.roster.mobs);
  }

  /**
   * The village's Y-sorted bodies and props, in the same shape `TownPropSystem`
   * and `MarketSystem` hand `DungeonScene` — merged into the scene's one
   * Y-sorted renderable list rather than drawn through a separate pass, so a
   * villager standing in a doorway sorts against the door the same way a
   * townsperson does.
   */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    const buffer = this.entityBuffer;
    buffer.length = 0;
    for (const villager of this.villagers?.villagers ?? []) buffer.push(villager);
    for (const piece of this.recruiter?.renderEntities() ?? []) buffer.push(piece);
    for (const piece of this.ambience.renderEntities()) buffer.push(piece);
    for (const piece of this.defences?.renderEntities() ?? []) buffer.push(piece);
    return buffer;
  }

  /**
   * Drawn over every body, in the effects pass — telegraphs, floating text,
   * anything that must never be occluded by a mob or a crawler standing in
   * front of it.
   */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.ambience.renderAbove(ctx, camX, camY, viewportWidth(), viewportHeight());
    this.livestock?.renderAbove(ctx, camX, camY);
    this.defences?.renderAbove(ctx, camX, camY);
    this.services?.renderAbove(ctx, camX, camY);
    this.assault?.renderAbove(ctx, camX, camY);
    this.soldiers?.renderAbove(
      ctx,
      camX,
      camY,
      this.deps.human.isActive ? this.deps.human : this.deps.cat,
    );
  }

  /**
   * One gameplay update of the siege — in the phase the floors' defend quest
   * runs in, so the countdown and the waves stop whenever gameplay does.
   */
  updateSiege(ctx: SystemContext): void {
    this.assault?.update({ active: ctx.active });
  }

  /**
   * Screen-space chrome, drawn after the HUD panel: the siege's banner, bell
   * and boss bars, in the top band under the resource strip's row so the two
   * never overlap.
   */
  renderHud(ctx: CanvasRenderingContext2D, miniMap: MiniMapSystem, hudRect: Rect): void {
    this.assault?.renderHud(ctx, siegeHudSlot(miniMap, hudRect));
  }

  /**
   * Whether the resource strip gives up its place to the siege's panel this
   * frame: only during the siege, and only on a window too small for both.
   */
  hidesResourceStrip(miniMap: MiniMapSystem, hudRect: Rect): boolean {
    if (this.assault?.inSiege !== true) return false;
    return siegeHudSlot(miniMap, hudRect).hidesResourceStrip;
  }

  /**
   * Floats a SPACE prompt over the nearest interactive village fixture, the
   * same way `renderPropPrompt` asks the market and the town props systems.
   * Returns whether it drew one, so the scene's prompt chain can stop asking
   * further consumers once somebody has answered.
   */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    // A prop, stall or sign prompt already up means an earlier link of the
    // Space chain takes the press.
    if (interactionPromptsDrawnThisFrame() > 0) return false;
    // A wall in reach and in front of the crawler is the most specific target
    // there is: nothing else stands where it stands.
    if (this.defences?.renderWallBuildPrompt(ctx, camX, camY, active) === true) return true;
    // Same order as `tryInteract`, so the prompt names what the press reaches.
    if (this.livestock?.renderPrompt(ctx, camX, camY, active) === true) return true;
    if (this.services?.renderPrompt(ctx, camX, camY, active) === true) return true;
    if (this.recruiter?.renderPrompt(ctx, camX, camY, active) === true) return true;
    if (this.soldierIsNearer(active)) {
      return this.soldiers?.renderPrompt(ctx, camX, camY, active) === true;
    }
    if (this.villagers?.renderPrompt(ctx, camX, camY, active) === true) return true;
    return this.soldiers?.renderPrompt(ctx, camX, camY, active) === true;
  }

  /**
   * The Space chain's entry into the village: called after the market and
   * bounty consumers have had first refusal, and before the citizen-talk
   * fallback, so a press near a villager or a village fixture never falls
   * through to "talk to the nearest townsperson" instead. Returns whether the
   * press was claimed.
   */
  tryInteract(active: HumanPlayer | CatPlayer): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    // A wall the crawler is squarely facing is the most specific thing a press
    // can mean, and never overlaps a villager or a fixture.
    if (this.defences?.tryBuildWall() === true) return true;
    // A cow in reach is petted before a villager is spoken to: the herd is
    // fenced in, so the only villager ever that close is one leaning on the
    // rail, and the press is plainly meant for the animal.
    if (this.livestock?.tryPet(active) === true) return true;
    // A machine at the sawmill before whoever works beside it, unless that
    // villager stands nearer than the machine does.
    if (this.services?.tryInteract(active) === true) return true;
    if (this.recruiter?.tryInteract(active) === true) return true;
    const soldier = this.soldierIsNearer(active) ? this.soldiers?.talkTarget(active) : null;
    if (soldier !== null && soldier !== undefined) {
      this.soldiers?.talkTo(soldier.soldier, active);
      return true;
    }
    if (this.villagers?.tryTalk(active) === true) return true;
    const fallback = this.soldiers?.talkTarget(active) ?? null;
    if (fallback === null || this.isConversationOpen) return false;
    this.soldiers?.talkTo(fallback.soldier, active);
    return true;
  }

  /**
   * Whether the soldier a press would reach stands nearer than the villager
   * it would reach, so the press talks to whoever is really in front of the
   * crawler.
   */
  private soldierIsNearer(active: HumanPlayer | CatPlayer): boolean {
    const soldier = this.soldiers?.talkTarget(active) ?? null;
    if (soldier === null) return false;
    const villager = this.villagers?.talkTarget(active) ?? null;
    if (villager === null) return true;
    const villagerTiles = Math.hypot(villager.x - active.x, villager.y - active.y) / TILE_SIZE;
    return soldier.tiles < villagerTiles;
  }

  /**
   * Every standing soldier and every enemy a snare turned, for the scene's
   * list of bodies hostiles may pick: the village's allied defenders, apart
   * from the one hired-hand slot. Without them there, an ally could hit an
   * enemy and never be hit back.
   */
  pushAlliedDefenders(out: Player[]): void {
    this.soldiers?.pushAlliedDefenders(out);
    for (const ally of this.defences?.allies.mobs ?? []) out.push(ally);
  }

  /**
   * Whether a press from `active` would be taken by the village — a cow to pet
   * or a villager to talk to. The predicate `tryInteract` is built on, for any
   * later link of the Space chain that draws a prompt of its own and must stay
   * quiet when the village would take the press first.
   */
  wouldInteract(active: HumanPlayer | CatPlayer): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    if (this.livestock?.wouldPet(active) === true) return true;
    if (this.services?.wouldInteract(active) === true) return true;
    if (this.recruiter?.wouldInteract(active) === true) return true;
    const villagers = this.villagers;
    return (
      villagers !== null &&
      !villagers.isConversationOpen &&
      (villagers.talkTarget(active) !== null ||
        (this.soldiers?.talkTarget(active) ?? null) !== null)
    );
  }

  /** The screen shake a boulder landing near the active crawler raises. */
  get cameraOffset(): { x: number; y: number } {
    return this.defences?.trebuchets.cameraOffset ?? NO_CAMERA_OFFSET;
  }

  /** Opens the Structure menu (`E`) on the nearest construction in reach. Returns whether it opened. */
  tryStructureMenu(): boolean {
    return this.defences?.tryStructureMenu() === true;
  }

  /** Opens (or closes) the Construction menu (`U`). Indoors has its own read-only menu. */
  openConstruction(): void {
    this.defences?.openConstruction();
  }

  /**
   * The repair key (`X`): mends the nearest hurt structure in reach, or with
   * nothing to mend, deposits as much stone as fits into the nearest trebuchet.
   */
  repairOrLoad(): void {
    this.defences?.repairOrLoad();
  }

  /**
   * Long-tap's mobile equivalent of the Structure menu key. Taken only when a
   * construction is under the finger, so every other long-press in the world
   * keeps meaning what it meant. Returns whether it was consumed.
   */
  handleLongPress(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    if (this.defences?.handleLongPress(screenX, screenY, camX, camY) === true) return true;
    // Held on a sawmill machine: keep working it, the touch version of holding the key.
    return this.services?.handleLongPress(screenX + camX, screenY + camY, active) === true;
  }

  /** Whether a finger held here is on a construction the active crawler can work on. */
  isStructureUnderFinger(screenX: number, screenY: number, camX: number, camY: number): boolean {
    return this.defences?.isStructureUnderFinger(screenX, screenY, camX, camY) === true;
  }

  /** Double-tap on a trebuchet: Quick Load it. Returns whether it was consumed. */
  handleDoubleTap(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    if (this.defences?.handleDoubleTap(screenX, screenY, camX, camY) === true) return true;
    // A second quick tap on a cow is still a tap on a cow.
    return this.tapCow(screenX + camX, screenY + camY, active);
  }

  /**
   * A tap on a living cow at world pixel (`worldX`, `worldY`): pets it when in
   * reach, and is taken even out of reach — a tap that fell through would aim
   * the attack at the tap, straight into the cow, where a missile kills it.
   * The tap is left to the attack only when the attack would really turn from
   * the cow to a hostile: one the aim snap finds along the tap's direction. A
   * hostile in range but outside that cone — behind the crawler — would not
   * pull the shot off the cow. With any hostile in range the cow is not petted,
   * as the Space chain would not pet it either.
   */
  private tapCow(worldX: number, worldY: number, active: HumanPlayer | CatPlayer): boolean {
    const livestock = this.livestock;
    if (livestock === null) return false;
    const cow = livestock.cowAtPoint(worldX, worldY);
    if (cow === null) return false;
    const hostileNear = hostileWithinAttackRange(active, this.world.roster.grid);
    if (hostileNear && this.tapAimsAtHostile(worldX, worldY, active)) return false;
    const cowTilesAway = Math.hypot(cow.x - active.x, cow.y - active.y) / TILE_SIZE;
    if (!hostileNear && cowTilesAway <= PET_RANGE_TILES) livestock.petCow(cow, active);
    return true;
  }

  /**
   * Whether an attack aimed at world pixel (`worldX`, `worldY`) — the way a
   * tap aims it — would snap round to a hostile: the same search, from the
   * same centre, over the same range, as `triggerPlayerAttack` makes.
   */
  private tapAimsAtHostile(
    worldX: number,
    worldY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    const dx = worldX - (active.x + TILE_SIZE * TILE_CENTRE_FRACTION);
    const dy = worldY - (active.y + TILE_SIZE * TILE_CENTRE_FRACTION);
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return true;
    const rangeTiles =
      active instanceof HumanPlayer ? HUMAN_ATTACK_RANGE_TILES : CAT_ATTACK_RANGE_TILES;
    const target = snapTargetAlong(
      active,
      dx / distance,
      dy / distance,
      rangeTiles * TILE_SIZE,
      this.world.roster.grid,
      this.world.gameMap,
    );
    return target !== null;
  }

  /**
   * A single world tap's mobile equivalent of `tryInteract`: a tap on a
   * villager's body, while they are in talking range, talks to that villager
   * rather than to whoever happens to be nearest. Returns whether it was consumed.
   */
  handleTap(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    const villagers = this.villagers;
    if (villagers === null || villagers.isConversationOpen) return false;
    // The cow comes first: it decides for itself whether a hostile would take the tap.
    if (this.tapCow(screenX + camX, screenY + camY, active)) return true;
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    if (this.services?.handleTap(screenX + camX, screenY + camY, active) === true) return true;
    if (this.handleRecruiterTap(screenX + camX, screenY + camY, active)) return true;
    const tappedSoldier = this.soldiers?.soldierAtPoint(screenX + camX, screenY + camY) ?? null;
    if (tappedSoldier !== null) {
      const soldierTiles =
        Math.hypot(tappedSoldier.x - active.x, tappedSoldier.y - active.y) / TILE_SIZE;
      if (soldierTiles > VILLAGER_TALK_RANGE_TILES) return false;
      this.soldiers?.talkTo(tappedSoldier, active);
      return true;
    }
    const tapped = villagers.villagerAtPoint(screenX + camX, screenY + camY);
    if (tapped === null) return false;
    const tilesAway = Math.hypot(tapped.x - active.x, tapped.y - active.y) / TILE_SIZE;
    if (tilesAway > VILLAGER_TALK_RANGE_TILES) return false;
    villagers.talkTo(tapped, active);
    return true;
  }

  /**
   * A single world tap's mobile equivalent of `tryInteract`, for the recruiter
   * specifically: a tap on his own body, in his talking range, talks to him
   * rather than falling through to whoever else the tap might also reach.
   * Returns whether it was consumed.
   */
  private handleRecruiterTap(
    worldX: number,
    worldY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    if (this.recruiter?.atPoint(worldX, worldY) !== true) return false;
    return this.recruiter.tryInteract(active);
  }

  /** Whether a villager conversation is on screen. */
  get isConversationOpen(): boolean {
    return this.villagers?.isConversationOpen === true;
  }

  /** Whether one of the construction menus is up. */
  get isMenuOpen(): boolean {
    return this.defences?.isMenuOpen === true || this.services?.isMenuOpen === true;
  }

  /** Number keys pick a conversation choice; the construction menus take their own keys. Returns whether the key was taken. */
  handleKeyDown(key: string, repeat = false): boolean {
    if (this.quest?.handleKeyDown(key) === true) return true;
    if (this.defences?.handleKeyDown(key, repeat) === true) return true;
    if (this.services?.handleKeyDown(key) === true) return true;
    return this.villagers?.conversation.handleKeyDown(key) === true;
  }

  /** A click or tap on a village panel. Returns whether it landed on one. */
  handleClick(mx: number, my: number): boolean {
    if (this.quest?.handleClick(mx, my) === true) return true;
    if (this.recruiter?.handleClick(mx, my) === true) return true;
    if (this.defences?.handleClick(mx, my) === true) return true;
    if (this.services?.handleClick(mx, my) === true) return true;
    return this.villagers?.conversation.handleClick(mx, my) === true;
  }

  /**
   * A press going down: starts a held step on whichever quantity picker is
   * up, which repeats until {@link handlePointerUp}.
   */
  handlePointerDown(mx: number, my: number): void {
    this.defences?.handlePointerDown(mx, my);
    this.services?.picker.handlePointerDown(mx, my);
  }

  handlePointerUp(): void {
    this.defences?.handlePointerUp();
    this.services?.picker.handlePointerUp();
  }

  /** Whether the village's own dismantle confirm is what has halted the world. */
  get haltsWorldItself(): boolean {
    if (this.quest?.isConfirmOpen === true) return true;
    return this.defences?.haltsWorldItself === true;
  }

  /** Closes every construction panel, the picker and the confirm included. */
  closeConstructionPanels(): void {
    this.defences?.closeAllPanels();
    this.quest?.closeConfirm();
  }

  /**
   * Closes the shops' priced menu and Fenna's picker. The scene calls it on
   * death: the kit is not ticked under the death screen, so nothing else
   * would take them down before they caught its first click.
   */
  closeServicePanels(): void {
    this.services?.closePanels();
  }

  /** Silences the village's looping sounds for a hard stop (pause, death) the kit is not ticked through. */
  silenceLoops(): void {
    this.services?.silenceLoops();
  }

  /** The mouse wheel, for a village shop whose rows run past the bottom of the screen. */
  handleWheel(deltaY: number): void {
    this.services?.handleWheel(deltaY);
  }

  /** Escape: closes the conversation. Returns whether there was one to close. */
  dismissDialog(): boolean {
    if (this.defences?.dismissDialog() === true) return true;
    if (this.recruiter?.dismissDialog() === true) return true;
    const villagers = this.villagers;
    if (villagers?.isConversationOpen !== true) return false;
    villagers.closeConversation();
    return true;
  }

  /** The conversation panel and the construction menus, drawn with the scene's other dialogs. */
  renderDialog(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.villagers?.conversation.render(ctx);
    this.defences?.renderDialog(ctx, camX, camY);
    this.services?.renderDialog(ctx);
    this.recruiter?.renderDialog(ctx);
    // Last: the "We're ready" confirm sits over everything else the village draws.
    this.quest?.renderDialog(ctx);
  }

  /**
   * The village's menus, in the shape `DungeonScene.overlayClaims` spreads
   * straight into its own list, ranked with the other floor menus. Empty until
   * a village menu exists; the conversation is `conversationClaims`.
   */
  overlayClaims(): OverlayInputClaim[] {
    // The siege's countdown banner claims nothing: it floats over live play,
    // and an open claim would hold the Space chain and the attack for the
    // whole countdown.
    return [
      ...(this.quest === null ? [] : [this.quest.overlayClaim()]),
      ...(this.recruiter === null ? [] : [this.recruiter.overlayClaim()]),
      ...(this.defences?.overlayClaims() ?? []),
      ...(this.services?.overlayClaims() ?? []),
    ];
  }

  /**
   * The villager conversation's claim, apart from `overlayClaims` because it
   * ranks elsewhere: with the street conversations at the bottom of the list,
   * under every menu, death screen and dialog that can open over it.
   */
  conversationClaims(): OverlayInputClaim[] {
    const villagers = this.villagers;
    if (villagers === null) return [];
    return [
      {
        isOpen: villagers.isConversationOpen,
        space: { kind: 'advance', advance: () => villagers.conversation.advance() },
        // The number keys choose, and they are the hotbar's too.
        locksKeyboard: true,
        // A street conversation: it ends because the player walked away.
        haltsWorld: false,
        // No focus ring: the arrow keys are how a keyboard player walks away,
        // so the choices are picked by number, click or tap instead.
        focusContext: null,
      },
    ];
  }

  /** Minimap pips for anything the village quest wants pointed at. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    return this.quest?.questMarkers ?? [];
  }

  /** Quest Journal rows for the village's own questline. */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    return this.quest?.trackerEntries() ?? [];
  }

  /**
   * Transient kit state only — never the durable `BriarHollowState`, which
   * `DungeonScene` already captures by reference. See the module doc.
   */
  captureCheckpoint(): BriarHollowKitCheckpoint {
    return {};
  }

  /** @param _checkpoint The value a prior `captureCheckpoint` returned. */
  restoreCheckpoint(_checkpoint: BriarHollowKitCheckpoint): void {
    this.defences?.onRewind();
    this.services?.onRewind();
    this.soldiers?.onRewind();
    this.quest?.closeConfirm();
    this.recruiter?.dismissDialog();
    this.assault?.onRewind();
  }

  /**
   * Where the human is in conversation with a villager, for `HumanPlayer`'s
   * talk-facing pose — `null` whenever no village conversation is open.
   */
  humanTalkSpeaker(): WorldPoint | null {
    return this.villagers?.talkSpeakerFor(this.deps.human) ?? null;
  }

  /** Torn down when the scene exits. Safe to call even though nothing is held yet. */
  dispose(): void {
    // Before the villagers: closing a conversation runs its after-close
    // steps, and a shop must not open over a scene that is being torn down.
    this.services?.dispose();
    this.villagers?.dispose();
    this.livestock?.dispose();
    this.defences?.dispose();
    this.soldiers?.dispose();
    this.quest?.dispose();
    this.assault?.dispose();
    if (this.defences !== null) this.deps.dynamite.onStructureBlast = null;
  }
}

const NO_CAMERA_OFFSET = { x: 0, y: 0 } as const;

/** How far a stick still in Carl's hand could end up blasting: a full throw plus the blast. */
const STICK_IN_HAND_REACH_TILES = 12;
/** How far round his feet the widest Smush reaches: a full-power outer ring. */
const SMUSH_REACH_TILES = 9;
const TILE_CENTRE_FRACTION = 0.5;

/** The kit is ticked by the fixed-step loop, this many times a second. */
const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;

/** The tier Oren would sell next: one past what the party carries, or the best there is. */
function nextToolTier(current: ToolTier | null): ToolTier {
  const carried = current ?? TOOL_TIER_BASIC;
  const next = carried + 1;
  return isToolTier(next) ? next : MAX_TOOL_TIER;
}
