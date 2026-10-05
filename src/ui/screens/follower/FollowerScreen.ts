/**
 * The companion's orders: how it moves, how it fights, whether the cat sends
 * Mongo in, and the switch to playing it. Each order is a radio-style row;
 * choosing one keeps the panel open so the player can set both at once. Only
 * ✕, Close, a tap outside, Escape, the Follow key and switching character
 * dismiss it.
 */

import { keybindings } from '../../../core/Keybindings';
import type { CombatStance, MovementMode } from '../../../systems/CompanionSystem';
import { centerIn, intersect, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { drawGlyph, type GlyphId } from '../../theme/glyphs';
import { listRow, listRowHeight } from '../../widgets/listRow';
import { panel, type FooterButton } from '../../widgets/panel';
import { scrollIntoView } from '../../widgets/scrollView';
import { lineHeightOf, measureText, text } from '../../widgets/text';

/** What the panel shows, read from the scene's companion state every frame. */
export interface FollowerMenuState {
  readonly movementMode: MovementMode;
  readonly combatStance: CombatStance;
  /** True when the human is the active player, so the cat is the companion. */
  readonly companionIsCat: boolean;
  /**
   * Whether the cat sends Mongo in on her own, or null to leave the row out:
   * no pet yet, or a scene he cannot be summoned in.
   */
  readonly mongoAutoSummon: boolean | null;
}

export interface FollowerScreenSurfaceOptions {
  readonly id?: string;
  /** Whether the scene stops while it is up. */
  readonly haltsWorld: boolean;
  readonly state: () => FollowerMenuState;
  /** The one row a tutorial allows, by index, or null for all of them. */
  readonly restriction?: () => number | null;
}

type RowControl = 'radio' | 'toggle';

interface OrderRow {
  readonly glyph: GlyphId;
  readonly label: string;
  readonly control: RowControl;
  readonly checked: boolean;
  /** Stable index a tutorial restriction names a row by. */
  readonly idx: number;
  readonly callback: (() => void) | null;
}

interface OrderSection {
  readonly header: string;
  readonly rows: readonly OrderRow[];
}

/** A band of the scrolling body, measured from the content's top. */
interface ContentSpan {
  readonly top: number;
  readonly bottom: number;
}

const PANEL_ID = 'follower';
const BODY_SCROLL_ID = `${PANEL_ID}/body`;
/**
 * A finger may wander this far, in canvas CSS pixels, and still tap a row;
 * past it the press scrolls the list. Wider than the default slop, since the
 * rows are tall and a thumb drifts.
 */
const FOLLOWER_TAP_SLOP_PX = 20;
/**
 * Row index of the pet toggle. Past the four orders so a tutorial restriction,
 * which names a row by index, never lands on it by accident.
 */
const PET_TOGGLE_ROW_INDEX = 4;
const FOLLOW_ME_ROW_INDEX = 0;
const DO_NOT_MOVE_ROW_INDEX = 1;
const AGGRESSIVE_ROW_INDEX = 2;
const PASSIVE_ROW_INDEX = 3;
/** Shown on every row a tutorial step has closed off. */
const RESTRICTED_REASON = 'Follow the tutorial for now';
const TOGGLE_ON = 'On';
const TOGGLE_OFF = 'Off';

export class FollowerScreen {
  private _isOpen = false;
  /** The visible part of the "Follow me" row in canvas CSS pixels, for the tutorial's pointer. */
  private followMeRect: Rect | null = null;

  onFollowMe: (() => void) | null = null;
  onDoNotMove: (() => void) | null = null;
  onSetAggressive: (() => void) | null = null;
  onSetPassive: (() => void) | null = null;
  onSwitchCharacter: (() => void) | null = null;
  onToggleMongoAutoSummon: (() => void) | null = null;

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Canvas CSS-pixel rect of the "Follow me" row's visible part, or null while it is closed or scrolled out of view. */
  get followMeButtonRect(): Rect | null {
    return this._isOpen ? this.followMeRect : null;
  }

  open(): void {
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this.followMeRect = null;
  }

  /**
   * The panel as a surface. It locks the keyboard, a tap outside closes it,
   * it scrolls under a dragged finger or the wheel, and it closes on Escape
   * or on the Follow key that opened it.
   */
  surface(opts: FollowerScreenSurfaceOptions): Surface {
    return {
      id: opts.id ?? 'follower-menu',
      band: 'modal',
      haltsWorld: opts.haltsWorld,
      locksKeyboard: true,
      isOpen: () => this._isOpen,
      close: () => this.close(),
      onKey: (key, mods) => {
        if (keybindings.actionFor(key) !== 'companionFollow') return false;
        if (mods.repeat !== true) this.close();
        return true;
      },
      render: (ui) => this.render(ui, opts.state(), opts.restriction?.() ?? null),
    };
  }

  private sections(state: FollowerMenuState): OrderSection[] {
    const sections: OrderSection[] = [
      {
        header: 'Movement',
        rows: [
          {
            glyph: 'users',
            label: 'Follow me',
            control: 'radio',
            checked: state.movementMode === 'follow',
            idx: FOLLOW_ME_ROW_INDEX,
            callback: this.onFollowMe,
          },
          {
            glyph: 'anchor',
            label: 'Do not move',
            control: 'radio',
            checked: state.movementMode === 'anchored',
            idx: DO_NOT_MOVE_ROW_INDEX,
            callback: this.onDoNotMove,
          },
        ],
      },
      {
        header: 'Combat stance',
        rows: [
          {
            glyph: 'swords',
            label: 'Aggressive',
            control: 'radio',
            checked: state.combatStance === 'aggressive',
            idx: AGGRESSIVE_ROW_INDEX,
            callback: this.onSetAggressive,
          },
          {
            glyph: 'shield',
            label: 'Passive',
            control: 'radio',
            checked: state.combatStance === 'passive',
            idx: PASSIVE_ROW_INDEX,
            callback: this.onSetPassive,
          },
        ],
      },
    ];
    if (state.companionIsCat && state.mongoAutoSummon !== null) {
      sections.push({
        header: 'Pet',
        rows: [
          {
            glyph: 'heart',
            label: 'Summon Mongo in fights',
            control: 'toggle',
            checked: state.mongoAutoSummon,
            idx: PET_TOGGLE_ROW_INDEX,
            callback: this.onToggleMongoAutoSummon,
          },
        ],
      });
    }
    return sections;
  }

  private render(ui: Ui, state: FollowerMenuState, restriction: number | null): void {
    const { space } = ui.theme;
    const sections = this.sections(state);
    const rowH = listRowHeight(ui, false);
    const headerH = lineHeightOf(ui, 'overline');
    const sectionH = (section: OrderSection): number =>
      headerH + space.xs + section.rows.length * rowH + (section.rows.length - 1) * space.xs;
    const contentHeight =
      sections.reduce((sum, section) => sum + sectionH(section) + space.lg, 0) + rowH;
    const dragSlop = FOLLOWER_TAP_SLOP_PX / ui.uiScale;
    const footer: FooterButton[] = [
      {
        id: 'done',
        label: ui.density === 'touch' ? 'Close' : 'Close [Esc]',
        variant: 'primary',
        primary: true,
        onTap: () => this.close(),
      },
    ];
    const layout: { followMe: Rect | null; focused: ContentSpan | null } = {
      followMe: null,
      focused: null,
    };

    const p = panel(ui, {
      id: PANEL_ID,
      title: state.companionIsCat ? 'Cat Companion' : 'Human Companion',
      width: 'sm',
      height: 'content',
      contentHeight,
      scrollBody: true,
      onClose: () => this.close(),
      onScrimTap: () => this.close(),
      footer,
      content: (content) => {
        let y = content.y;
        const place = (h: number): Rect => {
          const rect: Rect = { x: content.x, y, w: content.w, h };
          y += h;
          return rect;
        };
        for (const section of sections) {
          text(ui, place(headerH), { text: section.header, role: 'overline' });
          y += space.xs;
          section.rows.forEach((row, index) => {
            if (index > 0) y += space.xs;
            const rect = place(rowH);
            const focused = this.orderRow(ui, rect, row, restriction, dragSlop);
            if (row.idx === FOLLOW_ME_ROW_INDEX) layout.followMe = rect;
            if (focused)
              layout.focused = { top: rect.y - content.y, bottom: rect.y + rect.h - content.y };
          });
          y += space.lg;
        }
        const switchRect = place(rowH);
        const switchFocused = this.switchRow(ui, switchRect, state, restriction, dragSlop);
        if (switchFocused) {
          layout.focused = {
            top: switchRect.y - content.y,
            bottom: switchRect.y + switchRect.h - content.y,
          };
        }
      },
    });

    const focused = layout.focused;
    if (focused !== null) scrollIntoView(ui, BODY_SCROLL_ID, focused.top, focused.bottom, p.body.h);
    const followMe = layout.followMe;
    const visibleFollowMe = followMe === null ? null : intersect(followMe, p.body);
    this.followMeRect =
      visibleFollowMe === null
        ? null
        : {
            x: visibleFollowMe.x * ui.uiScale,
            y: visibleFollowMe.y * ui.uiScale,
            w: visibleFollowMe.w * ui.uiScale,
            h: visibleFollowMe.h * ui.uiScale,
          };
  }

  /** Draws one order row. Returns whether it holds keyboard focus. */
  private orderRow(
    ui: Ui,
    rect: Rect,
    row: OrderRow,
    restriction: number | null,
    dragSlop: number,
  ): boolean {
    const restricted = restriction !== null && row.idx !== restriction;
    const callback = row.callback;
    const toggleLabel = row.checked ? TOGGLE_ON : TOGGLE_OFF;
    const state = listRow(ui, rect, {
      id: `order-${row.idx}`,
      title: row.label,
      leading: {
        kind: 'glyph',
        glyph: row.glyph,
        color: row.checked ? ui.theme.palette.accent.base : undefined,
      },
      selected: row.checked,
      disabled: restricted ? RESTRICTED_REASON : false,
      dragSlop,
      trailingWidth:
        row.control === 'toggle'
          ? measureText(ui, toggleLabel, { role: 'label' })
          : ui.theme.size.icon,
      trailingContent: (trailing) => {
        if (row.control === 'toggle') {
          text(ui, trailing, {
            text: toggleLabel,
            role: 'label',
            color: row.checked ? ui.theme.palette.state.success : ui.theme.palette.text.muted,
            align: 'right',
          });
          return;
        }
        if (!row.checked) return;
        const side = ui.theme.size.icon;
        drawGlyph(ui.ctx, 'check', centerIn(trailing, side, side), {
          color: ui.theme.palette.accent.base,
        });
      },
      onTap: () => callback?.(),
    });
    return state.focused;
  }

  /** The one row that closes the panel, since the view it configures is about to change hands. */
  private switchRow(
    ui: Ui,
    rect: Rect,
    state: FollowerMenuState,
    restriction: number | null,
    dragSlop: number,
  ): boolean {
    const otherPlayableCharacter = state.companionIsCat ? 'Cat' : 'Human';
    const result = listRow(ui, rect, {
      id: 'switch',
      title: `Switch to ${otherPlayableCharacter}`,
      leading: { kind: 'glyph', glyph: 'swap', color: ui.theme.palette.accent.base },
      accent: ui.theme.palette.accent.base,
      disabled: restriction !== null ? RESTRICTED_REASON : false,
      dragSlop,
      onTap: () => {
        this.close();
        this.onSwitchCharacter?.();
      },
    });
    return result.focused;
  }
}
