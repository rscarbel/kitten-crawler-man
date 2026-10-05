import type { Player } from '../Player';
import { canAffordCoins, partyCoins, spendPartyCoins } from '../core/partyCoins';
import type { AudioManager } from '../audio/AudioManager';
import type { MercenaryRoster } from '../core/MercenaryRoster';
import { CLUB_MERC_DESK_TILE } from '../core/clubLayout';
import {
  MERCENARY_TEMPLATES,
  getMercenaryTemplate,
  type MercenaryTemplate,
  type MercenaryTemplateId,
} from '../core/mercenaryTemplates';
import { MERCENARY_ART } from '../sprites/mercenaryArt';
import { drawRosemariePortrait, prewarmRosemarie } from '../sprites/rosemarieSprite';
import { GROUND_OFFSET_IN_TILE as ROSEMARIE_GROUND_IN_TILE } from '../sprites/art/rosemarieFigure';
import { activeRunStats } from '../core/GameStats';
import { ConfirmDialog } from '../ui/screens/dialogs/ConfirmDialog';
import type { Rect } from '../ui/core/geom';
import { RosemarieDeskIdle } from './RosemarieDeskIdle';

/** The largest a portrait tile is drawn: a short hire stops growing before it turns to mush. */
const PORTRAIT_MAX_TILE = 84;
/** Breathing room between the figure and its frame, top and bottom. */
const PORTRAIT_MARGIN = 6;
/** Every figure stands on a line this far down its tile. */
const FIGURE_FEET_IN_TILE = 0.95;
/** She is short even for a dwarf: a tile this size fills the strip without her hat touching the top. */
const SPEECH_PORTRAIT_TILE = 56;

// Rosemarie's voice. She is an old dwarf who sells people for a living, and
// she has made her peace with where most of them end up.
export const MERCENARY_DESK_TITLE = 'Meat Shields: Mercenaries for Hire';
export const MERCENARY_DESK_SUBTITLE = 'Rosemarie peers over the desk. Bernie the mole peers too.';
const GREETING = '"Pick one, sweetheart. They all bleed. Some just take longer about it."';
const NOT_ENOUGH_COINS = '"Come back when your purse is heavier than my mole."';
const CONTRACT_ACTIVE =
  '"One at a time, sweetheart. Bring the last one back and I\'ll tear it up."';
const NO_FLOOR = '"Can\'t sign you up for a floor you ain\'t standing on."';
const DAMASCUS_REFUSAL =
  "\"Damascus? He's on my books, but he don't sign for crawlers. Don't ask him twice.\"";
const hireSuccess = (name: string): string =>
  `"${name}'s yours till the floor's done or they are. No refunds on either. They're waiting out front."`;
const dismissed = (name: string): string =>
  `"${name} goes back on the shelf. Only place you can do that is here, mind. Nice doing business."`;
const DISMISS_CONFIRM_TITLE = 'Dismiss Contract';
const KEEP_LABEL = 'Keep them';
const TEAR_UP_LABEL = 'Tear it up';
const confirmDismissal = (name: string): string =>
  `"Tear up ${name}'s paper? Fee stays in my apron either way, sweetheart. Your call."`;
const condolences = (name: string): string =>
  `"Heard about ${name}. Contract's paid through the floor all the same. That's the business."`;

/** Damascus Steel is on Meat Shields' books but will not be hired, so his entry is a refusal, not a card. */
const DAMASCUS = {
  name: 'Damascus Steel',
  species: 'Ifrit',
  role: 'Dancer',
} as const;

type DeskEntry = { kind: 'hire'; template: MercenaryTemplate } | { kind: 'refusal' };

/** The hires in price order, and Damascus at the foot of the list where nobody can buy him. */
const DESK_ENTRIES: readonly DeskEntry[] = [
  ...MERCENARY_TEMPLATES.map((template): DeskEntry => ({ kind: 'hire', template })),
  { kind: 'refusal' },
];

/** The only part of a crawler the desk reads or writes. */
type Purse = Pick<Player, 'coins'>;

/** One line of the desk's list, as the desk screen draws it. */
export type MercenaryDeskEntry =
  | {
      readonly kind: 'hire';
      readonly template: MercenaryTemplate;
      readonly underContract: boolean;
      /** Rosemarie's reason not to sign this hire now, or null when she will. */
      readonly hireRefusal: string | null;
      /** Why the Hire button is dimmed, in the player's terms, or null. */
      readonly hireNote: string | null;
    }
  | {
      readonly kind: 'refusal';
      readonly name: string;
      readonly species: string;
      readonly role: string;
      /** What Rosemarie says about him. */
      readonly pitch: string;
    };

export interface MercenaryDeskView {
  readonly entries: readonly MercenaryDeskEntry[];
  readonly selected: number;
  /** What Rosemarie is saying. */
  readonly line: string;
  readonly coins: number;
}

/**
 * Rosemarie's "Meat Shields" desk in the Desperado Club: a list of hires down
 * the left, the selected one's portrait, stats and sales pitch on the right,
 * and Rosemarie herself underneath saying whatever she has to say about it.
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
  private rosemarieLine = GREETING;
  private readonly desk = new RosemarieDeskIdle(CLUB_MERC_DESK_TILE);

  constructor(
    private readonly roster: MercenaryRoster,
    private readonly audio: AudioManager | null,
  ) {
    this.dismissConfirm = new ConfirmDialog(audio);
    prewarmRosemarie();
  }

  openPanel(): void {
    this.open = true;
    this.dismissConfirm.close();
    prewarmRosemarie({ portrait: true });
    const active = this.roster.active;
    const activeIndex =
      active === null
        ? -1
        : DESK_ENTRIES.findIndex((e) => e.kind === 'hire' && e.template.id === active.id);
    this.selected = Math.max(0, activeIndex);
    // Said once: cleared on the live roster, which every later save and
    // checkpoint captures, so only rewinding to before this visit repeats it.
    const deceased = this.roster.lastDeceased;
    this.roster.lastDeceased = null;
    this.rosemarieLine = deceased === null ? GREETING : condolences(deceased);
    this.audio?.play('typing_click');
  }

  close(): void {
    this.open = false;
    this.dismissConfirm.close();
  }

  /** Advances Rosemarie's life behind the desk: her hobble, her coins, the dancers' complaints. */
  updateDesk(): void {
    this.desk.update(this.open);
  }

  /** Draws Rosemarie at her desk for the club's Y-sorted pass. */
  renderDesk(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    this.desk.render(ctx, camX, camY, tileSize);
  }

  /** The coin she has in the air and whatever the dancer it hit is shouting about. */
  renderDeskOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.desk.renderOverlay(ctx, camX, camY);
  }

  private say(line: string): void {
    this.rosemarieLine = line;
  }

  /** Rosemarie's reason not to sign `template` right now, or null when she will. */
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
    // drawn: it walks out of the club already moving.
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
   * A press on the selected row: Rosemarie says why it cannot be signed, if
   * it cannot. Never signs anything.
   */
  private activateEntry(index: number, player: Purse, companion: Purse): void {
    const entry = DESK_ENTRIES[index];
    if (entry.kind === 'refusal') {
      this.say(DAMASCUS_REFUSAL);
      this.audio?.play('typing_click');
      return;
    }
    const underContract = this.roster.active?.id === entry.template.id;
    const refusal = underContract ? null : this.hireRefusal(entry.template, player, companion);
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
    const entries = DESK_ENTRIES.map((entry): MercenaryDeskEntry => {
      if (entry.kind === 'refusal')
        return { kind: 'refusal', ...DAMASCUS, pitch: DAMASCUS_REFUSAL };
      const template = entry.template;
      return {
        kind: 'hire',
        template,
        underContract: active?.id === template.id,
        hireRefusal: this.hireRefusal(template, player, companion),
        hireNote: this.hireNote(template, player, companion),
      };
    });
    return {
      entries,
      selected: this.selected,
      line: this.rosemarieLine,
      coins: partyCoins(player, companion),
    };
  }

  /** A press on a row: a different row is selected; the selected row hears from Rosemarie whether it can be signed. */
  pressRow(index: number, player: Purse, companion: Purse): void {
    if (index < 0 || index >= DESK_ENTRIES.length) return;
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

  /** Draws Rosemarie's head and shoulders, standing on the bottom edge of `frame`. */
  drawRosemarie(ctx: CanvasRenderingContext2D, frame: Rect): void {
    const tile = Math.min(SPEECH_PORTRAIT_TILE, frame.h / ROSEMARIE_GROUND_IN_TILE);
    const sx = frame.x + (frame.w - tile) / 2;
    const sy = frame.y + frame.h - tile * ROSEMARIE_GROUND_IN_TILE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    drawRosemariePortrait(ctx, sx, sy, tile, { row: 'idle', timeSeconds: this.desk.timeSeconds });
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
    // crocodilian barely one both stand head-to-foot in the same frame.
    const figureTiles = art.headLiftTiles + FIGURE_FEET_IN_TILE;
    const usableH = frame.h - PORTRAIT_MARGIN * 2;
    const tile = Math.min(PORTRAIT_MAX_TILE, usableH / figureTiles);
    const sx = frame.x + (frame.w - tile) / 2;
    const feetY = frame.y + frame.h - PORTRAIT_MARGIN;
    const sy = feetY - tile * FIGURE_FEET_IN_TILE;
    // Clipped because a figure's ink runs past its tile — a golem's head, a
    // raised lance — and the frame is the edge of the picture.
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    art.draw(ctx, sx, sy, tile, {
      state: { row: 'idle', progress: 0 },
      walkFrame: 0,
      isMoving: false,
      facingX: 0,
      facingY: 1,
      clock: this.desk.ticks,
    });
    ctx.restore();
  }
}
