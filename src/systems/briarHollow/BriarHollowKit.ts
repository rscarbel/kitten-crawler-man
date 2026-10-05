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
import type { KeyModifiers, Surface } from '../../ui/core/UiRoot';
import type { SystemContext } from '../GameSystem';
import type { TownPropRenderable } from '../townPropRenderable';
import type { QuestMarkerType } from '../MiniMapSystem';
import type { TrackerEntry } from '../questTracker';
import type { ProcessingStationKind } from './processingStations';
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
import type { Rect } from '../../ui/core/geom';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { VillageAssaultSystem, type SiegeMusicClaim } from './VillageAssaultSystem';
import { VillageQuestSystem } from './VillageQuestSystem';
import { VillageQuestGuide } from './VillageQuestGuide';
import { BlueprintsQuestSystem } from './BlueprintsQuestSystem';
import { RecruiterSystem } from './RecruiterSystem';
import type { Conversation } from '../../dialog/Conversation';
import type { ConversationHandle } from '../../dialog/request';
import { transientSpeaker } from '../../dialog/line';
import { BRAMBLEWICK } from '../../dialog/scripts/briarHollow';
import { blueprintsPhaseAtLeast } from '../../core/blueprintsQuestPhase';
import { createMidgeEscortCarry, type MidgeEscortCarry } from '../../core/midgeEscortCarry';
import type { BlueprintsCue } from './blueprints/blueprintsSoundCues';
import type { TravelUnlockState } from '../travel/travelDestinations';

/** The live `Keybindings` singleton's own type, which the class itself does not export. */
type KeybindingsHost = typeof keybindings;

/** A tile-anchored point, matching what every other `humanTalkSpeaker` in this codebase returns. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** A narrated line queued for the shared conversation, and what to run once it has been dismissed. */
interface PendingQuestLine {
  readonly speaker: string;
  readonly text: string;
  readonly onClosed?: () => void;
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
  /** The one conversation panel the whole game shares — the scene's, not this kit's own. */
  readonly conversation: Conversation;
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
  /**
   * Midge's escort across a door: threaded by reference from the scene
   * rebuilt on the way out of a building. Absent means a fresh scene, where
   * she starts at Merrit's gate.
   */
  readonly midgeEscortCarry?: MidgeEscortCarry;
  /** Told of every cue the side quest raises; a headless gate's ear, absent in the game. */
  readonly onBlueprintsCue?: (cue: BlueprintsCue) => void;
  /** Handed to the questline for its reward screen's travel card. */
  readonly travelUnlocks: Pick<TravelUnlockState, 'anchor'>;
}

/** The HUD chrome `BriarHollowKit.renderHud` draws around, in CSS pixels. */
export interface BriarHollowHudChrome {
  /** The HUD's panels, minimap, hotbar and buttons: the scythe's bar stays off them. */
  readonly keepouts: readonly Rect[];
  /** The HUD's Build button, or null while it shows none. */
  readonly buildButton: Rect | null;
}

export class BriarHollowKit {
  private readonly world: SceneWorld;
  private readonly deps: BriarHollowKitDeps;
  private readonly castPrewarm = new RatkinCastPrewarm();
  private readonly unsubscribeBellTowerRepaired: () => void;
  /**
   * The village's moving dressing — the bell, the sawmill blade, hearth fires,
   * smoke, lamp glow, laundry. `ambience.sawmill.working` and
   * `ambience.bell.ringing` are the switches the sawmill and the siege flip.
   */
  readonly ambience = new VillageAmbience();
  /** Reused every frame so the merged entity list costs no allocation. */
  private readonly entityBuffer: TownPropRenderable[] = [];
  /**
   * Narrated lines waiting for a villager conversation, a village menu or the
   * quest's own confirm to clear, so a narrated line never opens on top of one.
   */
  private readonly pendingQuestLines: PendingQuestLine[] = [];
  /**
   * The narrated line the shared conversation is currently showing, so its
   * own close can be told apart from never having opened.
   */
  private activeQuestLine: PendingQuestLine | null = null;
  /** The handle `activeQuestLine`'s beat was returned, so a beat something else has since superseded reads as closed rather than staying latched. */
  private activeQuestLineHandle: ConversationHandle | null = null;

  /** Whether `activeQuestLine` is still the beat on the shared box, rather than something that has since replaced it. */
  private isQuestLineShowing(): boolean {
    return (
      this.activeQuestLine !== null &&
      this.activeQuestLineHandle !== null &&
      this.deps.conversation.isActive(this.activeQuestLineHandle)
    );
  }

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
  /**
   * "The Borrowed Blueprints", Fenna's side quest; null on a map with no
   * village. Built after the Plea so the Plea's villager lines outrank it.
   */
  readonly blueprints: BlueprintsQuestSystem | null;
  /**
   * The questline's in-world "how": the highlighted tree, rock, station, wall
   * segment or trebuchet a step means, and the arrow and caption over it.
   * Null on a map with no village.
   */
  readonly questGuide: VillageQuestGuide | null;
  /** The recruiter posted in the Over City's own square; null on a map with no village. */
  readonly recruiter: RecruiterSystem | null;

  /** The village's durable state, for a dev preset that jumps the questline ahead of where it opens unlocks. */
  get state(): BriarHollowState {
    return this.deps.state;
  }

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
            conversation: deps.conversation,
            party: () => this.partyState(),
            // `this.services` does not exist yet at this line — it is built
            // right after `this.villagers` below — but this closure only
            // runs during gameplay, well after the constructor returns.
            isVillagerBusy: () => this.services?.isShopBusy === true,
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
            midgeHasLeft: () => blueprintsPhaseAtLeast(deps.state.blueprints.phase, 'escort_midge'),
            // Lazy: the side quest that walks Midge off is built after the herd.
            strayCows: () => this.blueprints?.escort.strayCows ?? [],
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
            // Read at call time: the blueprints quest is built after the services.
            stationsUpgrading: () => this.blueprints?.stations.isUpgrading === true,
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
            isConstructionExplainerOpen: () => deps.menus.craftExplainers.isOpen,
            openProcessingExplainer: () => {
              deps.partyCrafts.processingExplainerSeen = true;
              void deps.menus.craftExplainers.open('processing');
            },
            // Lazy: `questGuide` is built after the questline it reads from.
            guideTarget: () => this.questGuide?.target() ?? null,
            showQuestLine: (speaker, text, onClosed) => this.showQuestLine(speaker, text, onClosed),
            enqueueReward: (reward) => deps.menus.rewardGrantedDialog.enqueue(reward),
            afterRewardsDrain: (run) => deps.menus.rewardGrantedDialog.afterQueueDrains(run),
            announce: (message) => deps.menus.announce(message),
            groundPickups: deps.groundPickups,
            dropItems: (x, y, items) => deps.dropItems?.(x, y, items),
            grantOrenTools: () => this.services?.grantOrenTools() ?? null,
            // Lazy: the recruiter is built after the questline it reads from.
            recruiter: () => this.recruiter?.post ?? null,
            travelUnlocks: deps.travelUnlocks,
          });
    this.blueprints =
      site === null || villagers === null
        ? null
        : new BlueprintsQuestSystem({
            state: deps.state,
            gameMap: sceneWorld.gameMap,
            site,
            bus: sceneWorld.bus,
            audio: deps.audio,
            roster: sceneWorld.roster,
            human: deps.human,
            cat: deps.cat,
            active: () => (deps.human.isActive ? deps.human : deps.cat),
            villagers,
            conversation: deps.conversation,
            announce: (message) => deps.menus.announce(message),
            callout: (text, x, y) => this.defences?.trebuchets.callouts.add(text, x, y, 'label'),
            onTileChanged: deps.onTileChanged,
            noteResourceActivity: deps.noteResourceActivity,
            worldHalted: () => deps.worldHalted?.() === true,
            pleaPhase: () => deps.state.quest.phase,
            livestock: this.livestock,
            music: () => deps.music?.() ?? null,
            escortLevel: deps.assaultLevel,
            midgeCarry: deps.midgeEscortCarry ?? createMidgeEscortCarry(),
            onCue: deps.onBlueprintsCue,
            // Lazy: the guide is built after this quest. It only shows this
            // quest's guidance while the Plea has none of its own.
            guideTarget: () =>
              (this.quest?.guidance() ?? null) === null
                ? (this.questGuide?.target() ?? null)
                : null,
          });
    this.questGuide =
      site === null || villagers === null || defense === null
        ? null
        : new VillageQuestGuide({
            gameMap: sceneWorld.gameMap,
            site,
            state: deps.state,
            defense,
            human: deps.human,
            cat: deps.cat,
            onTileChanged: deps.onTileChanged,
            // Lazy: read fresh every tick, since the quests are rebuilt with the
            // kit. The Plea's own step comes first; the side quest's shows only
            // while the Plea has nothing for the party's hands.
            guidance: () => this.quest?.guidance() ?? this.blueprints?.guidance() ?? null,
            isDefaultTrebuchetPromptShowing: (at) =>
              this.defences?.isTrebuchetPromptShowing(at) ?? false,
            isDefaultWallPromptShowing: () => this.defences?.isWallPromptShowing() ?? false,
            questMarksStation: (kind) => this.blueprints?.marksStation(kind) ?? false,
            questStationCaptionTopWorldY: (kind) =>
              this.blueprints?.stationCaptionTopWorldY(kind) ?? null,
            showingSideQuestGuidance: () => (this.quest?.guidance() ?? null) === null,
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
            conversation: deps.conversation,
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
            mayorBark: () =>
              void this.villagers?.bark('bramblewick', BRAMBLEWICK.attackStarted, true),
            bossIntro: (name, color) => deps.bossIntro?.(name, color),
            music: () => deps.music?.() ?? null,
            crawlers: () => [deps.human, deps.cat],
          });
    // The tower's art is baked once per map build; a repair mid-visit has to
    // force the live scene to redraw it without waiting for a door to do that
    // rebuild for free.
    this.unsubscribeBellTowerRepaired = sceneWorld.bus.on('bellTowerRepaired', () => {
      this.ambience.invalidate();
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
    // `villagers.update` drives the shared conversation's own tick (it is the
    // one system that knows who is actually talking); nothing else in this
    // kit may call it again this frame.
    this.villagers?.update({ human: ctx.human, cat: ctx.cat, active: ctx.active });
    this.livestock?.update({ human: ctx.human, cat: ctx.cat, active: ctx.active });
    this.defences?.update();
    this.services?.update();
    this.soldiers?.update({ human: ctx.human, cat: ctx.cat, active: ctx.active });
    this.recruiter?.update();
    this.quest?.update();
    this.blueprints?.update();
    this.questGuide?.update();
    this.drainQuestLineQueue();
    this.services?.sawmill.setQuestForcedKinds(this.questGuide?.activeProcessStationKinds() ?? []);
    const tools = this.deps.partyCrafts.tools;
    this.ambience.setToolTiers(nextToolTier(tools.axeTier), nextToolTier(tools.pickaxeTier));
    this.ambience.update(ctx.gameMap, SECONDS_PER_UPDATE);
  }

  /**
   * Queues a narrated line from `speaker` — the questline's own beat, not a
   * topic choice — as a dialog box. Shown once any villager conversation or
   * open village menu clears, never stacked on top of one. `onClosed`, when
   * given, runs once the box the line opened has been dismissed.
   */
  showQuestLine(speaker: string, text: string, onClosed?: () => void): void {
    // A scene with no audio manager is a headless harness with nothing to
    // show the line on and nobody to press through it; treat it as read at
    // once rather than stalling whatever waits on `onClosed`.
    if (this.deps.audio === null) {
      onClosed?.();
      return;
    }
    this.pendingQuestLines.push({ speaker, text, onClosed });
  }

  /**
   * Opens the next queued narrated line on the shared conversation once
   * nothing else is claiming the village's dialogs, and runs the line's own
   * `onClosed` once it has been read.
   */
  private drainQuestLineQueue(): void {
    if (this.deps.conversation.isOpen) return;
    if (this.isConversationOpen || this.isMenuOpen) return;
    // A line opened under the quest-complete screen would be swept away by the
    // scene's halt, unread.
    if (this.deps.menus.questReward.isOpen) return;
    if (this.recruiter?.isDialogOpen === true) return;
    const next = this.pendingQuestLines.shift();
    if (next === undefined) return;
    this.activeQuestLine = next;
    this.activeQuestLineHandle = this.deps.conversation.open({
      lines: [transientSpeaker(next.speaker, 'questLine').line(next.text)],
      reward: null,
      questRelated: true,
      ending: {
        kind: 'close',
        onClosed: () => {
          this.activeQuestLine = null;
          this.activeQuestLineHandle = null;
          next.onClosed?.();
        },
      },
      // The questline's own beat halts the world outright, so nothing about
      // Esc or walking away applies to it.
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /**
   * Steps the narrated line box now on screen to its end, the way Space
   * would — for a headless harness driving the world one press at a time.
   */
  dismissQuestLine(): void {
    for (
      let attempt = 0;
      attempt < QUEST_LINE_DISMISS_ATTEMPTS && this.isQuestLineShowing();
      attempt++
    ) {
      this.deps.conversation.advance();
    }
  }

  /** Whether a narrated line is on screen right now. */
  get isQuestLineOpen(): boolean {
    return this.isQuestLineShowing();
  }

  /** The narrated line on screen right now, or null while nothing is open. */
  get questLineText(): string | null {
    return this.isQuestLineShowing() ? (this.activeQuestLine?.text ?? null) : null;
  }

  /**
   * Ground-layer painting — anything that must sit under every body, drawn
   * immediately after `RenderPipeline.renderWorld` and before the Y-sorted
   * entity pass.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.defences?.renderGround(ctx, camX, camY);
    this.services?.renderGround(ctx, camX, camY);
    this.blueprints?.renderGround(ctx, camX, camY);
    if (this.blueprints?.busyWithWork !== true) this.questGuide?.renderGround(ctx, camX, camY);
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
    this.villagers?.renderBarks(ctx, camX, camY);
    this.livestock?.renderAbove(ctx, camX, camY);
    this.defences?.renderAbove(ctx, camX, camY);
    this.services?.renderAbove(ctx, camX, camY);
    this.blueprints?.renderAbove(ctx, camX, camY);
    this.assault?.renderAbove(ctx, camX, camY);
    this.soldiers?.renderAbove(ctx, camX, camY);
    // A downed crawler's arrow is the only arrow the game allows on screen, so
    // the quest guide's arrows and captions stand down until they are revived.
    const crawlerDown = this.deps.human.isKnockedOut || this.deps.cat.isKnockedOut;
    const busyWithWork = this.blueprints?.busyWithWork === true;
    if (!crawlerDown && !busyWithWork) this.questGuide?.renderAbove(ctx, camX, camY);
  }

  /**
   * One gameplay update of the siege — in the phase the floors' defend quest
   * runs in, so the countdown and the waves stop whenever gameplay does.
   */
  updateSiege(ctx: SystemContext): void {
    this.assault?.update({ active: ctx.active });
  }

  /**
   * The HUD's top-band cards: the siege's countdown or wave with the bell's
   * and the bosses' health, and the Blueprints quest's counter and step
   * banner.
   */
  topBandEntries(): TopBandEntry[] {
    const entries: TopBandEntry[] = [];
    const siege = this.assault?.topBandEntry() ?? null;
    if (siege !== null) entries.push(siege);
    entries.push(...(this.blueprints?.topBandEntries() ?? []));
    return entries;
  }

  /**
   * Screen-space chrome outside the top band, in CSS pixels: the siege's
   * banners across the middle of the screen, the scythe's timing bar, the
   * escort's markers for ambushers still out of sight, and the arrow over the
   * Build button while the party stands where a trebuchet should go.
   */
  renderHud(ctx: CanvasRenderingContext2D, chrome: BriarHollowHudChrome): void {
    this.assault?.renderCentreBanners(ctx);
    this.blueprints?.renderHud(ctx, chrome.keepouts);
    this.blueprints?.escort.renderHud(ctx);
    this.questGuide?.renderConstructionHint(ctx, chrome.buildButton);
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
    // Same order as `tryInteract`: the side quest's fence and harvest first.
    if (this.blueprints?.renderPrompt(ctx, camX, camY, active) === true) return true;
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
   * press was claimed. `fromTap` says whether a world tap made the press
   * rather than a key.
   */
  tryInteract(active: HumanPlayer | CatPlayer, fromTap: boolean): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    // A fence section of Merrit's in reach, or the scythe and the grain: each
    // only takes the press in its own step and only when something is in
    // reach, so outside those it falls straight through.
    if (this.blueprints?.tryInteract(active) === true) return true;
    // A wall the crawler is squarely facing is the most specific thing a press
    // can mean, and never overlaps a villager or a fixture.
    if (this.defences?.tryBuildWall(fromTap) === true) return true;
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
   * Midge while she is being led to Wendell's, for the same list of bodies
   * hostiles may pick. Not an allied defender — she never fights back — but
   * the escort is only an escort if the road's ambushers can go for her.
   */
  pushEscortTargets(out: Player[]): void {
    this.blueprints?.pushEscortTargets(out);
  }

  /**
   * Whether a press from `active` would be taken by the village — a cow to pet
   * or a villager to talk to. The predicate `tryInteract` is built on, for any
   * later link of the Space chain that draws a prompt of its own and must stay
   * quiet when the village would take the press first.
   */
  wouldInteract(active: HumanPlayer | CatPlayer): boolean {
    if (hostileWithinAttackRange(active, this.world.roster.grid)) return false;
    if (this.blueprints?.harvest.wouldInteract(active) === true) return true;
    if ((this.blueprints?.fence.sectionInReach(active) ?? null) !== null) return true;
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
    // A station the blueprints can upgrade, in reach, takes the key first.
    const active = this.deps.human.isActive ? this.deps.human : this.deps.cat;
    if (this.blueprints?.tryUpgradeStation(active) === true) {
      // A cut under way at the machine being rebuilt would run on inside the
      // rebuild; nothing is spent until a cut finishes, so dropping it is free.
      if (this.blueprints.stations.isUpgrading) this.services?.sawmill.cancel();
      return;
    }
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
    if (this.blueprints?.handleDoubleTap(screenX + camX, screenY + camY, active) === true) {
      // The double tap's first tap already landed on the machine as a single
      // tap and started a cut there; nothing is spent until a cut finishes,
      // so dropping it leaves the upgrade as the gesture's only effect.
      this.services?.sawmill.cancel();
      return true;
    }
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
   * rather than to whoever happens to be nearest. `eventTimeStampMs` is when
   * the finger came down, which a live scythe swing grades its timed press
   * by. Returns whether it was consumed.
   */
  handleTap(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
    eventTimeStampMs = performance.now(),
  ): boolean {
    const villagers = this.villagers;
    if (villagers === null || villagers.isConversationOpen) return false;
    const worldX = screenX + camX;
    const worldY = screenY + camY;
    // A live scythe swing wants every tap: that tap is its timed press, and
    // grading it starts nothing, so a hostile in reach does not stop it.
    if (this.claimsWorldTaps) {
      return this.blueprints?.handleTap(worldX, worldY, active, eventTimeStampMs) === true;
    }
    // With a hostile in reach a tap is an attack, as Space is: it must not
    // start a fence channel or a swing that leaves the crawler standing still.
    const hostileNear = hostileWithinAttackRange(active, this.world.roster.grid);
    // A fence section is a smaller target than a cow standing behind it, so
    // the side quest asks first.
    if (
      !hostileNear &&
      this.blueprints?.handleTap(worldX, worldY, active, eventTimeStampMs) === true
    ) {
      return true;
    }
    // The cow comes before the hostile check: it decides for itself whether a hostile would take the tap.
    if (this.tapCow(worldX, worldY, active)) return true;
    if (hostileNear) return false;
    if (this.services?.handleTap(worldX, worldY, active) === true) return true;
    if (this.handleRecruiterTap(worldX, worldY, active)) return true;
    const tappedSoldier = this.soldiers?.soldierAtPoint(worldX, worldY) ?? null;
    if (tappedSoldier !== null) {
      const soldierTiles =
        Math.hypot(tappedSoldier.x - active.x, tappedSoldier.y - active.y) / TILE_SIZE;
      if (soldierTiles > VILLAGER_TALK_RANGE_TILES) return false;
      this.soldiers?.talkTo(tappedSoldier, active);
      return true;
    }
    const tapped = villagers.villagerAtPoint(worldX, worldY);
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

  /** Whether a live scythe swing wants every world tap as its timed press. */
  get claimsWorldTaps(): boolean {
    return this.blueprints?.harvest.claimsWorldTaps === true;
  }

  /** Whether a villager conversation is on screen. */
  get isConversationOpen(): boolean {
    return this.villagers?.isConversationOpen === true;
  }

  /** Whether one of the construction menus is up. */
  get isMenuOpen(): boolean {
    return this.defences?.isMenuOpen === true || this.services?.isMenuOpen === true;
  }

  /** Whether one of the village's own modals (a confirm, a narrated line) is what has halted the world. */
  get haltsWorldItself(): boolean {
    if (this.isQuestLineShowing()) return true;
    return this.defences?.haltsWorldItself === true;
  }

  /** Closes every construction panel, the picker and the confirm included. */
  closeConstructionPanels(): void {
    this.defences?.closeAllPanels();
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

  /**
   * Escape: backs a question submenu out to the root topics, or closes the
   * conversation from the root. Returns whether there was one to act on.
   */
  dismissDialog(): boolean {
    if (this.defences?.dismissDialog() === true) return true;
    if (this.recruiter?.isDialogOpen === true) {
      this.deps.conversation.dismiss();
      return true;
    }
    return this.villagers?.escapeConversation() ?? false;
  }

  /**
   * The village's panels as surfaces: the construction panels (the shared
   * Construction menu among them) and the services' menus.
   * Villager conversations and narrated lines open on the scene's shared
   * `Conversation`, whose own surface the scene mounts.
   *
   * @param camera Where the camera is, for anchoring the structure menu.
   */
  surfaces(camera: () => { readonly x: number; readonly y: number }): Surface[] {
    return [...(this.defences?.surfaces(camera) ?? []), ...(this.services?.surfaces() ?? [])];
  }

  /**
   * A live scythe swing takes the attack key as its timed press, graded at
   * the keydown's own time, ahead of every menu and of gameplay's attack.
   * For `UiRoot.addKeyHook`, which keeps it from keys typed into the chat box.
   */
  readonly harvestKeyHook = (key: string, mods: KeyModifiers): boolean =>
    this.blueprints?.handleKeyDown(
      key,
      mods.repeat === true,
      mods.timeStamp ?? performance.now(),
    ) === true;

  /** Minimap pips for anything the village's questlines want pointed at. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    return [...(this.quest?.questMarkers ?? []), ...(this.blueprints?.questMarkers ?? [])];
  }

  /** The sawmill's machines, in tile coordinates with their output, for the minimap. */
  get minimapProcessingStations(): Array<{
    x: number;
    y: number;
    kind: ProcessingStationKind;
  }> {
    return this.services?.minimapProcessingStations() ?? [];
  }

  /** Every present vendor villager's world position, for the minimap's `$` markers. */
  get minimapVendorPositions(): Array<{ x: number; y: number }> {
    return this.services?.minimapVendorPositions() ?? [];
  }

  /** Quest Journal rows for the village's questlines: the Plea, then Fenna's side quest. */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    return [...(this.quest?.trackerEntries() ?? []), ...(this.blueprints?.trackerEntries() ?? [])];
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
    // Before the side quest: a rewind to before Midge left hands her back to
    // the herd, and the escort then finds her gone.
    this.livestock?.onRewind();
    this.blueprints?.onRewind();
    if (this.isQuestLineShowing()) {
      this.deps.conversation.close();
    }
    this.activeQuestLine = null;
    this.activeQuestLineHandle = null;
    this.pendingQuestLines.length = 0;
    if (this.recruiter?.isDialogOpen === true) this.deps.conversation.dismiss();
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
    this.unsubscribeBellTowerRepaired();
    if (this.isQuestLineShowing()) {
      this.deps.conversation.close();
    }
    this.activeQuestLine = null;
    this.activeQuestLineHandle = null;
    // Before the villagers: closing a conversation runs its after-close
    // steps, and a shop must not open over a scene that is being torn down.
    this.services?.dispose();
    this.villagers?.dispose();
    this.livestock?.dispose();
    this.defences?.dispose();
    this.soldiers?.dispose();
    this.quest?.dispose();
    this.blueprints?.dispose();
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

/** Enough presses to reveal a narrated line's text and then dismiss it, however many words it has. */
const QUEST_LINE_DISMISS_ATTEMPTS = 4;

/** The tier Oren would sell next: one past what the party carries, or the best there is. */
function nextToolTier(current: ToolTier | null): ToolTier {
  const carried = current ?? TOOL_TIER_BASIC;
  const next = carried + 1;
  return isToolTier(next) ? next : MAX_TOOL_TIER;
}
