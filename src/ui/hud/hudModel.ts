/**
 * What the HUD shows, built by a scene each frame and handed to the
 * `HudSurface`. The surface owns where things go and how they look; the model
 * owns what they say and what a tap does.
 */

import type { SoundId } from '../../audio/sounds';
import type { InventoryItem } from '../../core/ItemDefs';
import type { Rect } from '../core/geom';
import type { GlyphId } from '../theme/glyphs';
import type { TopBandEntry } from './topBand';

export type CrawlerId = 'human' | 'cat';

/** One timed or standing effect on a crawler, shown as a pill under its frame. */
export interface StatusPillModel {
  readonly id: string;
  readonly label: string;
  /** Game data: the effect's own identity colour. */
  readonly color: string;
  /** Fraction of the effect still to run, for the radial timer; null for a standing effect. */
  readonly remaining: number | null;
  readonly harmful: boolean;
  /** A standing capability that is currently spent (Cockroach recharging): drawn muted. */
  readonly spent?: boolean;
}

export interface UnitFrameModel {
  readonly id: CrawlerId;
  readonly name: string;
  readonly glyph: GlyphId;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly xp: number;
  readonly xpMax: number;
  readonly status: readonly StatusPillModel[];
  /** Unspent skill points; a `+N` badge on the level disc while above zero. */
  readonly skillPoints: number;
}

export interface CoinModel {
  /** What the pill reads: the party's purse minus coins still in flight to it. */
  readonly shown: number;
  /** The split between crawlers, shown while the pill is hovered. */
  readonly split: string;
  /** 0 (settled) to 1 (a coin just landed): the pill swells briefly. */
  readonly pulse: number;
}

export interface SkillPointsModel {
  /** The nag's badge is held back (a fight is on). */
  readonly hidden: boolean;
  /** Unspent long enough to nag: the badge pulses harder. */
  readonly nag: boolean;
  /** Opens the Spend section of the Character screen. */
  open(): void;
}

export interface MinimapModel {
  readonly expanded: boolean;
  /** What tapping the map or its corner glyph does, shown as the glyph's tooltip. */
  readonly hint: string;
  /** Paints the map's data into `rect`, already clipped to the frame. */
  paint(ctx: CanvasRenderingContext2D, rect: Rect): void;
  toggle(): void;
  /** Pans an expanded map by a drag delta in UI units; absent where the map cannot pan. */
  readonly pan?: (dx: number, dy: number) => void;
}

export type DockButtonId = 'pause' | 'bag' | 'build' | 'chip' | 'journal' | 'follower' | 'switch';

export interface DockButtonModel {
  readonly id: DockButtonId;
  readonly icon: GlyphId;
  /** Its tooltip. */
  readonly label: string;
  /** The keyboard key that does the same, shown in the corner on a pointer screen. */
  readonly key?: string;
  /** A count or tag pinned to its corner. */
  readonly badge?: string;
  readonly selected?: boolean;
  /** Draws attention: a pulsing accent ring. */
  readonly pulse?: boolean;
  /** 0 to 1: a squash-bounce as something lands in it. */
  readonly bounce?: number;
  readonly sound?: SoundId | null;
  onTap(): void;
}

/** Mongo's Summon card. */
export interface SummonModel {
  readonly label: string;
  readonly active: boolean;
  /** A press would do something right now. */
  readonly usable: boolean;
  /** He is fit to send in (or already out): his health bar reads ready. */
  readonly ready: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly xpFraction: number;
  /** Fraction of his recovery still to run, 0 when none. */
  readonly cooldown: number;
  readonly cooldownSeconds: number;
  paintIcon(ctx: CanvasRenderingContext2D, rect: Rect): void;
  onTap(): void;
}

/** The safe room's left-edge banner: unread achievements, or loot boxes to open. */
export interface LootBannerModel {
  readonly glyph: GlyphId;
  readonly title: string;
  readonly detail: string;
  onTap(): void;
}

export interface HotbarSlotModel {
  readonly item: InventoryItem | null;
  /** Worn or wielded: reads as in hand, not as a consumable. */
  readonly equipped: boolean;
  /** Fraction of a cooldown still to run, 0 when ready. */
  readonly cooldown: number;
  /** The wait left, as the slot reads it over the sweep. */
  readonly cooldownLabel: string;
  /** The bag holds an upgrade for this item the player has not looked at. */
  readonly unseen: boolean;
}

/**
 * What a press on a hotbar slot does. A slot fires the moment it is pressed;
 * the press's end matters only to a slot that charges while held (dynamite).
 */
export interface HotbarInput {
  press(index: number): void;
  /** The press on slot `index` ended, released or cancelled. */
  release(index: number): void;
}

export interface HotbarModel {
  readonly slots: readonly HotbarSlotModel[];
  readonly input: HotbarInput;
}

export interface HudModel {
  /** Active crawler first. */
  readonly crawlers: readonly [UnitFrameModel, UnitFrameModel];
  readonly activeCrawler: CrawlerId;
  readonly coins: CoinModel;
  readonly skillPoints: SkillPointsModel;
  readonly minimap: MinimapModel | null;
  /** In column order; a button missing here is simply not shown. */
  readonly dock: readonly DockButtonModel[];
  readonly summon: SummonModel | null;
  readonly lootBanner: LootBannerModel | null;
  /** Null while a scene's own menu stands over the bar. */
  readonly hotbar: HotbarModel | null;
  readonly topBand: readonly TopBandEntry[];
}

/**
 * The HUD's one view toggle that decides where its buttons stand — the
 * minimap expanded — carried by reference through a door, into the building
 * and back out, so walking through one never flips it.
 */
export interface HudViewState {
  miniMapExpanded: boolean;
}
