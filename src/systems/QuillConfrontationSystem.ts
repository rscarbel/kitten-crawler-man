/**
 * QuillConfrontationSystem — the finale of "The Krasue Murders", fought in
 * the magistrate's office at the top of the Town Center Tower.
 *
 * Two fights, one room. Miss Quill is untouchable while Remex, her
 * husband-turned-soul-capacitor, still stands; she answers every intrusion with
 * soul bolts and summoned krasue. When she and her guards are down the room
 * gives up the thing it has been hiding: Magistrate Featherfall has been a
 * corpse at his own desk for weeks, and the Lich that has been signing his
 * letters stops pretending. Owned by BuildingInteriorScene (top floor only);
 * quest state crosses scenes via MurderQuestProgress.
 *
 * The end of the confrontation destabilizes the city's soul crystal (Carl's
 * Doomsday Scenario): this system only fires that one-time reveal — writing
 * the crystal's position and a containment deadline into DoomsdayProgress —
 * and hands off to SoulCrystalSystem, which ticks independently of this
 * encounter's lifecycle (it must keep checking the countdown even if the
 * player leaves this floor, or the tower, before containing the crystal).
 */

import { TILE_SIZE } from '../core/constants';
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import { TOWN_MUSIC_TRACKS } from '../audio/sounds';
import { prewarmGroups } from '../core/SpriteLoader';
import { SYSTEM_ASSET_REQUIREMENTS } from '../core/systemAssetRequirements';
import type { GameMap } from '../map/GameMap';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { MurderQuestProgress } from '../core/MurderQuestProgress';
import type { DoomsdayProgress } from '../core/DoomsdayProgress';
import { findNearbyWalkableTile } from '../map/findWalkableTile';
import { MissQuill } from '../creatures/MissQuill';
import { Remex } from '../creatures/Remex';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { TheLich } from '../creatures/TheLich';
import { drawSkyFowlCorpse } from '../sprites/skyFowlSprite';
import { drawSoulBurst } from '../sprites/skeletonEffectsSprite';
import { drawRadialGlow } from '../sprites/radialGlow';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { QuestDialog } from '../ui/QuestDialog';
import {
  FEATHERFALL_EXAMINE_DIALOG,
  LICH_REVEAL_DIALOG,
  QUILL_OFFICE_DIALOG,
  VICTORY_DIALOG,
} from './murderQuestDialogs';
import { LichBattleSystem, type CompanionDirector } from './LichBattleSystem';
import { drawText } from '../ui/TextBox';
import { drawOverlay, drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import { drawQuestBanner, QUEST_BANNER_FRAMES } from '../ui/QuestBanners';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { questMobLevel } from './questMobLevel';

const SPAWN_SEARCH_RADIUS_TILES = 6;
/**
 * Quill holds the south end of the office, away from the north-west stairs the
 * player climbs in by. The gap is deliberate: every offset here has to keep the
 * whole party outside its own aggro/cast range of the arrival tile, or the
 * fight opens with a soul bolt already in the air over the intro banner.
 *
 * "Outside" has to mean outside by a margin rather than by inches. The widest
 * range in the room reaches eight tiles and both crawlers arrive on the landing
 * together, so the tile a guard stands on is measured against the nearer of the
 * two — and the whole party is one bolt from the ejection that a companion's
 * death triggers, whatever the difficulty. `scripts/verify-interiors.ts` holds
 * these offsets to that margin.
 */
const QUILL_OFFSET = { dx: 0, dy: 5 };
const REMEX_OFFSET = { dx: 4, dy: 5 };
const GUARD_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -3, dy: 5 },
  { dx: 3, dy: 5 },
];
const GUARD_LEVEL = 7;
/**
 * How far a guard may drift from the spot the encounter posted it on.
 *
 * They are the only thing in the room that moves before the party is seen, and
 * the offsets above are only safe for as long as they stay where they were put.
 * Wide enough to still read as a restless congregation, narrow enough that the
 * margin the offsets buy cannot be walked away.
 */
const GUARD_POST_LEASH_TILES = 1.5;
/**
 * The Lich's spawn level — far below its own guards', deliberately.
 *
 * Levelling multiplies health in place at 30% a level, so the number that reads
 * as "a serious boss" on a cultist is a health bar three times the size on
 * something that already has one. Its base health is tuned for this fight and
 * the level is here for the damage and the coins: three lands it beside Miss
 * Quill's own bar rather than well past it, and what makes the second half of
 * this room hard is its cooldowns and its escort, not its hit points.
 *
 * A floor, not a fixed level: a party that arrives well past it is lifted to
 * the quest floor, since three against a late party is not a fight at all.
 */
const LICH_LEVEL = 3;

/** The magistrate's desk stands against the north wall, opposite the fight. */
const CORPSE_OFFSET = { dx: 0, dy: -4 };
/** The Lich steps out of the wall beside the desk, not out of the corpse. */
const LICH_OFFSET = { dx: 2, dy: -3 };

/** How close the party must stand to read the body. */
const EXAMINE_RANGE_TILES = 2.5;

const BOSS_BAR_WIDTH = 320;
const BOSS_BAR_HEIGHT = 14;
const BOSS_BAR_Y = 40;
const BOSS_BAR_LABEL_Y = 22;
const BOSS_BAR_LABEL_SIZE = 12;
const OBJECTIVE_Y_FROM_BOTTOM = 96;
const OBJECTIVE_SIZE = 13;

const FRAMES_PER_SECOND = 60;
const VICTORY_BANNER_SECONDS = 8;
const VICTORY_BANNER_FRAMES = VICTORY_BANNER_SECONDS * FRAMES_PER_SECOND;
const VICTORY_GLOW_BLUR = 12;
const BANNER_SUBTITLE_Y = 104;
const BANNER_SUBTITLE_SIZE = 13;
const VICTORY_TITLE_SIZE = 26;
const VICTORY_SUBTITLE_SIZE = 13;
const VICTORY_TITLE_Y_OFFSET = 30;
const VICTORY_SUBTITLE_Y_OFFSET = 8;
const BANNER_FADE_FRAMES = 60;
const BOSS_MUSIC_FADE_IN_MS = 1500;
const VICTORY_MUSIC_FADE_IN_MS = 2000;

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const CONTAINMENT_MINUTES = 7;
/** Time to reach and contain the crystal before it levels the city. */
const CONTAINMENT_DURATION_MS = CONTAINMENT_MINUTES * MS_PER_MINUTE;

/**
 * The beat between the last culprit falling and the reveal's first line.
 *
 * Long enough for the room to go quiet and the light to close on the desk,
 * short enough that it reads as a held breath rather than as the game having
 * stopped responding. Nothing hostile is alive during it, so the world is left
 * running: a delay that halted the world would need its own tick above the halt
 * to ever expire.
 */
const REVEAL_HOLD_FRAMES = 50;
/** How far the room dims while the light is on the corpse. */
const REVEAL_DIM_ALPHA = 0.62;
const REVEAL_DIM_COLOR = '#04060a';
/** Frames the dim takes to arrive, so the room falls dark rather than blinking. */
const REVEAL_DIM_FADE_FRAMES = 24;
const REVEAL_SPOTLIGHT_RADIUS_TILES = 3.4;
/** A flat bright centre, so the light reads as a pool rather than a point. */
const REVEAL_SPOTLIGHT_CORE_FRACTION = 0.3;
const REVEAL_SPOTLIGHT_RGB = '236, 226, 190';
const REVEAL_SPOTLIGHT_ALPHA = 0.3;

/** Frames of gathering witch-light before the Lich is solid enough to fight. */
const MATERIALISE_FRAMES = 46;
/** Soul-bursts stacked over the arrival, each a little larger than the last. */
const MATERIALISE_BURST_COUNT = 3;
const MATERIALISE_BURST_SCALE_STEP = 0.45;
const CENTER_OFFSET = 0.5;

/**
 * Where the encounter is in its two-fight arc.
 *
 * Rebuilt from `MurderQuestProgress` on construction rather than always
 * starting at the beginning: the party can die to the Lich, be turned out of
 * the tower and climb back up, and replaying Quill — or the reveal of something
 * they have already seen — would be the game forgetting what they did.
 */
type ConfrontationPhase =
  | 'office_scene'
  | 'quill_fight'
  | 'reveal_hold'
  | 'reveal'
  | 'materialising'
  | 'lich_fight'
  | 'victory_scene'
  | 'done';

/** The card raised over a phase change, held so one renderer serves them all. */
interface BannerCard {
  readonly title: string;
  readonly subtitle: string;
  readonly color: string;
  readonly shadow: string;
  readonly subtitleColor: string;
}

const QUILL_BANNER: BannerCard = {
  title: 'MISS QUILL — THE HEADMISTRESS',
  subtitle: 'Every krasue in the city was her handiwork',
  color: '#f47c7c',
  shadow: '#6a2a2a',
  subtitleColor: '#f4c7c7',
};

const LICH_BANNER: BannerCard = {
  title: 'THE LICH — MAGISTRATE IN ALL BUT BODY',
  subtitle: 'Featherfall has been dead for weeks. This signed his letters.',
  color: '#9ade63',
  shadow: '#1d3a14',
  subtitleColor: '#d4edaa',
};

/** A phase card raised by the Lich battle, in the Lich's own colours. */
function lichPhaseBanner(title: string, subtitle: string): BannerCard {
  return { ...LICH_BANNER, title, subtitle };
}

export class QuillConfrontationSystem implements GameSystem {
  private quill: MissQuill | null = null;
  private remex: Remex | null = null;
  private guards: Mob[] = [];
  private lich: TheLich | null = null;

  private phase: ConfrontationPhase;
  private battle: LichBattleSystem | null = null;
  private banner: BannerCard = QUILL_BANNER;
  /**
   * A monotonic frame counter, handed to the battle's flame animation.
   *
   * Its own counter rather than wall-clock time so the fire animates at the
   * rate the fight is being simulated at, which is what keeps it from strobing
   * when the loop is catching up.
   */
  private frameCount = 0;
  private bannerTimer = 0;
  private victoryTimer = 0;
  private revealHoldTimer = 0;
  private materialiseTimer = 0;
  private dimTimer = 0;
  private heldForBanner = false;
  private readonly dialog: QuestDialog;

  private readonly corpseTile: { x: number; y: number };
  private readonly lichTile: { x: number; y: number };
  private corpseExamined = false;

  constructor(
    private readonly map: GameMap,
    private readonly bus: EventBus,
    private readonly addMob: (mob: Mob) => void,
    private readonly progress: MurderQuestProgress,
    private readonly audio: AudioManager | null,
    private readonly doomsdayProgress: DoomsdayProgress,
    private readonly partyLevel: number,
    /**
     * The scene's companion drive, so the Lich's phases can park it out of the
     * fire. Optional: a harness that exercises this encounter without a scene
     * has no companion, and the fight has to work without one.
     */
    private readonly companion: CompanionDirector | null = null,
  ) {
    this.dialog = new QuestDialog(this.audio);
    const centreY = Math.floor(this.map.structure.length / 2);
    const centreX = Math.floor((this.map.structure[0]?.length ?? 0) / 2);
    this.corpseTile = this.findSpawnTile(
      centreX + CORPSE_OFFSET.dx,
      centreY + CORPSE_OFFSET.dy,
    ) ?? {
      x: centreX + CORPSE_OFFSET.dx,
      y: centreY + CORPSE_OFFSET.dy,
    };
    this.lichTile = this.findSpawnTile(centreX + LICH_OFFSET.dx, centreY + LICH_OFFSET.dy) ?? {
      x: centreX + LICH_OFFSET.dx,
      y: centreY + LICH_OFFSET.dy,
    };

    this.phase = phaseFor(this.progress);
    if (this.phase === 'office_scene') {
      // The room is built and frozen behind the scene, so Quill is standing at
      // her station while she speaks and the fight is already in place when the
      // last page closes — the alternative is a beat of empty office between the
      // dialog and the boss.
      this.spawnEncounter(centreX, centreY);
      this.holdRoomForBanner();
      this.dialog.open(QUILL_OFFICE_DIALOG, () => this.beginQuillFight());
    } else if (this.phase === 'quill_fight') {
      this.spawnEncounter(centreX, centreY);
      this.openQuillFight();
    } else if (this.phase === 'lich_fight') {
      this.beginLichFight();
    }
  }

  /** The banner and the music that open Miss Quill's half of the room. */
  private openQuillFight(): void {
    this.showBanner(QUILL_BANNER);
    this.holdRoomForBanner();
    this.bus.emit('bossFightInitiated', { bossType: 'miss_quill', music: 'caller' });
    this.audio?.playMusic('boss_music_3', { fadeInMs: BOSS_MUSIC_FADE_IN_MS });
  }

  private beginQuillFight(): void {
    this.progress.officeSceneSeen = true;
    this.phase = 'quill_fight';
    this.openQuillFight();
  }

  private showBanner(card: BannerCard): void {
    this.banner = card;
    this.bannerTimer = QUEST_BANNER_FRAMES;
  }

  /**
   * Shown by BuildingInteriorScene if the players fall here. Whose room it is
   * depends on which of the two fights killed them.
   */
  get defeatMessage(): string {
    return this.lich !== null
      ? 'The magistrate’s office kept its appointment.'
      : 'Miss Quill filed your souls under K.';
  }

  private findSpawnTile(tileX: number, tileY: number): { x: number; y: number } | null {
    return findNearbyWalkableTile(this.map, tileX, tileY, SPAWN_SEARCH_RADIUS_TILES);
  }

  private spawnEncounter(centreX: number, centreY: number): void {
    const remexTile = this.findSpawnTile(centreX + REMEX_OFFSET.dx, centreY + REMEX_OFFSET.dy);
    if (remexTile) {
      const remex = new Remex(remexTile.x, remexTile.y, TILE_SIZE);
      remex.setMap(this.map);
      this.addMob(remex);
      this.remex = remex;
    }

    const quillTile = this.findSpawnTile(centreX + QUILL_OFFSET.dx, centreY + QUILL_OFFSET.dy);
    if (quillTile) {
      const quill = new MissQuill(quillTile.x, quillTile.y, TILE_SIZE, this.addMob);
      quill.setMap(this.map);
      quill.summonPartyLevel = this.partyLevel;
      if (this.remex) quill.setCapacitor(this.remex);
      this.addMob(quill);
      this.quill = quill;
    }

    for (const { dx, dy } of GUARD_OFFSETS) {
      const tile = this.findSpawnTile(centreX + dx, centreY + dy);
      if (!tile) continue;
      const guard = new CityElfCultist(tile.x, tile.y, TILE_SIZE);
      guard.setMap(this.map);
      guard.applyMobLevel(questMobLevel(GUARD_LEVEL, this.partyLevel));
      applyActiveDifficultyRewards(guard);
      guard.homePoint = { x: guard.x, y: guard.y };
      guard.leashRadiusTiles = GUARD_POST_LEASH_TILES;
      this.addMob(guard);
      this.guards.push(guard);
    }
  }

  /** Everything this system has put in the room and still owns. */
  private encounterMobs(): Mob[] {
    const mobs: Mob[] = [...this.guards];
    if (this.quill !== null) mobs.push(this.quill);
    if (this.remex !== null) mobs.push(this.remex);
    if (this.lich !== null) mobs.push(this.lich);
    return mobs;
  }

  /**
   * Freezes the room for the length of its own intro banner.
   *
   * The party arrives and the encounter is built in the same frame, so without
   * this the fight is already running underneath the card announcing it — and a
   * companion is one bolt from the death that turns the whole party out of the
   * tower. Released by `update` when the banner's last frame plays.
   */
  private holdRoomForBanner(): void {
    this.heldForBanner = true;
    for (const mob of this.encounterMobs()) mob.aiHeld = true;
  }

  private releaseRoom(): void {
    this.heldForBanner = false;
    for (const mob of this.encounterMobs()) mob.aiHeld = false;
  }

  // ── The examine interaction and the reveal dialog ──────────────────────────

  get isDialogOpen(): boolean {
    return this.dialog.isOpen;
  }

  advanceDialog(): boolean {
    return this.dialog.advance();
  }

  /**
   * Escape closes the examination and nothing else.
   *
   * Every other dialog this system opens is load-bearing: the office scene ends
   * by releasing a boss fight into a held room, the reveal ends by putting the
   * Lich in it, and the victory scene ends by arming the containment clock. A
   * dismissal at any of those strands the encounter halfway through a beat that
   * has no other exit.
   */
  dismissDialog(): boolean {
    if (this.phase !== 'quill_fight') return false;
    return this.dialog.dismiss();
  }

  /**
   * True while a scripted beat owns both crawlers' bodies. The scene withholds
   * movement and attack input for its whole run.
   */
  get playerLocked(): boolean {
    return this.battle?.playerLocked === true;
  }

  /**
   * The Lich fight, once one is running, for reading rather than driving.
   *
   * `scripts/verify-lich.ts` plays the whole encounter through this: the phase
   * it is in and the escape vector out of whatever it has on the floor are the
   * two things a harness needs to fight it, and they are the two things a real
   * player and a real companion read too. Null before the reveal and after the
   * Lich falls.
   */
  get lichBattle(): LichBattleSystem | null {
    return this.battle;
  }

  handleClick(mx: number, my: number): boolean {
    return this.dialog.handleClick(mx, my);
  }

  /** Space on the body: one page of what the party can now see. Optional. */
  tryExamine(active: Player): boolean {
    if (this.dialog.isOpen) return false;
    if (!this.corpseExaminable) return false;
    if (this.distanceToCorpse(active) > TILE_SIZE * EXAMINE_RANGE_TILES) return false;
    this.dialog.open(FEATHERFALL_EXAMINE_DIALOG, () => {
      this.corpseExamined = true;
    });
    return true;
  }

  /**
   * The body is worth remarking on once, and only while the room still claims
   * otherwise. After the reveal the party knows exactly what they are looking
   * at, and a prompt offering to explain it again is noise in a boss fight.
   */
  private get corpseExaminable(): boolean {
    return this.phase === 'quill_fight' && !this.corpseExamined;
  }

  private distanceToCorpse(active: Player): number {
    return Math.hypot(
      this.corpseTile.x * TILE_SIZE - active.x,
      this.corpseTile.y * TILE_SIZE - active.y,
    );
  }

  // ── Frame update ──────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.frameCount++;
    if (this.bannerTimer > 0) this.bannerTimer--;
    // The office scene holds the room itself and releases it when the fight
    // opens, so the banner countdown must not let go of it on the way.
    if (this.heldForBanner && this.bannerTimer <= 0 && this.phase !== 'office_scene') {
      this.releaseRoom();
    }
    if (this.victoryTimer > 0) this.victoryTimer--;
    if (this.dimTimer < REVEAL_DIM_FADE_FRAMES && this.roomIsDimmed) this.dimTimer++;

    switch (this.phase) {
      case 'office_scene':
        break;
      case 'quill_fight':
        if (this.culpritsDown()) this.beginRevealHold();
        break;
      case 'reveal_hold':
        this.revealHoldTimer--;
        if (this.revealHoldTimer <= 0) this.openReveal();
        break;
      case 'reveal':
        break;
      case 'materialising':
        this.materialiseTimer--;
        if (this.materialiseTimer <= 0) this.beginLichFight();
        break;
      case 'lich_fight':
        // Both halves held while one of its own barks is on screen. The scene
        // halts the world for that too, but a system must not depend on somebody
        // else's early return to know its phases are paused — and the death
        // check in particular would replace the open bark with the victory
        // dialog, throwing away the callback that raises the phase's banner and
        // starts its slide.
        if (!this.dialog.isOpen) {
          this.battle?.update(ctx);
          if (this.lich !== null && !this.lich.isAlive) this.beginVictoryScene(this.lich);
        }
        break;
      case 'victory_scene':
        break;
      case 'done':
        break;
    }
  }

  /** Every mortal culprit in the room, so the reveal waits for the last of them. */
  private culpritsDown(): boolean {
    const quill = this.quill;
    if (quill === null) return false;
    if (quill.isAlive) return false;
    if (this.remex?.isAlive === true) return false;
    return this.guards.every((guard) => !guard.isAlive);
  }

  private beginRevealHold(): void {
    this.phase = 'reveal_hold';
    this.revealHoldTimer = REVEAL_HOLD_FRAMES;
    this.progress.stage = 'quill_slain';

    const quill = this.quill;
    if (quill !== null) {
      // `music: 'caller'` because what follows this fight is not the town's
      // playlist yet — the room's second boss is about to claim the speakers.
      this.bus.emit('bossDefeated', { bossType: 'miss_quill', mob: quill, music: 'caller' });
      // Where the crystal is, recorded the moment she drops. It goes on the
      // cross-scene record rather than on this system because the party can die
      // to what comes next and climb the tower again, and this system is rebuilt
      // from scratch when they do — with nothing left in the room that knows
      // where she fell.
      this.doomsdayProgress.crystalTile = { x: quill.x, y: quill.y };
    }
    this.audio?.stopMusic();
  }

  private openReveal(): void {
    this.phase = 'reveal';
    // Kicked off here, not at `beginLichFight`, so the Lich's sheets have the
    // whole reveal dialog plus the materialise hold to land — the fight
    // starts the instant the last dialog page closes, with nowhere left to
    // load anything.
    //
    // `typeof Image` guards this the same way `BountySystem.stageEncounter`
    // does: `scripts/verify-assets.ts` and friends can exercise this system
    // under plain Node, with no `Image`/`document`.
    const assetReq = SYSTEM_ASSET_REQUIREMENTS.find((req) => req.id === 'quest:murder_lich');
    if (assetReq !== undefined && typeof Image !== 'undefined') {
      void prewarmGroups(assetReq.requiredGroups);
    }
    this.dialog.open(LICH_REVEAL_DIALOG, () => this.beginMaterialise());
  }

  private beginMaterialise(): void {
    this.phase = 'materialising';
    this.materialiseTimer = MATERIALISE_FRAMES;
    this.audio?.play('skeleton_lord_chant');
  }

  private beginLichFight(): void {
    this.phase = 'lich_fight';
    const lich = new TheLich(this.lichTile.x, this.lichTile.y, TILE_SIZE);
    lich.setMap(this.map);
    lich.applyMobLevel(questMobLevel(LICH_LEVEL, this.partyLevel));
    applyActiveDifficultyRewards(lich);
    this.addMob(lich);
    this.lich = lich;
    this.battle = new LichBattleSystem(this.map, lich, this.audio, this.companion, {
      openBark: (pages, onClosed) => this.dialog.open(pages, onClosed),
      showBanner: (title, subtitle) => this.showBanner(lichPhaseBanner(title, subtitle)),
    });
    this.showBanner(LICH_BANNER);
    this.holdRoomForBanner();
    this.bus.emit('bossFightInitiated', { bossType: 'the_lich', music: 'caller' });
    this.audio?.playMusic('boss_music_2', { fadeInMs: BOSS_MUSIC_FADE_IN_MS });
  }

  /**
   * The Lich is down; the room gets its last word before the floor starts
   * shaking.
   *
   * The Doomsday chain is armed only when this closes, and not a frame earlier:
   * the containment deadline is wall-clock, so arming it under a dialog the
   * player is still reading would spend part of the window on the reading.
   */
  private beginVictoryScene(lich: TheLich): void {
    this.phase = 'victory_scene';
    // Everything the fight had in the air goes now, so nothing is still falling
    // over an office the party has already won.
    this.battle?.dispose();
    this.battle = null;
    this.dialog.open(VICTORY_DIALOG, () => this.finishConfrontation(lich));
  }

  private finishConfrontation(lich: TheLich): void {
    this.phase = 'done';
    this.progress.stage = 'lich_slain';
    this.victoryTimer = VICTORY_BANNER_FRAMES;
    // The chant is long enough to still be playing on the frame that kills it —
    // a victory that keeps talking over its own death stinger reads as a bug,
    // not a boss. Its other voice cues are one-shots short enough this never
    // catches them mid-line, but stopping is cheap and correct either way.
    this.audio?.stopSound('skeleton_lord_chant');
    this.audio?.stopSound('dead_hand_wave');
    this.audio?.stopSound('magic_ball_launch');
    // The phase cues, on the same principle: a wave igniting or an orb landing
    // on the frame the fight ends would keep the fire crackling under the
    // victory card.
    this.audio?.stopSound('magic_ball_impact');
    this.audio?.stopSound('llama_fireball');
    this.audio?.stopSound('deep_rumbling');
    this.audio?.stopSound('powering_off');
    this.audio?.stopSound('charging_up_1');
    this.bus.emit('bossDefeated', { bossType: 'the_lich', mob: lich, music: 'caller' });
    this.bus.emit('objectiveComplete', { objectiveId: 'krasue_lich_destroyed' });
    this.audio?.playMusicPlaylist(TOWN_MUSIC_TRACKS, { fadeInMs: VICTORY_MUSIC_FADE_IN_MS });

    // The crystal is Miss Quill's and it destabilized when she died, but the
    // countdown it starts is wall-clock and the Lich stood between the party and
    // the stairs. Starting the clock at her death would have spent most of the
    // containment window on a fight there was no way to skip.
    //
    // Falls back to where the Lich fell only if her position was never recorded,
    // which means the room was rebuilt straight into this fight after a defeat —
    // the finale must not be strandable by having died once.
    this.doomsdayProgress.crystalTile ??= { x: lich.x, y: lich.y };
    this.doomsdayProgress.stage = 'containment';
    this.doomsdayProgress.deadlineAt = Date.now() + CONTAINMENT_DURATION_MS;
    this.audio?.play('rumble');
  }

  /** The party left the top floor; see `LichBattleSystem.leaveFloor`. */
  leaveFloor(ctx: SystemContext): void {
    this.battle?.leaveFloor(ctx);
  }

  /**
   * Scene teardown. The battle's hazards and its hold on the Lich's body go
   * with it — a driver still attached to a creature that outlives this system
   * would answer every question with a phase that no longer exists.
   */
  dispose(): void {
    this.battle?.dispose();
    this.battle = null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private get roomIsDimmed(): boolean {
    return (
      this.phase === 'reveal_hold' || this.phase === 'reveal' || this.phase === 'materialising'
    );
  }

  /**
   * The office's own furniture: the magistrate at his desk, and whatever light
   * is on him. Drawn under the figures so anything crossing the room passes in
   * front of the desk rather than behind it.
   */
  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    const corpseX = this.corpseTile.x * TILE_SIZE - camX;
    const corpseY = this.corpseTile.y * TILE_SIZE - camY;

    if (this.roomIsDimmed) {
      const fade = this.dimTimer / REVEAL_DIM_FADE_FRAMES;
      drawOverlay(ctx, {
        canvasWidth: viewportWidth(),
        canvasHeight: viewportHeight(),
        color: REVEAL_DIM_COLOR,
        alpha: REVEAL_DIM_ALPHA * fade,
      });
      drawRadialGlow(
        ctx,
        corpseX + TILE_SIZE * CENTER_OFFSET,
        corpseY + TILE_SIZE * CENTER_OFFSET,
        TILE_SIZE * REVEAL_SPOTLIGHT_RADIUS_TILES,
        [
          { offset: 0, color: `rgba(${REVEAL_SPOTLIGHT_RGB}, ${REVEAL_SPOTLIGHT_ALPHA})` },
          { offset: 1, color: `rgba(${REVEAL_SPOTLIGHT_RGB}, 0)` },
        ],
        REVEAL_SPOTLIGHT_CORE_FRACTION,
      );
    }

    drawSkyFowlCorpse(ctx, corpseX, corpseY, TILE_SIZE);

    if (this.phase === 'materialising') {
      const progress = 1 - this.materialiseTimer / MATERIALISE_FRAMES;
      const lichX = this.lichTile.x * TILE_SIZE - camX + TILE_SIZE * CENTER_OFFSET;
      const lichY = this.lichTile.y * TILE_SIZE - camY + TILE_SIZE * CENTER_OFFSET;
      for (let burst = 0; burst < MATERIALISE_BURST_COUNT; burst++) {
        const scale = TILE_SIZE * (1 + burst * MATERIALISE_BURST_SCALE_STEP);
        drawSoulBurst(ctx, lichX, lichY, scale, progress);
      }
    }

    if (
      this.corpseExaminable &&
      !this.dialog.isOpen &&
      this.distanceToCorpse(active) <= TILE_SIZE * EXAMINE_RANGE_TILES
    ) {
      drawInteractionPrompt(ctx, corpseX, corpseY, TILE_SIZE, 'Examine');
    }

    // Last in this pass, so a wave's telegraph and an orb's warning circle land
    // on top of the office's own floor paint rather than under it.
    this.battle?.renderWorld(ctx, camX, camY);
  }

  /**
   * The fight's hazards, drawn after the sorted pass — see
   * `LichBattleSystem.renderEffects` for why they belong over the crawlers
   * rather than under them.
   */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.battle?.renderEffects(ctx, camX, camY, this.frameCount);
  }

  renderUI(ctx: CanvasRenderingContext2D): void {
    this.renderBossBar(ctx);
    this.battle?.renderUI(ctx);
    this.renderBanner(ctx);
    this.renderVictory(ctx);
    this.dialog.render(ctx);
  }

  private renderBossBar(ctx: CanvasRenderingContext2D): void {
    const boss: MissQuill | TheLich | null =
      this.phase === 'quill_fight' ? this.quill : this.phase === 'lich_fight' ? this.lich : null;
    if (boss?.isAlive !== true) return;

    const barX = viewportWidth() / 2 - BOSS_BAR_WIDTH / 2;
    drawText(ctx, boss.displayName, {
      x: viewportWidth() / 2,
      y: BOSS_BAR_LABEL_Y,
      size: BOSS_BAR_LABEL_SIZE,
      bold: true,
      color: '#f47c7c',
      align: 'center',
    });
    drawProgressBar(ctx, {
      x: barX,
      y: BOSS_BAR_Y,
      width: BOSS_BAR_WIDTH,
      height: BOSS_BAR_HEIGHT,
      value: boss.hp / boss.maxHp,
      ...PROGRESS_PRESETS.hp,
    });

    if (this.phase === 'lich_fight') {
      const objective = this.battle?.objectiveLine;
      if (objective !== undefined) {
        drawText(ctx, objective, {
          x: viewportWidth() / 2,
          y: viewportHeight() - OBJECTIVE_Y_FROM_BOTTOM,
          size: OBJECTIVE_SIZE,
          bold: true,
          color: '#a8f070',
          align: 'center',
        });
      }
      return;
    }

    const remexAlive = this.remex?.isAlive ?? false;
    drawText(
      ctx,
      remexAlive
        ? 'Destroy Remex — his stored souls shield her'
        : 'The shield is broken — Miss Quill is exposed!',
      {
        x: viewportWidth() / 2,
        y: viewportHeight() - OBJECTIVE_Y_FROM_BOTTOM,
        size: OBJECTIVE_SIZE,
        bold: true,
        color: remexAlive ? '#e8d060' : '#a8f070',
        align: 'center',
      },
    );
  }

  private renderBanner(ctx: CanvasRenderingContext2D): void {
    if (this.bannerTimer <= 0) return;
    const card = this.banner;
    drawQuestBanner(ctx, card.title, this.bannerTimer, card.color, card.shadow);
    const alpha = this.bannerTimer < BANNER_FADE_FRAMES ? this.bannerTimer / BANNER_FADE_FRAMES : 1;
    drawText(ctx, card.subtitle, {
      x: viewportWidth() / 2,
      y: BANNER_SUBTITLE_Y,
      size: BANNER_SUBTITLE_SIZE,
      color: card.subtitleColor,
      align: 'center',
      alpha,
    });
  }

  private renderVictory(ctx: CanvasRenderingContext2D): void {
    // Only the end of the whole confrontation arms this timer: Quill's death is
    // a turn in the room, not the end of it, and a card telling the player the
    // murders are over while the thing behind them is still forming would be
    // the game lying to them.
    if (this.victoryTimer <= 0) return;
    const alpha =
      this.victoryTimer < BANNER_FADE_FRAMES ? this.victoryTimer / BANNER_FADE_FRAMES : 1;
    drawText(ctx, 'THE MAGISTRACY IS EMPTY', {
      x: viewportWidth() / 2,
      y: viewportHeight() / 2 - VICTORY_TITLE_Y_OFFSET,
      size: VICTORY_TITLE_SIZE,
      bold: true,
      color: '#4ade80',
      align: 'center',
      alpha,
      glow: '#4ade80',
      glowBlur: VICTORY_GLOW_BLUR,
    });
    drawText(ctx, 'The murders are over. Return to the streets below.', {
      x: viewportWidth() / 2,
      y: viewportHeight() / 2 + VICTORY_SUBTITLE_Y_OFFSET,
      size: VICTORY_SUBTITLE_SIZE,
      color: '#d4edaa',
      align: 'center',
      alpha,
    });
  }
}

/**
 * Which fight the room owes the party, rebuilt from cross-scene quest state.
 *
 * `'quill_slain'` means they have already seen the reveal and lost to what came
 * out of it, so the room opens straight into the Lich.
 */
function phaseFor(progress: MurderQuestProgress): ConfrontationPhase {
  if (progress.stage === 'confrontation') {
    return progress.officeSceneSeen ? 'quill_fight' : 'office_scene';
  }
  if (progress.stage === 'quill_slain') return 'lich_fight';
  return 'done';
}
