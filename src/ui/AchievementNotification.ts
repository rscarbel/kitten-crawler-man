import type { AchievementDef, BoxTier } from '../core/AchievementManager';
import { randomFromArray, randomInt } from '../utils';
import type { Rect } from './core/geom';
import type { Ui } from './core/UiRoot';
import { chromeTheme, drawRule, lootTierColor } from './screens/dialogs/canvasChrome';
import { button } from './widgets/button';
import { withAlpha } from './theme/color';
import { skinsFor } from './theme/skins';
import type { Theme } from './theme/tokens';
import { drawGlass, fillRounded, strokeRounded, type PaintTarget } from './widgets/paint';
import { measureText, measureTextHeight, text } from './widgets/text';

/** A sparkle's position is relative to the card's centre, so it rides wherever the card is drawn. */
interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

/** Gold-leaning sparkles: the accent, the top rarities and a little white. */
function sparkleColors(theme: Theme): string[] {
  const { palette } = theme;
  return [
    palette.accent.base,
    palette.accent.hover,
    palette.tier.gold,
    palette.material.brassLight,
    palette.tier.celestial,
    palette.text.primary,
  ];
}

const BOX_W = 420;
const BOX_H = 280;
const FADE_IN_FRAMES = 18;
const OK_BTN_W = 100;
const OK_BTN_H = 40;

const BOX_MARGIN = 32;
const PULSE_MIN = 0.85;
const PULSE_RANGE = 0.15;
const PULSE_FREQ = 0.12;
const HEADER_GLOW = 16;
const DIVIDER_Y = 52;
const DIVIDER_PADDING = 24;
const ACHIEVEMENT_NAME_PADDING = 48;
const DESCRIPTION_PADDING = 64;
const BOX_ICON_SIZE = 24;
const OK_BTN_Y_OFFSET = 18;
const HEADER_TOP = 18;
const CARD_GLOW_ALPHA = 0.35;
const CARD_GLOW_BLUR = 32;
const CARD_EDGE_ALPHA = 0.55;
const CARD_EDGE_WIDTH = 1.5;
const REWARD_ROW_HEIGHT = 28;
const BOX_ICON_FILL_ALPHA = 0.3;
const SPARKLE_SPAWN_RATE = 3;
const SPARKLE_BURST_MIN_SPEED = 2;
const SPARKLE_BURST_SPEED_RANGE = 5;
const SPARKLE_NORMAL_MIN_SPEED = 0.5;
const SPARKLE_NORMAL_SPEED_RANGE = 2;
const SPARKLE_BURST_GRAVITY = 2;
const SPARKLE_MIN_RADIUS = 1.5;
const SPARKLE_RADIUS_RANGE = 3;
const SPARKLE_LIFE_MIN = 30;
const SPARKLE_LIFE_MAX = 69;
const SPARKLE_TOTAL_LIFE = 70;
const SPARKLE_GRAVITY = 0.08;
const SPARKLE_SPAWN_COUNT = 30;
const SPAWN_OFFSET_RANGE = 0.5;
const BOX_BODY_TOP = 0.3;
const BOX_BODY_HEIGHT = 0.7;
const BOX_ICON_LINE_WIDTH = 1.5;
const BOX_LID_OFFSET = 2;
const BOX_LID_WIDTH_ADD = 4;
const BOX_LID_HEIGHT = 0.12;
const BOX_LID_TOP = 0.25;

export class AchievementNotification {
  private frame = 0;
  private sparkles: Sparkle[] = [];

  /** Call once per frame when a notification is visible to advance animation. */
  tick(): void {
    this.frame++;

    // Spawn sparkles continuously during display
    if (this.frame % SPARKLE_SPAWN_RATE === 0) {
      this.spawnSparkle();
    }

    // Advance sparkles
    for (const s of this.sparkles) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += SPARKLE_GRAVITY; // gentle gravity
      s.life--;
    }
    this.sparkles = this.sparkles.filter((s) => s.life > 0);
  }

  /** Whether the card has finished fading in, so OK answers. */
  get isFadedIn(): boolean {
    return this.frame >= FADE_IN_FRAMES;
  }

  /** Reset animation state — call this when a new notification starts. */
  reset(): void {
    this.frame = 0;
    this.sparkles = [];
    // Burst of sparkles on appearance
    for (let i = 0; i < SPARKLE_SPAWN_COUNT; i++) this.spawnSparkle(true);
  }

  private spawnSparkle(burst = false): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = burst
      ? SPARKLE_BURST_MIN_SPEED + Math.random() * SPARKLE_BURST_SPEED_RANGE
      : SPARKLE_NORMAL_MIN_SPEED + Math.random() * SPARKLE_NORMAL_SPEED_RANGE;
    const edgeX = (Math.random() - SPAWN_OFFSET_RANGE) * BOX_W;
    const edgeY = (Math.random() - SPAWN_OFFSET_RANGE) * BOX_H;
    this.sparkles.push({
      x: edgeX,
      y: edgeY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? SPARKLE_BURST_GRAVITY : 0),
      radius: SPARKLE_MIN_RADIUS + Math.random() * SPARKLE_RADIUS_RANGE,
      color: randomFromArray(sparkleColors(chromeTheme())),
      life: randomInt(SPARKLE_LIFE_MIN, SPARKLE_LIFE_MAX),
      maxLife: SPARKLE_TOTAL_LIFE,
    });
  }

  /**
   * Draws the card over the whole screen with its OK button, which is the
   * default for Space and Enter and stays disabled until the card has faded in.
   */
  paint(ui: Ui, achievement: AchievementDef, player: 'Human' | 'Cat', onOk: () => void): void {
    const { ctx, theme } = ui;
    const cw = ui.screen.w;
    const ch = ui.screen.h;
    const { palette, type, space, radius } = theme;
    const skins = skinsFor(theme);
    const alpha = Math.min(1, this.frame / FADE_IN_FRAMES);

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = skins.scrim;
    ctx.fillRect(0, 0, cw, ch);

    const boxW = Math.min(BOX_W, cw - BOX_MARGIN);
    const boxH = Math.min(BOX_H, ch - BOX_MARGIN);
    const card: Rect = { x: (cw - boxW) / 2, y: (ch - boxH) / 2, w: boxW, h: boxH };
    ctx.save();
    ctx.shadowColor = withAlpha(palette.accent.base, CARD_GLOW_ALPHA);
    ctx.shadowBlur = CARD_GLOW_BLUR;
    fillRounded(ctx, card, radius.lg, palette.surface.sunken);
    ctx.restore();
    drawGlass(ui, card, skins.panel.card);
    strokeRounded(
      ctx,
      card,
      radius.lg,
      withAlpha(palette.accent.base, CARD_EDGE_ALPHA),
      CARD_EDGE_WIDTH,
    );

    const column = (y: number, h: number, pad: number): Rect => ({
      x: card.x + pad,
      y,
      w: card.w - pad * 2,
      h,
    });

    const pulse = PULSE_MIN + PULSE_RANGE * Math.sin(this.frame * PULSE_FREQ);
    ctx.save();
    ctx.globalAlpha *= pulse;
    ctx.shadowColor = palette.accent.base;
    ctx.shadowBlur = HEADER_GLOW;
    text(ui, column(card.y + HEADER_TOP, type.heading.lineHeight, DIVIDER_PADDING), {
      text: 'New achievement!',
      style: type.heading,
      color: palette.accent.base,
      align: 'center',
    });
    ctx.restore();

    drawRule(
      ui,
      card.x + DIVIDER_PADDING,
      card.y + DIVIDER_Y,
      card.w - DIVIDER_PADDING * 2,
      palette.accent.base,
    );

    let cursorY = card.y + DIVIDER_Y + space.lg;
    const nameHeight = measureTextHeight(ui, card.w - ACHIEVEMENT_NAME_PADDING * 2, {
      text: achievement.name,
      role: 'title',
    });
    text(ui, column(cursorY, nameHeight, ACHIEVEMENT_NAME_PADDING), {
      text: achievement.name,
      role: 'title',
      wrap: true,
      align: 'center',
    });
    cursorY += nameHeight;

    const crawlerColor = player === 'Human' ? palette.crawler.human : palette.crawler.cat;
    text(ui, column(cursorY, type.caption.lineHeight, DIVIDER_PADDING), {
      text: `Awarded to ${player}`,
      role: 'caption',
      color: crawlerColor,
      align: 'center',
    });
    cursorY += type.caption.lineHeight + space.sm;

    const okY = card.y + card.h - OK_BTN_H - OK_BTN_Y_OFFSET;
    const lootBox = achievement.lootBox;
    const rewardTop = okY - space.md - REWARD_ROW_HEIGHT;
    const descriptionBottom = lootBox === undefined ? okY - space.md : rewardTop - space.sm;
    text(ui, column(cursorY, Math.max(0, descriptionBottom - cursorY), DESCRIPTION_PADDING), {
      text: achievement.description,
      role: 'secondary',
      wrap: true,
      align: 'center',
      maxLines: Math.max(1, Math.floor((descriptionBottom - cursorY) / type.body.lineHeight)),
    });

    if (lootBox !== undefined) {
      this.paintReward(ui, lootBox.tier, `${lootBox.tier} ${lootBox.category} Box`, {
        x: card.x + DIVIDER_PADDING,
        y: rewardTop,
        w: card.w - DIVIDER_PADDING * 2,
        h: REWARD_ROW_HEIGHT,
      });
    }

    const okX = cw / 2 - OK_BTN_W / 2;
    const fadedIn = this.isFadedIn;
    button(
      ui,
      { x: okX, y: okY, w: OK_BTN_W, h: OK_BTN_H },
      {
        id: 'ok',
        label: 'OK!',
        variant: 'primary',
        primary: true,
        disabled: !fadedIn,
        onTap: onOk,
      },
    );

    const centreX = cw / 2;
    const centreY = ch / 2;
    for (const s of this.sparkles) {
      const lifeRatio = s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha *= lifeRatio;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(centreX + s.x, centreY + s.y, s.radius * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  /** The loot box the achievement pays: a little box in its rarity colour beside its name. */
  private paintReward(target: PaintTarget, tier: BoxTier, name: string, row: Rect): void {
    const { theme } = target;
    const color = lootTierColor(theme, tier);
    const label = `Reward: ${name}`;
    const labelWidth = Math.min(
      row.w - BOX_ICON_SIZE - theme.space.sm,
      measureText(target, label, { role: 'label' }),
    );
    const left = row.x + (row.w - BOX_ICON_SIZE - theme.space.sm - labelWidth) / 2;
    this.drawBoxIcon(target.ctx, left, row.y + (row.h - BOX_ICON_SIZE) / 2, BOX_ICON_SIZE, color);
    text(
      target,
      { x: left + BOX_ICON_SIZE + theme.space.sm, y: row.y, w: labelWidth, h: row.h },
      { text: label, role: 'label', color },
    );
  }

  // Helpers

  private drawBoxIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
  ): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha *= BOX_ICON_FILL_ALPHA;
    ctx.fillRect(x, y + size * BOX_BODY_TOP, size, size * BOX_BODY_HEIGHT);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = BOX_ICON_LINE_WIDTH;
    ctx.strokeRect(x, y + size * BOX_BODY_TOP, size, size * BOX_BODY_HEIGHT);
    ctx.strokeRect(
      x - BOX_LID_OFFSET,
      y + size * BOX_LID_TOP,
      size + BOX_LID_WIDTH_ADD,
      size * BOX_LID_HEIGHT,
    );
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y + size * BOX_LID_TOP);
    ctx.lineTo(x + size / 2, y + size);
    ctx.stroke();
    ctx.restore();
  }
}
