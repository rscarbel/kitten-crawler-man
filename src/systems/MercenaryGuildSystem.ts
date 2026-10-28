import type { Player } from '../Player';
import { canAffordCoins, partyCoins, spendPartyCoins } from '../core/party/partyCoins';
import type { AudioManager } from '../audio/AudioManager';
import type { MercenaryRoster } from '../core/party/MercenaryRoster';
import {
  MERCENARY_TEMPLATES,
  getMercenaryTemplate,
  type MercenaryTemplate,
  type MercenaryTemplateId,
} from '../core/party/mercenaryTemplates';
import { MERCENARY_ART } from '../sprites/mercenaryArt';
import { selectCardinalFacing, selectFacing } from '../sprites/facingView';
import {
  drawCrocodilianSprite,
  prewarmSydney,
  sydneyPortraitRow,
} from '../sprites/crocodilianSprite';
import { figureRowInkTop } from '../sprites/figure/figureFrameCache';
import { activeRunStats } from '../core/progression/GameStats';
import { ConfirmDialog } from '../ui/screens/dialogs/ConfirmDialog';
import type { Rect } from '../ui/core/geom';

/** The largest a portrait tile is drawn: a short hire stops growing before it turns to mush. */
const PORTRAIT_MAX_TILE = 84;
/** Breathing room between the figure and its frame, top and bottom. */
const PORTRAIT_MARGIN = 6;
/** Every figure stands on a line this far down its tile. */
const FIGURE_FEET_IN_TILE = 0.95;
/** Sydney's tile in the speech strip: her head and shoulders fill it, the rest is cropped. */
const SPEECH_PORTRAIT_TILE = 56;
/** The desk's idle clock runs in game ticks, like every hireling's own. */
const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
/** She faces the customer across the desk. */
const MANAGER_FACING_X = 0;
const MANAGER_FACING_Y = 1;
/** A hire on file faces out of its portrait, at whoever is reading it. */
const PORTRAIT_FACING_X = 0;
const PORTRAIT_FACING_Y = 1;

// Sydney's voice. She ran a garrison's stores before she ran this desk, and
// she runs it the same way: by the form, without raising her voice.
export const MERCENARY_DESK_TITLE = 'The Barracks Mercenaries';
export const MERCENARY_DESK_SUBTITLE = 'Sydney runs the desk by the book. She wrote the book.';
const GREETING = '"Contracts run to the end of the floor or the end of the hire. Pick a file."';
const NOT_ENOUGH_COINS = '"The fee is paid up front, in full. Come back when it is."';
const CONTRACT_ACTIVE =
  '"One contract per party. Bring yours back, or tear it up here, and we start again."';
const NO_FLOOR = '"I can only sign for the floor you\'re standing on."';
const hireSuccess = (name: string): string =>
  `"${name} is signed out to you, to the end of the floor or of them. Reporting to you now."`;
const dismissed = (name: string): string =>
  `"${name} goes back on the board. The fee was non-refundable. It says so on the form."`;
const DISMISS_CONFIRM_TITLE = 'Dismiss Contract';
const KEEP_LABEL = 'Keep them';
const TEAR_UP_LABEL = 'Tear it up';
const confirmDismissal = (name: string): string =>
  `"Tear up ${name}'s contract? The fee stays with the desk either way."`;
const condolences = (name: string): string =>
  `"${name} is marked lost on the board. The contract was paid through the floor. I'm sorry for it."`;

/** The only part of a crawler the desk reads or writes. */
type Purse = Pick<Player, 'coins'>;

/** One line of the desk's list, as the desk screen draws it. */
export interface MercenaryDeskEntry {
  readonly template: MercenaryTemplate;
  readonly underContract: boolean;
  /** Sydney's reason not to sign this hire now, or null when she will. */
  readonly hireRefusal: string | null;
  /** Why the Hire button is dimmed, in the player's terms, or null. */
  readonly hireNote: string | null;
}

export interface MercenaryDeskView {
  readonly entries: readonly MercenaryDeskEntry[];
  readonly selected: number;
  /** What Sydney is saying. */
  readonly line: string;
  readonly coins: number;
}

/**
 * The Barracks Mercenaries' hire desk: a list of hires down the left, the
 * selected one's portrait, stats and sales pitch on the right, and Sydney, who
 * keeps the desk, underneath saying whatever she has to say about it.
 *
 * Which building keeps the desk is not this class's business: a room hosts it
 * by giving one of its occupants the `mercenary_guild` desk service.
 *
 * Signing a contract deducts coins and records it on the persisted
 * {@link MercenaryRoster}, which the overworld `MercenarySystem` reads to spawn
 * the ally. One contract at a time, and the desk is the only place one can be
 * torn up.
 *
 * A row never spends coins, whoever presses it. Dismissing asks first, in
 * {@link MercenaryGuildSystem.dismissConfirm}, whose default answer keeps them.
 */
export class MercenaryGuildSystem {
  open = false;

  /** Set when a contract is signed; the host clears it after firing the first-hire achievement. */
  hirePending = false;

  /** "Tear up the contract?", asked over the desk; mount its surface above the desk's. */
  readonly dismissConfirm: ConfirmDialog;

  private selected = 0;
  private managerLine = GREETING;

  constructor(
    private readonly roster: MercenaryRoster,
    private readonly audio: AudioManager | null,
  ) {
    this.dismissConfirm = new ConfirmDialog(audio);
    prewarmSydney();
  }

  openPanel(): void {
    this.open = true;
    this.dismissConfirm.close();
    const active = this.roster.active;
    const activeIndex =
      active === null ? -1 : MERCENARY_TEMPLATES.findIndex((t) => t.id === active.id);
    this.selected = Math.max(0, activeIndex);
    // Said once: cleared on the live roster, which every later save and
    // checkpoint captures, so only rewinding to before this visit repeats it.
    const deceased = this.roster.lastDeceased;
    this.roster.lastDeceased = null;
    this.managerLine = deceased === null ? GREETING : condolences(deceased);
    this.audio?.play('typing_click');
  }

  close(): void {
    this.open = false;
    this.dismissConfirm.close();
  }

  private say(line: string): void {
    this.managerLine = line;
  }

  /** Sydney's reason not to sign `template` right now, or null when she will. */
  private hireRefusal(template: MercenaryTemplate, player: Purse, companion: Purse): string | null {
    // Only a harness builds the desk with no floor under it; a contract with
    // no floor to run to would never end.
    if (this.roster.floorLevelId === null) return NO_FLOOR;
    if (this.roster.active !== null) return CONTRACT_ACTIVE;
    if (!canAffordCoins(player, companion, template.price)) return NOT_ENOUGH_COINS;
    return null;
  }

  private hire(id: MercenaryTemplateId, player: Purse, companion: Purse): void {
    const template = getMercenaryTemplate(id);
    const refusal = this.hireRefusal(template, player, companion);
    const contractLevelId = this.roster.floorLevelId;
    if (refusal !== null || contractLevelId === null) {
      this.say(refusal ?? NO_FLOOR);
      this.audio?.play('error');
      return;
    }
    spendPartyCoins(player, companion, template.price, player);
    activeRunStats()?.recordHirelingHired();
    // Warmed on the signature rather than on the first frame the hire is
    // drawn: it steps away from the desk already moving.
    MERCENARY_ART[template.art].prewarm();
    this.roster.active = {
      id: template.id,
      name: template.name,
      contractLevelId,
      introduced: false,
    };
    this.hirePending = true;
    this.say(hireSuccess(template.name));
    this.audio?.play('purchase_success');
  }

  private dismiss(): void {
    if (this.roster.active === null) return;
    const name = this.roster.active.name;
    this.roster.active = null;
    this.say(dismissed(name));
    this.audio?.play('menu_click');
  }

  /**
   * A press on the selected row: Sydney says why it cannot be signed, if
   * it cannot. Never signs anything.
   */
  private activateEntry(index: number, player: Purse, companion: Purse): void {
    const template = MERCENARY_TEMPLATES[index];
    const underContract = this.roster.active?.id === template.id;
    const refusal = underContract ? null : this.hireRefusal(template, player, companion);
    if (refusal !== null) {
      this.say(refusal);
      this.audio?.play('error');
    }
  }

  private select(index: number): void {
    if (index === this.selected) return;
    this.selected = index;
  }

  /** Everything the desk screen draws, read fresh each frame. */
  deskView(player: Purse, companion: Purse): MercenaryDeskView {
    const active = this.roster.active;
    const entries = MERCENARY_TEMPLATES.map((template): MercenaryDeskEntry => ({
      template,
      underContract: active?.id === template.id,
      hireRefusal: this.hireRefusal(template, player, companion),
      hireNote: this.hireNote(template, player, companion),
    }));
    return {
      entries,
      selected: this.selected,
      line: this.managerLine,
      coins: partyCoins(player, companion),
    };
  }

  /** A press on a row: a different row is selected; the selected row hears from Sydney whether it can be signed. */
  pressRow(index: number, player: Purse, companion: Purse): void {
    if (index < 0 || index >= MERCENARY_TEMPLATES.length) return;
    if (index === this.selected) this.activateEntry(index, player, companion);
    else this.select(index);
  }

  /** Signs `id`, refused, charged and announced by the same rules as the Hire button. */
  pressHire(id: MercenaryTemplateId, player: Purse, companion: Purse): void {
    this.hire(id, player, companion);
  }

  /** Dismiss Contract: asks first, and keeping them is the answer a stray accept press gives. */
  askDismiss(): void {
    const active = this.roster.active;
    if (active === null) return;
    const question = confirmDismissal(active.name);
    this.say(question);
    this.audio?.play('typing_click');
    this.dismissConfirm.open({
      title: DISMISS_CONFIRM_TITLE,
      message: question,
      yesLabel: TEAR_UP_LABEL,
      noLabel: KEEP_LABEL,
      onYes: () => this.tearUpContract(),
      onNo: () => this.keepContract(),
    });
  }

  keepContract(): void {
    this.dismissConfirm.close();
    this.say(GREETING);
  }

  tearUpContract(): void {
    this.dismissConfirm.close();
    this.dismiss();
  }

  /** Draws a hire standing in `frame`, idling on the desk's clock. */
  drawHirePortrait(ctx: CanvasRenderingContext2D, id: MercenaryTemplateId, frame: Rect): void {
    this.renderPortrait(ctx, getMercenaryTemplate(id), frame);
  }

  /** Draws Sydney's head and shoulders, her crown just inside the top of `frame`. */
  drawManager(ctx: CanvasRenderingContext2D, frame: Rect): void {
    const tile = SPEECH_PORTRAIT_TILE;
    const sx = frame.x + (frame.w - tile) / 2;
    const crownAboveTileTop = -figureRowInkTop(sydneyPortraitRow(), 0, tile);
    const sy = frame.y + PORTRAIT_MARGIN + crownAboveTileTop;
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    drawCrocodilianSprite(ctx, sx, sy, tile, {
      variant: 'sydney',
      row: 'idle',
      facingX: MANAGER_FACING_X,
      facingY: MANAGER_FACING_Y,
    });
    ctx.restore();
  }

  /** Why the Hire button is dimmed, or null when it isn't. */
  private hireNote(template: MercenaryTemplate, player: Purse, companion: Purse): string | null {
    const active = this.roster.active;
    if (active !== null && active.id !== template.id) {
      return `${active.name} holds your contract. Dismiss them first.`;
    }
    if (active === null && !canAffordCoins(player, companion, template.price)) {
      return `You're ${template.price - partyCoins(player, companion)} coins short.`;
    }
    return null;
  }

  /** The hire standing in its frame, playing its idle on the desk's clock. */
  private renderPortrait(
    ctx: CanvasRenderingContext2D,
    template: MercenaryTemplate,
    frame: Rect,
  ): void {
    const art = MERCENARY_ART[template.art];
    // Sized by the figure's own height, so a golem two tiles tall and a
    // human barely one both stand head-to-foot in the same frame.
    const figureTiles = art.headLiftTiles + FIGURE_FEET_IN_TILE;
    const usableH = frame.h - PORTRAIT_MARGIN * 2;
    const tile = Math.min(PORTRAIT_MAX_TILE, usableH / figureTiles);
    const sx = frame.x + (frame.w - tile) / 2;
    const feetY = frame.y + frame.h - PORTRAIT_MARGIN;
    const sy = feetY - tile * FIGURE_FEET_IN_TILE;
    // Clipped because a figure's ink runs past its tile — a golem's head, a
    // planted staff — and the frame is the edge of the picture.
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    art.draw(ctx, sx, sy, tile, {
      state: { row: 'idle', progress: 0 },
      walkFrame: 0,
      isMoving: false,
      facing: selectFacing(PORTRAIT_FACING_X, PORTRAIT_FACING_Y),
      cardinalFacing: selectCardinalFacing(PORTRAIT_FACING_X, PORTRAIT_FACING_Y),
      facingX: PORTRAIT_FACING_X,
      clock: (performance.now() / MS_PER_SECOND) * TICKS_PER_SECOND,
    });
    ctx.restore();
  }
}
