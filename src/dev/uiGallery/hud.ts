/**
 * The gallery's HUD sheet: the real `HudSurface` drawn from fixture models —
 * a quiet moment with skill points to spend and toasts up, a boss fight with
 * the top band full and statuses ticking, the safe room's call to collect,
 * a building with its room-name banner, the sound captions beside a toast and
 * a credit card, and a hotbar slot's tooltip read over the open bag.
 */

import { HOTBAR_COUNT, ITEM_DEF, type InventoryItem, type ItemId } from '../../core/ItemDefs';
import { DOOMSDAY_CONTAIN_OBJECTIVE } from '../../core/DoomsdayProgress';
import { CONTAINMENT_LABEL, doomsdayCountdownEntry } from '../../systems/DoomsdayEscapeSystem';
import type { Rect } from '../../ui/core/geom';
import type { Surface } from '../../ui/core/UiRoot';
import { HudSurface } from '../../ui/hud/HudSurface';
import type {
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
import { drawMongoIcon, type MongoStage } from '../../sprites/mongoSprite';
import type { DialogFixture } from './dialogs/fixture';
import { buildFixture as inventoryFixture } from './inventory';

const FIXTURE_TOAST_TICKS = 20;
/** A cry heard three times while its caption was up. */
const MERGED_CAPTION_REPEATS = 3;
/** Up and to the left of the screen's middle, in radians. */
const OFFSCREEN_CRY_DIRECTION = -2.4;
const BOSS_HP = 420;
const BOSS_MAX_HP = 900;
const BOSS_ACCENT = palette.meter.boss;
const BOSS_MIDLINE = 0.5;
/** Four minutes left on a floor's collapse timer, in frames: its red tier. */
const LATE_TIMER_FRAMES = 14_400;
const DOOMSDAY_MS_LEFT = 200_000;
/** Most of an hour left on the collapse timer, in frames: its calm tier. */
const EARLY_TIMER_FRAMES = 212_520;
const REVIVE_SECONDS_LEFT = 49;
const BUGABOO_SECONDS_LEFT = 18;
const BUGABOO_APPROACH_FRACTION = 0.3;
const GRATE_COUNT = 4;
const POTION_STACK = 6;
const DYNAMITE_STACK = 3;
/** The stand-in map's floor strips are this many tiles apart. */
const MINIMAP_ROW_STEP = 3;
const PARTY_DOT = 4;
/** The largest growth stage, whose art reaches furthest past its tile. */
const SUMMON_PORTRAIT_STAGE = 'adult' as const satisfies MongoStage;
const ENCOUNTER_WAVE_FRACTION = 0.6;
const STATUS_HALF = 0.5;
const STATUS_MOST = 0.85;
const COOLDOWN_SECONDS = 4;
const COOLDOWN_FRACTION = 0.4;
const MINIMAP_TILE = 8;
/** The dynamite stack: its tooltip carries a description long enough to wrap. */
const HOVERED_HOTBAR_SLOT = 2;

function item(id: ItemId, quantity: number): InventoryItem {
  return { ...ITEM_DEF[id], quantity };
}

const HOTBAR_ITEMS: readonly (InventoryItem | null)[] = [
  item('smush_tome', 1),
  item('health_potion', POTION_STACK),
  item('goblin_dynamite', DYNAMITE_STACK),
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
): [UnitFrameModel, UnitFrameModel] {
  return [
    {
      id: 'human',
      name: 'Carl',
      glyph: 'user',
      level: 7,
      hp: 84,
      maxHp: 120,
      xp: 340,
      xpMax: 520,
      status,
      skillPoints,
    },
    {
      id: 'cat',
      name: 'Princess Donut',
      glyph: 'cat',
      level: 8,
      hp: 22,
      maxHp: 96,
      xp: 120,
      xpMax: 610,
      status: companionStatus,
      skillPoints: 0,
    },
  ];
}

const FIGHT_STATUS: readonly StatusPillModel[] = [
  { id: 'burn', label: 'BURN', color: palette.state.danger, remaining: STATUS_HALF, harmful: true },
  { id: 'haste', label: 'FAST', color: palette.state.info, remaining: STATUS_MOST, harmful: false },
];

const COMPANION_ROACH_STATUS: readonly StatusPillModel[] = [
  {
    id: 'cockroach',
    label: 'ROACH',
    color: palette.state.success,
    remaining: null,
    harmful: false,
  },
];

const record = (): void => undefined;

function dock(extra: readonly DockButtonModel['id'][]): DockButtonModel[] {
  const buttons: DockButtonModel[] = [
    { id: 'pause', icon: 'pause', label: 'Pause', key: 'Esc', onTap: record },
    { id: 'bag', icon: 'bag', label: 'Bag', key: 'I', badge: '2', onTap: record },
    { id: 'journal', icon: 'compass', label: 'Quest Journal', key: 'J', badge: '3', onTap: record },
    { id: 'follower', icon: 'users', label: 'Follower orders', key: 'F', onTap: record },
    { id: 'switch', icon: 'cat', label: 'Switch to Donut', onTap: record },
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
      label: 'New achievements',
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
      { kind: 'text', text: 'THE HOARDER', role: 'label', color: BOSS_ACCENT, align: 'center' },
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
        label: 'Hollow Bell',
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
 * and an old save's one backfill summary.
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
  | 'captions';

const CLUB_SONGS = [
  'desperado_club_1',
  'desperado_club_2',
  'desperado_club_3',
  'desperado_club_4',
] as const satisfies readonly MusicTrackId[];
/** A plausible count for an old save part-way through the Over City. */
const BACKFILLED_SONG_COUNT = 21;

interface HudFixtureSpec {
  readonly name: string;
  readonly status: readonly StatusPillModel[];
  readonly companionStatus?: readonly StatusPillModel[];
  readonly skillPoints: number;
  readonly dockExtras: readonly DockButtonModel['id'][];
  readonly topBand: () => TopBandEntry[];
  /** Frames left on the floor's collapse timer; absent on a floor without one. */
  readonly levelTimerFrames?: number;
  readonly lootBanner: boolean;
  readonly toasts: FixtureToasts;
  readonly expanded: boolean;
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
        nowPlaying.show(musicCredit('desperado_club_1'));
      }
      if (spec.toasts === 'musicUnlock') postMusicUnlockToast(toasts, 'terrifying_woods');
      if (spec.toasts === 'clubArrival') {
        for (const song of CLUB_SONGS) postMusicUnlockToast(toasts, song);
        nowPlaying.show(musicCredit('desperado_club_1'));
      }
      if (spec.toasts === 'longCredit') nowPlaying.show(musicCredit('desperado_club_3'));
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
        toasts.post('Mongo recovering −3.6s', { tone: 'info', icon: 'hourglass' });
        toasts.post('The boxers are already doing their job — just equip them!', {
          tone: 'warning',
        });
      }
      for (let tick = 0; tick < FIXTURE_TOAST_TICKS; tick++) {
        toasts.update();
        nowPlaying.update();
        captions.update();
      }
      const model = (): HudModel => ({
        crawlers: crawlers(spec.status, spec.skillPoints, spec.companionStatus ?? []),
        activeCrawler: 'human',
        coins: { shown: 1240, split: 'Carl 900 · Donut 340', pulse: 0 },
        skillPoints: { hidden: false, nag: spec.skillPoints > 0, open: record },
        minimap: {
          expanded: spec.expanded,
          hint: spec.expanded ? 'M: collapse | drag to scroll' : 'M: expand',
          paint: paintMap,
          toggle: record,
        },
        dock: dock(spec.dockExtras),
        summon: {
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
            drawMongoIcon(
              ctx,
              SUMMON_PORTRAIT_STAGE,
              rect.x + rect.w / 2,
              rect.y + rect.h / 2,
              Math.min(rect.w, rect.h),
            ),
          onTap: record,
        },
        lootBanner: spec.lootBanner
          ? { glyph: 'sparkle', title: 'Open loot!', detail: '2 boxes', onTap: record }
          : null,
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
function bugabooEntry(): TopBandEntry {
  return stackedBandEntry({
    id: 'defend-status',
    priority: 'encounter',
    accentTone: 'warning',
    rows: [
      { kind: 'text', text: 'BUGABOOS INCOMING', role: 'title', tone: 'warning' },
      {
        kind: 'text',
        text: `Bugaboos in ${BUGABOO_SECONDS_LEFT}s — board up the grates`,
        role: 'label',
        tabular: true,
        maxLines: 2,
      },
      {
        kind: 'meter',
        id: 'defend-status/time',
        value: BUGABOO_APPROACH_FRACTION,
        max: 1,
        meterKind: 'progress',
      },
      { kind: 'text', text: `Grates 0/${GRATE_COUNT}`, role: 'caption', tone: 'muted' },
    ],
  });
}

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
    lootBanner: false,
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

export const HUD_FIXTURES: readonly DialogFixture[] = [
  hudFixture({
    name: 'quiet',
    status: [],
    skillPoints: 2,
    dockExtras: ['chip'],
    topBand: () => [],
    lootBanner: false,
    toasts: 'mixed',
    expanded: false,
  }),
  hudFixture({
    name: 'fight',
    status: FIGHT_STATUS,
    skillPoints: 0,
    dockExtras: ['build'],
    topBand: () => [
      bossEntry(),
      encounterEntry(),
      doomsdayCountdownEntry({
        id: 'doomsday',
        label: CONTAINMENT_LABEL,
        deadlineAt: Date.now() + DOOMSDAY_MS_LEFT,
        objective: DOOMSDAY_CONTAIN_OBJECTIVE,
      }),
    ],
    levelTimerFrames: LATE_TIMER_FRAMES,
    lootBanner: false,
    toasts: 'none',
    expanded: false,
  }),
  hudFixture({
    name: 'grate-defence',
    status: [],
    companionStatus: COMPANION_ROACH_STATUS,
    skillPoints: 0,
    dockExtras: ['build'],
    topBand: () => [bugabooEntry(), reviveEntry()],
    levelTimerFrames: EARLY_TIMER_FRAMES,
    lootBanner: false,
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
        title: 'THE BIG TOP AWAITS',
        subtitle: 'Find the ringmaster',
        framesLeft: QUEST_BANNER_FRAMES,
        tone: 'success',
      });
      return banner === null ? [] : [banner];
    },
    lootBanner: true,
    toasts: 'none',
    expanded: true,
  }),
  hudFixture({
    name: 'saving',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    lootBanner: false,
    toasts: 'saving',
    expanded: false,
  }),
  hudFixture({
    name: 'loot-seal',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    lootBanner: false,
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
      lootBanner: false,
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
        title: 'THE BIG TOP AWAITS',
        subtitle: 'Find the ringmaster',
        framesLeft: QUEST_BANNER_FRAMES,
        tone: 'success',
      });
      return banner === null ? [] : [banner];
    },
    lootBanner: true,
    toasts: 'clubArrival',
    expanded: false,
  }),
  hudFixture({
    name: 'sound-captions',
    status: [],
    skillPoints: 0,
    dockExtras: [],
    topBand: () => [],
    lootBanner: false,
    toasts: 'captions',
    expanded: false,
  }),
  hotbarTooltipOverMenu(),
];
