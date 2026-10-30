/**
 * The gallery's HUD sheet: the real `HudSurface` drawn from fixture models —
 * a quiet moment with skill points to spend and toasts up, a boss fight with
 * the top band full and statuses ticking, a building with its room-name banner, the sound captions beside a toast and
 * a credit card, a hotbar slot's tooltip read over the open bag, and the AI
 * panel online (a question with reply buttons) and offline.
 */

import { rewardsBannerEntry } from '../../ui/hud/rewardsBanner';
import { crawlerDisplayName } from '../../characters/characters';
import {
  HOTBAR_COUNT,
  ITEM_DEF,
  type InventoryItem,
  type ItemId,
} from '../../core/items/defs/ItemDefs';
import type { Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import { AIChatFeed } from '../../ai/AIChatFeed';
import { CAROLINE_CHARACTER_NAME } from '../../ai/characters';
import { aiPanelSurface } from '../../ui/hud/aiPanel';
import { aiChallengeBandEntry } from '../../ui/hud/aiChallengeBand';
import { HudSurface } from '../../ui/hud/HudSurface';
import type {
  CrawlerPresence,
  DockButtonModel,
  HotbarSlotModel,
  HudModel,
  StatusPillModel,
  UnitFrameModel,
} from '../../ui/hud/hudModel';
import {
  musicCredit,
  NowPlayingCard,
  postMusicBackfillToast,
  postMusicUnlockToast,
} from '../../ui/hud/nowPlaying';
import { HudToasts } from '../../ui/hud/toasts';
import { SoundCaptions } from '../../ui/hud/captions';
import type { MusicTrackId } from '../../audio/sounds';
import { LOOT_SEAL_NOTICE } from '../../systems/BossRoomSystem';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { stackedBandEntry } from '../../ui/hud/topBandStack';
import { QUEST_BANNER_FRAMES, questBannerEntry } from '../../ui/QuestBanners';
import { palette } from '../../ui/theme/tokens';
import { drawDeinonychusIcon, type DeinonychusStage } from '../../sprites/deinonychusSprite';
import type { DialogFixture } from './dialogs/fixture';
import { siegeHudEntry, type SiegeHudBar } from '../../systems/briarHollow/siegeHudEntry';
import { UPDATES_PER_SECOND } from '../../systems/briarHollow/structureRules';
import type {
  BellAlertView,
  SiegeOutcomeView,
} from '../../systems/briarHollow/VillageAssaultSystem';
import {
  BELL_ALERT_DETAIL,
  BELL_ALERT_HEADLINE,
  SIEGE_LOSS_COPY,
  bellThresholdDetail,
} from '../../systems/briarHollow/siegeAlertCopy';
import {
  siegeBellAlertSurface,
  siegeHudKeepouts,
  siegeLossExplainerSurface,
  siegeOutcomeSurface,
  type SiegeHudKeepouts,
} from '../../ui/hud/siegeBellAlert';
import { siegeVictorySurface } from '../../ui/hud/siegeVictoryCelebration';
import { buildFixture as inventoryFixture } from './inventory';
import { PET_NAME_SUGGESTIONS } from '../../core/party/petNames';
import { cameraAt, UNZOOMED } from '../../core/rendering/camera';

const FIXTURE_TOAST_TICKS = 20;
/** Long enough for Caroline's notice to unfold and decode in full, short of its fold. */
const CAROLINE_TOAST_READ_TICKS = 90;
/** A cry heard three times while its caption was up. */
const MERGED_CAPTION_REPEATS = 3;
/** Up and to the left of the screen's middle, in radians. */
const OFFSCREEN_CRY_DIRECTION = -2.4;
const BOSS_HP = 420;
const BOSS_MAX_HP = 900;
const BOSS_ACCENT = palette.meter.boss;
const BOSS_MIDLINE = 0.5;
/** Four minutes left on a floor's Nightmare time limit, in frames: its red tier. */
const LATE_TIMER_FRAMES = 14_400;
/** Most of an hour left on the Nightmare time limit, in frames: its calm tier. */
const EARLY_TIMER_FRAMES = 212_520;
const REVIVE_SECONDS_LEFT = 49;
const FUZZY_NIGHTMARE_SECONDS_LEFT = 18;
const FUZZY_NIGHTMARE_APPROACH_FRACTION = 0.3;
const GRATE_COUNT = 4;
const POTION_STACK = 6;
const DYNAMITE_STACK = 3;
/** The stand-in map's floor strips are this many tiles apart. */
const MINIMAP_ROW_STEP = 3;
const PARTY_DOT = 4;
/** The largest growth stage, whose art reaches furthest past its tile. */
const SUMMON_PORTRAIT_STAGE = 'adult' as const satisfies DeinonychusStage;
const FIXTURE_DEINONYCHUS_NAME = PET_NAME_SUGGESTIONS.deinonychus[0];
const ENCOUNTER_WAVE_FRACTION = 0.6;
const STATUS_HALF = 0.5;
const STATUS_MOST = 0.85;
const COOLDOWN_SECONDS = 4;
const COOLDOWN_FRACTION = 0.4;
const MINIMAP_TILE = 8;
/** The dynamite stack: its tooltip carries a description long enough to wrap. */
const HOVERED_HOTBAR_SLOT = 2;
/** The siege fixtures show the third of the four waves. */
const SIEGE_FIXTURE_WAVE = 3;
const SIEGE_FIXTURE_WAVE_COUNT = 4;
/** Past the card's slam and shake, well before its fade. */
const SIEGE_ALERT_AGE_FRAMES = 90;
const SIEGE_ALERT_FRAMES_LEFT = 180;
const SIEGE_ALERT_BELL_FRACTION = 0.62;
const SIEGE_THRESHOLD_SHARE = 0.5;
/** The camera's corner, and the bell up and to the left of everything it shows. */
const SIEGE_FIXTURE_CAMERA_TOP_LEFT = { x: 2400, y: 2000 } as const;
const SIEGE_BELL_WORLD = { x: 1700, y: 1500 } as const;
const VICTORY_SLAMMING_SECONDS = 0.3;
const VICTORY_FIREWORKS_SECONDS = 3;
const VICTORY_HAND_OFF_SECONDS = 7;
/** The victory as it slams in, with the fireworks going, and once the hand-off line is up. */
const SIEGE_VICTORY_SECONDS = [
  VICTORY_SLAMMING_SECONDS,
  VICTORY_FIREWORKS_SECONDS,
  VICTORY_HAND_OFF_SECONDS,
] as const;

function item(id: ItemId, quantity: number): InventoryItem {
  return { ...ITEM_DEF[id], quantity };
}

const HOTBAR_ITEMS: readonly (InventoryItem | null)[] = [
  item('seismic_stomp_tome', 1),
  item('health_potion', POTION_STACK),
  item('dynamite', DYNAMITE_STACK),
  null,
  item('magic_missile_tome', 1),
  null,
  null,
  null,
];

function hotbarSlots(cooling: boolean): HotbarSlotModel[] {
  return Array.from({ length: HOTBAR_COUNT }, (_, index) => {
    const slotItem = HOTBAR_ITEMS[index] ?? null;
    const onCooldown = cooling && index === 0;
    return {
      item: slotItem,
      equipped: false,
      awakened: false,
      cooldown: onCooldown ? COOLDOWN_FRACTION : 0,
      cooldownLabel: String(COOLDOWN_SECONDS),
      unseen: index === 1,
    };
  });
}

function crawlers(
  status: readonly StatusPillModel[],
  skillPoints: number,
  companionStatus: readonly StatusPillModel[],
  companionPresence: CrawlerPresence,
  companionSenseCue: boolean,
): [UnitFrameModel, UnitFrameModel] {
  return [
    {
      id: 'human',
      name: crawlerDisplayName('human'),
      glyph: 'user',
      level: 7,
      hp: 84,
      maxHp: 120,
      xp: 340,
      xpMax: 520,
      status,
      skillPoints,
      presence: 'here',
      senseCue: false,
    },
    {
      id: 'cat',
      name: crawlerDisplayName('cat'),
      glyph: 'cat',
      level: 8,
      hp: 22,
      maxHp: 96,
      xp: 120,
      xpMax: 610,
      status: companionStatus,
      skillPoints: 0,
      presence: companionPresence,
      senseCue: companionSenseCue,
    },
  ];
}

const FIGHT_STATUS: readonly StatusPillModel[] = [
  { id: 'burn', label: 'BURN', color: palette.state.danger, remaining: STATUS_HALF, harmful: true },
  { id: 'haste', label: 'FAST', color: palette.state.info, remaining: STATUS_MOST, harmful: false },
];

const COMPANION_NINE_LIVES_STATUS: readonly StatusPillModel[] = [
  {
    id: 'nine_lives',
    label: 'LIVES',
    color: palette.state.success,
    remaining: null,
    harmful: false,
  },
];

const record = (): void => undefined;
/** Rewards the safe-room banner fixture says are waiting. */
const SAFE_ROOM_REWARDS_WAITING = 2;

function dock(extra: readonly DockButtonModel['id'][]): DockButtonModel[] {
  const buttons: DockButtonModel[] = [
    { id: 'pause', icon: 'pause', label: 'Pause', key: 'Esc', onTap: record },
    { id: 'bag', icon: 'bag', label: 'Bag', key: 'I', badge: '2', onTap: record },
    { id: 'journal', icon: 'compass', label: 'Quest Journal', key: 'J', badge: '3', onTap: record },
    { id: 'follower', icon: 'users', label: 'Follower orders', key: 'F', onTap: record },
    { id: 'switch', icon: 'cat', label: `Switch to ${crawlerDisplayName('cat')}`, onTap: record },
  ];
  if (extra.includes('build')) {
    buttons.push({
      id: 'build',
      icon: 'hammer',
      label: 'Build',
      key: 'U',
      pulse: true,
      onTap: record,
    });
  }
  if (extra.includes('chip')) {
    buttons.push({
      id: 'chip',
      icon: 'trophy',
      label: 'Rewards waiting',
      badge: '2',
      pulse: true,
      onTap: record,
    });
  }
  return buttons;
}

/** A stand-in map: a few rooms of floor on wall, the party a dot in the middle. */
function paintMap(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillStyle = palette.surface.sunken;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = palette.material.brassDark;
  for (
    let y = rect.y + MINIMAP_TILE;
    y < rect.y + rect.h - MINIMAP_TILE;
    y += MINIMAP_TILE * MINIMAP_ROW_STEP
  ) {
    ctx.fillRect(rect.x + MINIMAP_TILE, y, rect.w - MINIMAP_TILE * 2, MINIMAP_TILE * 2);
  }
  ctx.fillStyle = palette.state.success;
  ctx.fillRect(
    rect.x + rect.w / 2 - PARTY_DOT / 2,
    rect.y + rect.h / 2 - PARTY_DOT / 2,
    PARTY_DOT,
    PARTY_DOT,
  );
}

function bossEntry(): TopBandEntry {
  return stackedBandEntry({
    id: 'boss-room',
    priority: 'boss',
    accent: BOSS_ACCENT,
    rows: [
      {
        kind: 'text',
        text: 'THE TRASH GREMLIN',
        role: 'label',
        color: BOSS_ACCENT,
        align: 'center',
      },
      {
        kind: 'meter',
        id: 'boss-room/hp',
        value: BOSS_HP,
        max: BOSS_MAX_HP,
        meterKind: 'boss',
        valueText: `${BOSS_HP} / ${BOSS_MAX_HP}`,
        marks: [BOSS_MIDLINE],
      },
      {
        kind: 'text',
        text: 'Entry closes in 12s',
        role: 'label',
        tone: 'warning',
        tabular: true,
        align: 'center',
      },
    ],
  });
}

function encounterEntry(): TopBandEntry {
  return stackedBandEntry({
    id: 'siege',
    priority: 'encounter',
    rows: [
      { kind: 'text', text: 'Defend Briar Hollow — Wave 2/4', role: 'label', align: 'center' },
      {
        kind: 'meter',
        id: 'siege/bell',
        value: ENCOUNTER_WAVE_FRACTION,
        max: 1,
        meterKind: 'hp',
        label: 'Clocktower',
      },
    ],
  });
}

/**
 * `saving` is the lone save toast, the notice most often seen on a phone held
 * upright. `lootSeal` is the warning at a won boss room's sealed doorway,
 * which has to read in full on a phone rather than be ellipsized. The music
 * notices: one unlock; the club's arrival, four unlocks and the first song's
 * credit; the longest credit in the catalogue, which must wrap on a phone;
 * and the one backfill summary a run started part-way through the game displays.
 * `caroline` is two of her compact notices, a long and a very short one,
 * decoded in full beside an ordinary one.
 */
type FixtureToasts =
  | 'none'
  | 'mixed'
  | 'saving'
  | 'lootSeal'
  | 'musicUnlock'
  | 'clubArrival'
  | 'longCredit'
  | 'musicBackfill'
  | 'captions'
  | 'caroline';

const CLUB_SONGS = [
  'cloak_and_dagger_1',
  'cloak_and_dagger_2',
  'cloak_and_dagger_3',
  'cloak_and_dagger_4',
] as const satisfies readonly MusicTrackId[];
/** A plausible count for a run started part-way through Taloncrest. */
const BACKFILLED_SONG_COUNT = 21;

interface HudFixtureSpec {
  readonly name: string;
  readonly status: readonly StatusPillModel[];
  readonly companionStatus?: readonly StatusPillModel[];
  /** Whether the companion's card shows it on another map, as a split party does. */
  readonly companionAway?: boolean;
  /** Whether something only the companion perceives is in their reach. */
  readonly companionSenseCue?: boolean;
  readonly skillPoints: number;
  readonly dockExtras: readonly DockButtonModel['id'][];
  readonly topBand: () => TopBandEntry[];
  /** Frames left on the floor's Nightmare time limit; absent where there is none. */
  readonly levelTimerFrames?: number;
  readonly toasts: FixtureToasts;
  readonly expanded: boolean;
  /** Fills the AI panel; absent leaves it unmounted. */
  readonly ai?: (feed: AIChatFeed) => void;
}

function hudFixture(spec: HudFixtureSpec): DialogFixture {
  return {
    name: spec.name,
    surfaces: (shown) => {
      const toasts = new HudToasts();
      const nowPlaying = new NowPlayingCard();
      const captions = new SoundCaptions();
      if (spec.toasts === 'captions') {
        captions.post({ text: 'Alarm bell rings', direction: null });
        for (let repeat = 0; repeat < MERGED_CAPTION_REPEATS; repeat++) {
          captions.post({ text: 'Guard shouts', direction: null });
        }
        captions.post({ text: 'Mantid hisses', direction: OFFSCREEN_CRY_DIRECTION });
        toasts.post('Game Saved', { tone: 'success', icon: 'save' });
        nowPlaying.show(musicCredit('cloak_and_dagger_1'));
      }
      if (spec.toasts === 'musicUnlock') postMusicUnlockToast(toasts, 'terrifying_woods');
      if (spec.toasts === 'clubArrival') {
        for (const song of CLUB_SONGS) postMusicUnlockToast(toasts, song);
        nowPlaying.show(musicCredit('cloak_and_dagger_1'));
      }
      if (spec.toasts === 'longCredit') nowPlaying.show(musicCredit('cloak_and_dagger_3'));
      if (spec.toasts === 'musicBackfill') postMusicBackfillToast(toasts, BACKFILLED_SONG_COUNT);
      if (spec.toasts === 'saving') {
        toasts.post('Saving...', { tone: 'neutral', icon: 'save' });
      }
      if (spec.toasts === 'lootSeal') {
        toasts.post(LOOT_SEAL_NOTICE, { tone: 'info' });
      }
      if (spec.toasts === 'mixed') {
        toasts.post('Health restored', { tone: 'success', icon: 'flask' });
        toasts.post('Not enough coins', { tone: 'warning', icon: 'coin' });
        toasts.post('Game Saved', { tone: 'success', icon: 'save' });
        toasts.post(`${FIXTURE_DEINONYCHUS_NAME} is recovering −3.6s`, {
          tone: 'info',
          icon: 'hourglass',
        });
        toasts.post(`Wear the ${ITEM_DEF.lucky_hoodie.name} — it does nothing in the bag!`, {
          tone: 'warning',
        });
      }
      if (spec.toasts === 'caroline') {
        toasts.post('Game Saved', { tone: 'success', icon: 'save' });
        toasts.post('Boss eliminated. Time: 4 minutes 12 seconds.', { voice: 'caroline' });
        toasts.post('Saved.', { voice: 'caroline' });
        for (let tick = 0; tick < CAROLINE_TOAST_READ_TICKS; tick++) toasts.update();
      }
      for (let tick = 0; tick < FIXTURE_TOAST_TICKS; tick++) {
        toasts.update();
        nowPlaying.update();
        captions.update();
      }
      const model = (): HudModel => ({
        crawlers: crawlers(
          spec.status,
          spec.skillPoints,
          spec.companionStatus ?? [],
          spec.companionAway === true ? 'away' : 'here',
          spec.companionSenseCue === true,
        ),
        activeCrawler: 'human',
        coins: {
          shown: 1240,
          split: `${crawlerDisplayName('human')} 900 · ${crawlerDisplayName('cat')} 340`,
          pulse: 0,
        },
        skillPoints: { hidden: false, nag: spec.skillPoints > 0, open: record },
        minimap: {
          expanded: spec.expanded,
          hint: spec.expanded ? 'M: collapse | drag to scroll' : 'M: expand',
          paint: paintMap,
          toggle: record,
        },
        dock: dock(spec.dockExtras),
        summon: {
          petName: FIXTURE_DEINONYCHUS_NAME,
          label: 'Summon',
          active: false,
          usable: true,
          ready: true,
          hp: 130,
          maxHp: 130,
          xpFraction: STATUS_HALF,
          cooldown: 0,
          cooldownSeconds: 0,
          paintIcon: (ctx, rect) =>
            drawDeinonychusIcon(
              ctx,
              SUMMON_PORTRAIT_STAGE,
              rect.x + rect.w / 2,
              rect.y + rect.h / 2,
              Math.min(rect.w, rect.h),
            ),
          onTap: record,
        },
        hotbar: {
          slots: hotbarSlots(spec.status.length > 0),
          input: { press: record, release: record },
        },
        topBand: spec.topBand(),
        levelTimer:
          spec.levelTimerFrames === undefined
            ? null
            : { frames: spec.levelTimerFrames, paused: false },
      });
      const hud = new HudSurface({
        id: `hud-${spec.name}`,
        visible: shown,
        model,
        toasts: () => toasts,
        nowPlaying: () => nowPlaying,
        captions: () => captions,
      });
      const surfaces: Surface[] = [hud, hud.overlay()];
      const fillAI = spec.ai;
      if (fillAI !== undefined) {
        const feed = new AIChatFeed();
        fillAI(feed);
        surfaces.splice(
          1,
          0,
          aiPanelSurface({
            id: `ai-panel-${spec.name}`,
            feed,
            hudVisible: shown,
            onChoice: record,
          }),
        );
      }
      return surfaces;
    },
  };
}

/** A downed companion's call to revive, as `knockedOutBandEntry` draws it. */
function reviveEntry(): TopBandEntry {
  return stackedBandEntry({
    id: 'knockout',
    priority: 'countdown',
    accentTone: 'danger',
    rows: [
      { kind: 'text', text: 'Revive your teammate!', role: 'title', tone: 'danger', maxLines: 2 },
      {
        kind: 'text',
        text: `${REVIVE_SECONDS_LEFT}s`,
        role: 'heading',
        tone: 'warning',
        tabular: true,
      },
    ],
  });
}

/** The grate-defence quest's approach card, as `DefendQuestSystem` draws it. */
function fuzzyNightmareEntry(): TopBandEntry {
  return stackedBandEntry({
    id: 'defend-status',
    priority: 'encounter',
    accentTone: 'warning',
    rows: [
      { kind: 'text', text: 'FUZZY NIGHTMARES INCOMING', role: 'title', tone: 'warning' },
      {
        kind: 'text',
        text: `Fuzzy Nightmares in ${FUZZY_NIGHTMARE_SECONDS_LEFT}s — board up the grates`,
        role: 'label',
        tabular: true,
        maxLines: 2,
      },
      {
        kind: 'meter',
        id: 'defend-status/time',
        value: FUZZY_NIGHTMARE_APPROACH_FRACTION,
        max: 1,
        meterKind: 'progress',
      },
      { kind: 'text', text: `Grates 0/${GRATE_COUNT}`, role: 'caption', tone: 'muted' },
    ],
  });
}

const SIEGE_WAVE_HEADLINE = `Defend Briar Hollow — Wave ${SIEGE_FIXTURE_WAVE}/${SIEGE_FIXTURE_WAVE_COUNT} (West)`;
/** The longest headlines the card carries: the side the army or the next wave comes from, and the time left. */
const SIEGE_IMMINENT_HEADLINE = 'The army is coming from the North — 1:30';
const SIEGE_LULL_HEADLINE = `Wave ${SIEGE_FIXTURE_WAVE + 1} from the North — 0:25`;

function siegeBellBar(bellFraction: number): SiegeHudBar {
  return { id: 'bell', label: 'Clocktower', fraction: bellFraction, kind: 'hp', flash: 0 };
}

/** A quiet HUD under the siege's card, for the siege's alert and celebration to float over. */
function siegeHud(
  name: string,
  bellFraction: number,
  headline: string = SIEGE_WAVE_HEADLINE,
  bars: readonly SiegeHudBar[] = [siegeBellBar(bellFraction)],
): DialogFixture {
  return hudFixture({
    name,
    status: [],
    skillPoints: 0,
    dockExtras: ['build'],
    topBand: () => [siegeHudEntry({ headline, bars })],
    toasts: 'none',
    expanded: false,
  });
}

/**
 * The clocktower alert mid-hold, with the bell off screen to the north-west
 * of the camera, so the edge pulse, the edge badge and the card all show; a
 * null `detail` is the stretch after the card has gone, the bell still under
 * attack.
 */
function siegeAlertFixture(
  name: string,
  detail: string | null,
  bellFraction: number,
): DialogFixture {
  const hud = siegeHud(name, bellFraction);
  const view: BellAlertView = {
    underAttack: true,
    bellInView: false,
    banner:
      detail === null
        ? null
        : {
            headline: BELL_ALERT_HEADLINE,
            detail,
            age: SIEGE_ALERT_AGE_FRAMES,
            framesLeft: SIEGE_ALERT_FRAMES_LEFT,
          },
    bellFraction,
    bellWorld: SIEGE_BELL_WORLD,
  };
  return {
    name,
    surfaces: (shown) => {
      const hudSurfaces = hud.surfaces(shown);
      const keepouts = drawnHudKeepouts(hudSurfaces);
      return [
        ...hudSurfaces,
        siegeBellAlertSurface(`siege-alert-${name}`, () => ({
          view: shown() ? view : null,
          camera: cameraAt(SIEGE_FIXTURE_CAMERA_TOP_LEFT, UNZOOMED),
          hud: keepouts,
        })),
      ];
    },
  };
}

/** The keep-outs of the HUD among `surfaces` as it last drew, as the scene hands them to the siege. */
function drawnHudKeepouts(surfaces: readonly Surface[]): () => SiegeHudKeepouts | null {
  const hud = surfaces.find((surface) => surface instanceof HudSurface);
  return () => (hud instanceof HudSurface ? siegeHudKeepouts(hud) : null);
}

/** The bell-fall banner a lost siege ends on, mid-hold. */
function siegeOutcomeFixture(name: string): DialogFixture {
  const hud = siegeHud(name, 0);
  const copy = SIEGE_LOSS_COPY.bell_fell;
  const outcome: SiegeOutcomeView = {
    headline: copy.headline,
    detail: copy.detail,
    age: SIEGE_ALERT_AGE_FRAMES,
    framesLeft: SIEGE_ALERT_FRAMES_LEFT,
  };
  return {
    name,
    surfaces: (shown) => {
      const hudSurfaces = hud.surfaces(shown);
      const keepouts = drawnHudKeepouts(hudSurfaces);
      return [
        ...hudSurfaces,
        siegeOutcomeSurface(`siege-outcome-${name}`, () => ({
          outcome: shown() ? outcome : null,
          hud: keepouts,
        })),
      ];
    },
  };
}

/** The explainer that halts the game once the bell-fall banner has had its moment. */
function siegeLossExplainerFixture(name: string): DialogFixture {
  const hud = siegeHud(name, 0);
  return {
    name,
    surfaces: (shown) => [
      ...hud.surfaces(shown),
      siegeLossExplainerSurface(`siege-loss-${name}`, { isOpen: shown, dismiss: record }),
    ],
  };
}

/** The victory celebration `seconds` into its fanfare. */
function siegeVictoryFixture(name: string, secondsIn: number): DialogFixture {
  const hud = siegeHud(name, 1);
  const ageFrames = Math.round(secondsIn * UPDATES_PER_SECOND);
  return {
    name,
    surfaces: (shown) => [
      ...hud.surfaces(shown),
      siegeVictorySurface(`siege-victory-${name}`, () => (shown() ? { ageFrames } : null)),
    ],
  };
}

const SIEGE_FIXTURES: readonly DialogFixture[] = [
  siegeHud('siege-card-imminent', 1, SIEGE_IMMINENT_HEADLINE, []),
  siegeHud('siege-card-lull', SIEGE_ALERT_BELL_FRACTION, SIEGE_LULL_HEADLINE),
  siegeAlertFixture('siege-bell-alert', BELL_ALERT_DETAIL, SIEGE_ALERT_BELL_FRACTION),
  siegeAlertFixture(
    'siege-bell-alert-threshold',
    bellThresholdDetail(SIEGE_THRESHOLD_SHARE),
    SIEGE_THRESHOLD_SHARE,
  ),
  siegeAlertFixture('siege-bell-pointer', null, SIEGE_ALERT_BELL_FRACTION),
  siegeOutcomeFixture('siege-bell-fell'),
  siegeLossExplainerFixture('siege-loss-explainer'),
  ...SIEGE_VICTORY_SECONDS.map((secondsIn) =>
    siegeVictoryFixture(`siege-victory-${secondsIn}s`, secondsIn),
  ),
];

/**
 * The HUD with the bag open over it and a hotbar slot hovered: the slot's
 * tooltip must draw above the bag, not beneath it.
 */
function hotbarTooltipOverMenu(): DialogFixture {
  const name = 'hotbar-tip-over-bag';
  const hud = hudFixture({
    name,
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'none',
    expanded: false,
  });
  const bag = inventoryFixture({ name, tab: 'bag' });
  return {
    name,
    surfaces: (shown) => [...hud.surfaces(shown), ...bag.surfaces(shown)],
    interact: (rig) => rig.hover(rig.need(`hud-${name}/hotbar/${HOVERED_HOTBAR_SLOT}`)),
  };
}

/** Frames for a streamed message to type out completely before the fixture is drawn. */
const AI_TYPE_OUT_FRAMES = 120;

function aiOnline(feed: AIChatFeed): void {
  feed.status = 'online';
  feed.onChat({
    messageId: 'fixture-question',
    characterName: CAROLINE_CHARACTER_NAME,
    text: `${crawlerDisplayName('human')}. A goblin champion holds the corridor ahead. Defeat it for a Rare chest, or withdraw.`,
    done: true,
    choices: [
      { id: 'fight', label: 'Fight' },
      { id: 'flee', label: 'Flee' },
      { id: 'beg', label: 'Beg for mercy' },
    ],
  });
  for (let frame = 0; frame < AI_TYPE_OUT_FRAMES; frame++) feed.update();
  feed.onState({
    characterName: CAROLINE_CHARACTER_NAME,
    mood: { label: 'attentive', intensity: 1 },
    relationship: { respect: 0 },
  });
  feed.onState({
    characterName: CAROLINE_CHARACTER_NAME,
    mood: { label: 'attentive', intensity: 1 },
    relationship: { respect: 1 },
  });
  feed.addIntervention(
    CAROLINE_CHARACTER_NAME,
    `granted ${crawlerDisplayName('human')} a Common chest`,
  );
}

function aiOffline(feed: AIChatFeed): void {
  feed.status = 'offline';
  feed.addScripted(CAROLINE_CHARACTER_NAME, 'Outcome logged. Continue.');
  for (let frame = 0; frame < AI_TYPE_OUT_FRAMES; frame++) feed.update();
}

const RUNNING_CHALLENGE_FRAMES_LEFT = 2_580;
const RUNNING_CHALLENGE_FRAMES_LIMIT = 5_400;

function runningChallengeEntry(): TopBandEntry {
  return aiChallengeBandEntry({
    title: 'Rat Race',
    objective: 'Kill 5 rats within 90s without taking damage',
    progress: '2/5',
    clock: {
      framesLeft: RUNNING_CHALLENGE_FRAMES_LEFT,
      framesLimit: RUNNING_CHALLENGE_FRAMES_LIMIT,
    },
    urgent: false,
  });
}

export const HUD_FIXTURES: readonly DialogFixture[] = [
  hudFixture({
    name: 'ai-challenge',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [runningChallengeEntry()],
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'ai-challenge-timed-floor',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [runningChallengeEntry()],
    levelTimerFrames: LATE_TIMER_FRAMES,
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'ai-online',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'none',
    expanded: false,
    ai: aiOnline,
  }),
  hudFixture({
    name: 'ai-offline',
    status: FIGHT_STATUS,
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'none',
    expanded: false,
    ai: aiOffline,
  }),
  hudFixture({
    name: 'caroline-toast',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'caroline',
    expanded: false,
  }),
  hudFixture({
    name: 'cat-senses',
    status: [],
    companionSenseCue: true,
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'split-party',
    status: [],
    companionAway: true,
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'quiet',
    status: [],
    skillPoints: 2,
    dockExtras: ['chip'],
    topBand: () => [],
    toasts: 'mixed',
    expanded: false,
  }),
  hudFixture({
    name: 'safe-room-rewards',
    status: [],
    skillPoints: 0,
    dockExtras: ['chip'],
    topBand: () => [rewardsBannerEntry({ count: SAFE_ROOM_REWARDS_WAITING, onTap: record })],
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'fight',
    status: FIGHT_STATUS,
    skillPoints: 0,
    dockExtras: ['build'],
    topBand: () => [bossEntry(), encounterEntry()],
    levelTimerFrames: LATE_TIMER_FRAMES,
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'grate-defence',
    status: [],
    companionStatus: COMPANION_NINE_LIVES_STATUS,
    skillPoints: 0,
    dockExtras: ['build'],
    topBand: () => [fuzzyNightmareEntry(), reviveEntry()],
    levelTimerFrames: EARLY_TIMER_FRAMES,
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'safe-room',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => {
      const banner = questBannerEntry({
        id: 'quest-banner',
        title: 'THE ANCHOR IS WHOLE',
        subtitle: 'Madame Voss has welded the shards. The square is a step away.',
        framesLeft: QUEST_BANNER_FRAMES,
        tone: 'success',
      });
      return banner === null ? [] : [banner];
    },
    toasts: 'none',
    expanded: true,
  }),
  hudFixture({
    name: 'saving',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'saving',
    expanded: false,
  }),
  hudFixture({
    name: 'loot-seal',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'lootSeal',
    expanded: false,
  }),
  ...(['musicUnlock', 'clubArrival', 'longCredit', 'musicBackfill'] as const).map((toasts) =>
    hudFixture({
      name: `music-${toasts}`,
      status: [],
      skillPoints: 0,
      dockExtras: [],
      topBand: () => [],
      toasts,
      expanded: false,
    }),
  ),
  hudFixture({
    name: 'music-credit-under-banner',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => {
      const banner = questBannerEntry({
        id: 'quest-banner',
        title: 'THE ANCHOR IS WHOLE',
        subtitle: 'Madame Voss has welded the shards. The square is a step away.',
        framesLeft: QUEST_BANNER_FRAMES,
        tone: 'success',
      });
      return banner === null ? [] : [banner];
    },
    toasts: 'clubArrival',
    expanded: false,
  }),
  hudFixture({
    name: 'sound-captions',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    toasts: 'captions',
    expanded: false,
  }),
  hotbarTooltipOverMenu(),
  ...SIEGE_FIXTURES,
];
