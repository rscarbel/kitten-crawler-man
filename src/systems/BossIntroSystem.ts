import { drawHumanSprite } from '../sprites/humanSprite';
import { catCellFor, drawCatSprite, type CatAppearance } from '../sprites/catSprite';
import { drawRoosterSprite, prewarmRoosterRow } from '../sprites/roosterSprite';
import {
  BIG_ROOSTER_FIGURE,
  GROUND_OFFSET_PX,
  roosterStateName,
} from '../sprites/art/roosterFigure';
import {
  BIG_ROOSTER_BOSS_TYPE,
  ELECTRIC_GOBLIN_BOSS_TYPE,
  KRAKEN_BOSS_TYPE,
  TRASH_GREMLIN_BOSS_TYPE,
} from '../core/mobs/bossTypes';
import {
  drawTrashGremlinSprite,
  prewarmTrashGremlinLocomotion,
} from '../sprites/trashGremlinSprite';
import {
  GROUND_OFFSET_PX as TRASH_GREMLIN_GROUND_OFFSET_PX,
  TRASH_GREMLIN_FIGURE,
} from '../sprites/art/trashGremlinFigure';
import { drawnFigureRow } from '../sprites/figure/figureDef';
import { figureFrameHeadroomTiles } from '../sprites/figure/figureFrameCache';
import {
  drawNecromancerSprite,
  necromancerArtHeightTiles,
  necromancerArtTopTiles,
} from '../sprites/necromancerSprite';
import {
  drawKrakenSprite,
  KRAKEN_ART_HEIGHT_TILES,
  KRAKEN_ART_TOP_TILES,
  prewarmKrakenBody,
} from '../sprites/krakenSprite';
import { ELECTRIC_GOBLIN_FIGURE } from '../sprites/art/electricGoblinFigure';
import { drawElectricGoblinSprite, prewarmElectricGoblin } from '../sprites/electricGoblinSprite';
import { drawGrotesqueSpiderPoseSprite } from '../sprites/grotesqueSpiderSprite';
import { GROTESQUE_SPIDER_IDLE_REACH_TILES } from '../sprites/art/grotesqueSpiderFigure';
import { SPIDER_FRAMES_PER_SECOND } from '../creatures/grotesqueSpiderTimeline';
import type { GameSystem } from './GameSystem';
import { measureWorldText, worldText } from '../ui/world/worldText';
import { worldPlate, worldTint } from '../ui/world/worldShapes';
import { worldPalette } from '../ui/theme/worldInk';
import { withAlpha } from '../ui/theme/color';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { crawlerDisplayName } from '../characters/characters';

/**
 * Measured after uppercasing, because uppercasing can lengthen a name (ß
 * becomes SS) and the player's name is any length the name rules allow.
 */
function crawlerTeamLabel(): string {
  return `TEAM ${crawlerDisplayName('human').toUpperCase()} & ${crawlerDisplayName('cat').toUpperCase()}`;
}

type IntroState = {
  bossType: string;
  bossName: string;
  bossColor: string;
  frame: number;
  phase: 'letters' | 'versus';
};

/** Minimum font size for the boss intro title, in pixels. */
const INTRO_FONT_MIN_SIZE = 64;
/** Denominator for responsive font size calculation. */
const INTRO_FONT_DIVISOR = 12;
/** Shadow blur when a character is the last revealed. */
const CHAR_LAST_SHADOW_BLUR = 24;
/** Shadow blur for already-revealed characters. */
const CHAR_SHADOW_BLUR = 8;
/** Font scale of the "GET READY!" subtext relative to the title. */
const SUBTEXT_FONT_SCALE = 0.4;
/** Alpha ramp-up multiplier for subtext. */
const SUBTEXT_ALPHA_RAMP = 3;
/** Panel slide-in easing base (frames). */
const VERSUS_SLIDE_IN_FRAMES = 30;
/** VS label flash alpha comes in after this many frames. */
const VS_APPEAR_AFTER_FRAMES = 20;
/** VS label flash duration. */
const VS_FLASH_FRAMES = 15;
/** VS pulse scale factor. */
const VS_PULSE_SCALE = 0.06;
/** VS pulse speed. */
const VS_PULSE_SPEED = 0.15;
/** VS sprite size on intro screen. */
const VERSUS_VS_Y_OFFSET = 18;
/** FIGHT label alpha denominator. */
const FIGHT_ALPHA_RAMP = 20;
/** FIGHT label y offset from panel bottom. */
const FIGHT_Y_OFFSET = 40;
/** FIGHT label y adjust. */
const FIGHT_Y_ADJUST = 8;
/** Panel size for the "versus" screen. */
const VERSUS_PANEL_H = 200;
/** Versus panel left/right gap from center. */
const VERSUS_PANEL_GAP = 20;
/** Versus panel width fraction of canvas. */
const VERSUS_PANEL_W_FRACTION = 0.38;
/** Max panel width. */
const VERSUS_PANEL_W_MAX = 280;
/** Offset for the crawlers' team label from panel bottom. */
const TEAM_LABEL_Y_OFFSET_FROM_BOTTOM = 28;
/** Lifts a label from its baseline-relative offset to the top of its glyphs. */
const LABEL_TEXT_ADJUST = 9;
/** Smaller label y offset from panel bottom. */
const SMALL_LABEL_Y_OFFSET_FROM_BOTTOM = 14;
/** Small label text size adjustment. */
const SMALL_LABEL_TEXT_ADJUST = 7;
/** Human sprite x offset in versus panel. */
const HUMAN_SPRITE_X_OFFSET = 14;
/** Human sprite y offset in versus panel. */
const HUMAN_SPRITE_Y_OFFSET = 78;
/** Human sprite size. */
const HUMAN_SPRITE_SIZE = 72;
/** How much clear panel is left above the top of his comb. */
const BIG_ROOSTER_PANEL_TOP_PAD = 12;
/** Clear panel kept between his toes and the name label under him. */
const BIG_ROOSTER_PANEL_BOTTOM_PAD = 8;
/** How far down the panel his toes may reach: clear of the name label. */
const BIG_ROOSTER_PANEL_ART_BOTTOM =
  VERSUS_PANEL_H -
  TEAM_LABEL_Y_OFFSET_FROM_BOTTOM -
  LABEL_TEXT_ADJUST -
  BIG_ROOSTER_PANEL_BOTTOM_PAD;
/** Where his toes stand inside his own tile, as a fraction of it from the top. */
const BIG_ROOSTER_GROUND_TILE_FRACTION = GROUND_OFFSET_PX / BIG_ROOSTER_FIGURE.tileScale;
/** The head-on idle his portrait holds. */
const BIG_ROOSTER_PORTRAIT_ROW = drawnFigureRow(
  BIG_ROOSTER_FIGURE,
  roosterStateName('idle', 'front'),
);

/**
 * His tile size and tile top in the panel, fitted comb to toe between the pads
 * from his portrait row's measured headroom: he stands over three tiles tall,
 * so a size picked by eye puts his comb through the top of the panel or his
 * toes into his name.
 */
function bigRoosterPortraitPlacement(): { size: number; yOffset: number } {
  const headroomTiles = figureFrameHeadroomTiles(
    BIG_ROOSTER_PORTRAIT_ROW,
    BIG_ROOSTER_INTRO_IDLE_FRAME,
  );
  const size = Math.floor(
    (BIG_ROOSTER_PANEL_ART_BOTTOM - BIG_ROOSTER_PANEL_TOP_PAD) /
      (headroomTiles + BIG_ROOSTER_GROUND_TILE_FRACTION),
  );
  return { size, yOffset: BIG_ROOSTER_PANEL_TOP_PAD + Math.round(size * headroomTiles) };
}
/** He is posed head-on in the panel, looking out at the player. */
const BIG_ROOSTER_INTRO_FACING_Y = 1;
/** A portrait holds one pose rather than breathing through the intro. */
const BIG_ROOSTER_INTRO_IDLE_FRAME = 0;
/**
 * How tall her art is drawn in the panel.
 *
 * Her `ts` argument is a *tile* size and her baked cell stands nearly three
 * tiles tall, so a flat size picked as a height would draw her at triple it and
 * out through both ends of the panel. The tile size is divided back out of this.
 */
const KRAKEN_SPRITE_SIZE = 120;
/** How much clear panel is left above the top of her mantle. */
const KRAKEN_PANEL_TOP_PAD = 18;
/** She is posed head-on in the panel, and a portrait holds one frame. */
const KRAKEN_INTRO_FACING_Y = 1;
const KRAKEN_INTRO_IDLE_FRAME = 0;
/** Clear panel kept round the Grotesque Spider: above her tail, below her fangs, and at either side. */
const SPIDER_PANEL_PAD = 8;
/** How far down the panel her art may reach: clear of the name label under her. */
const SPIDER_PANEL_ART_BOTTOM =
  VERSUS_PANEL_H - TEAM_LABEL_Y_OFFSET_FROM_BOTTOM - LABEL_TEXT_ADJUST - SPIDER_PANEL_PAD;

/**
 * The Grotesque Spider's tile size in a panel `panelW` wide.
 *
 * Derived from her measured reach rather than picked: seen from above with her
 * legs splayed she spans about five tiles, so a tile size picked by eye either
 * pushes her tail through the top of the panel and her fangs into her name, or
 * overflows the sides once a narrow viewport shrinks the panel.
 */
function spiderPortraitTileSize(panelW: number): number {
  const reach = GROTESQUE_SPIDER_IDLE_REACH_TILES;
  const byHeight = (SPIDER_PANEL_ART_BOTTOM - SPIDER_PANEL_PAD) / (reach.tail + reach.head);
  const byWidth = (panelW - SPIDER_PANEL_PAD * 2) / (reach.side * 2);
  return Math.floor(Math.min(byHeight, byWidth));
}
/** How much clear panel is left above the top of its ears and crown. */
const TRASH_GREMLIN_PANEL_TOP_PAD = 12;
/** Clear panel kept between its feet and the name label under it. */
const TRASH_GREMLIN_PANEL_BOTTOM_PAD = 8;
/** How far down the panel its feet may reach: clear of the name label. */
const TRASH_GREMLIN_PANEL_ART_BOTTOM =
  VERSUS_PANEL_H -
  TEAM_LABEL_Y_OFFSET_FROM_BOTTOM -
  LABEL_TEXT_ADJUST -
  TRASH_GREMLIN_PANEL_BOTTOM_PAD;
/** Where its soles stand inside its own tile, as a fraction of it from the top. */
const TRASH_GREMLIN_GROUND_TILE_FRACTION =
  TRASH_GREMLIN_GROUND_OFFSET_PX / TRASH_GREMLIN_FIGURE.tileScale;
/** The head-on idle the portrait holds. */
const TRASH_GREMLIN_PORTRAIT_ROW = drawnFigureRow(TRASH_GREMLIN_FIGURE, 'idle');

/** Its tile size and tile top in the panel, fitted crown to sole between the pads. */
function trashGremlinPortraitPlacement(): { size: number; yOffset: number } {
  const headroomTiles = figureFrameHeadroomTiles(
    TRASH_GREMLIN_PORTRAIT_ROW,
    TRASH_GREMLIN_PORTRAIT_FRAME,
  );
  const size = Math.floor(
    (TRASH_GREMLIN_PANEL_ART_BOTTOM - TRASH_GREMLIN_PANEL_TOP_PAD) /
      (headroomTiles + TRASH_GREMLIN_GROUND_TILE_FRACTION),
  );
  return { size, yOffset: TRASH_GREMLIN_PANEL_TOP_PAD + Math.round(size * headroomTiles) };
}
/** Pinned rather than clock-driven: a portrait that breathes reads as a bug. */
const TRASH_GREMLIN_PORTRAIT_FRAME = 0;
/** How much clear panel is left above the top of his generator's coils. */
const ELECTRIC_GOBLIN_PANEL_TOP_PAD = 12;
/** Clear panel kept between his boots and the name label under him. */
const ELECTRIC_GOBLIN_PANEL_BOTTOM_PAD = 8;
/** How far down the panel his boots may reach: clear of the name label. */
const ELECTRIC_GOBLIN_PANEL_ART_BOTTOM =
  VERSUS_PANEL_H -
  TEAM_LABEL_Y_OFFSET_FROM_BOTTOM -
  LABEL_TEXT_ADJUST -
  ELECTRIC_GOBLIN_PANEL_BOTTOM_PAD;
/** His boots stand on the bottom edge of his tile, like every goblin's. */
const ELECTRIC_GOBLIN_GROUND_TILE_FRACTION = 1;
const ELECTRIC_GOBLIN_PORTRAIT_STATE = 'idle' as const;
const ELECTRIC_GOBLIN_PORTRAIT_ROW = drawnFigureRow(
  ELECTRIC_GOBLIN_FIGURE,
  ELECTRIC_GOBLIN_PORTRAIT_STATE,
);
/** Pinned rather than clock-driven, like every portrait. */
const ELECTRIC_GOBLIN_PORTRAIT_FRAME = 0;
/** Painted in profile only, so the portrait faces into the panel towards the crawlers. */
const ELECTRIC_GOBLIN_PORTRAIT_FACING_X = -1;

/** His tile size and tile top in the panel, fitted coil to boot between the pads. */
function electricGoblinPortraitPlacement(): { size: number; yOffset: number } {
  const headroomTiles = figureFrameHeadroomTiles(
    ELECTRIC_GOBLIN_PORTRAIT_ROW,
    ELECTRIC_GOBLIN_PORTRAIT_FRAME,
  );
  const size = Math.floor(
    (ELECTRIC_GOBLIN_PANEL_ART_BOTTOM - ELECTRIC_GOBLIN_PANEL_TOP_PAD) /
      (headroomTiles + ELECTRIC_GOBLIN_GROUND_TILE_FRACTION),
  );
  return { size, yOffset: ELECTRIC_GOBLIN_PANEL_TOP_PAD + Math.round(size * headroomTiles) };
}
/** Cat sprite x fraction of panel width. */
const CAT_SPRITE_X_FRACTION = 0.52;
/** Cat sprite y offset in versus panel. */
const CAT_SPRITE_Y_OFFSET = 66;
/** Cat sprite size. */
const CAT_SPRITE_SIZE = 90;
/** Versus countdown: frames from end when fight label fades in. */
const FIGHT_LABEL_BEFORE_END = 90;
/** Glow blur for "GET READY!" text. */
const GET_READY_GLOW_BLUR = 10;
/** Scale pop size for last char. */
const LAST_CHAR_SCALE_FACTOR = 0.15;
/** Fractional font scale for char baseline offset. */
const FONT_BASELINE_FRACTION = 0.8;
/** Fractional font scale for subtext y offset. */
const SUBTEXT_Y_FRACTION = 0.9;
const BOSS_PANEL_DEFAULT_BG = worldPalette.bossIntro.bossPanelFill;
/**
 * Per-boss overrides for {@link BOSS_PANEL_DEFAULT_BG}. A boss whose sprite is
 * near-black disappears into the default backdrop, so it gets a lighter one.
 */
const BOSS_PANEL_BACKGROUNDS: Partial<Record<string, string>> = {
  grotesque_spider: worldPalette.bossIntro.bossPanelFillLight,
};
/** How far the title card darkens the scene behind it. */
const BACKDROP_ALPHA = 0.88;
const VERSUS_PANEL_BORDER_WIDTH = 2;
const PANEL_LABEL_SIZE = 11;
/** Clear space kept between the team label and either edge of its panel. */
const TEAM_LABEL_SIDE_MARGIN = 8;
const PANEL_CAPTION_SIZE = 9;
const FIGHT_LABEL_SIZE = 10;

/** The boss type the Briar Hollow siege passes for Vordrick Boneharrow. */
const NECROMANCER_BOSS_TYPE = 'necromancer';

/**
 * Total pixel height of the necromancer's portrait cell — sized larger than
 * the Kraken's, since his cell is proportionally taller and the same
 * pixel budget reads him too small to recognize at panel scale.
 */
const NECROMANCER_SPRITE_SIZE = 140;
/** Clear panel kept above the top of his cell. */
const NECROMANCER_PANEL_TOP_PAD = 18;
/** A portrait holds one pose rather than breathing through the intro. */
const NECROMANCER_INTRO_IDLE_FRAME = 0;

export class BossIntroSystem implements GameSystem {
  private static readonly INTRO_TITLE = 'B-B-B-B-BOSS BATTLE!';
  private static readonly INTRO_FRAMES_PER_CHAR = 7;
  private static readonly INTRO_HOLD_FRAMES = 70;
  private static readonly INTRO_VERSUS_FRAMES = 220;

  private state: IntroState | null = null;

  get isActive(): boolean {
    return this.state !== null;
  }

  trigger(bossType: string, bossName: string, bossColor: string): void {
    this.state = { bossType, bossName, bossColor, frame: 0, phase: 'letters' };
    // The intro is seven seconds during which the boss is drawn only as a
    // portrait, which is more lead than anything else in the fight can offer a
    // figure whose cells cost milliseconds rather than microseconds to paint.
    if (bossType === KRAKEN_BOSS_TYPE) prewarmKrakenBody();
    if (bossType === TRASH_GREMLIN_BOSS_TYPE) {
      // Its portrait holds the head-on idle, one of the rows it stands in.
      prewarmTrashGremlinLocomotion();
      figureFrameHeadroomTiles(TRASH_GREMLIN_PORTRAIT_ROW, TRASH_GREMLIN_PORTRAIT_FRAME);
    }
    if (bossType === ELECTRIC_GOBLIN_BOSS_TYPE) {
      prewarmElectricGoblin([ELECTRIC_GOBLIN_PORTRAIT_STATE]);
      figureFrameHeadroomTiles(ELECTRIC_GOBLIN_PORTRAIT_ROW, ELECTRIC_GOBLIN_PORTRAIT_FRAME);
    }
    if (bossType === BIG_ROOSTER_BOSS_TYPE) {
      prewarmRoosterRow('big', 'idle');
      prewarmRoosterRow('big', 'crow');
      figureFrameHeadroomTiles(BIG_ROOSTER_PORTRAIT_ROW, BIG_ROOSTER_INTRO_IDLE_FRAME);
    }
  }

  /** Dismisses an in-progress intro without playing it out — used on a checkpoint respawn. */
  cancel(): void {
    this.state = null;
  }

  update(): void {
    this.tick();
  }

  tick(): void {
    if (!this.state) return;
    this.state.frame++;

    const FPC = BossIntroSystem.INTRO_FRAMES_PER_CHAR;
    const titleLen = BossIntroSystem.INTRO_TITLE.length;
    const lettersPhaseEnd = titleLen * FPC + BossIntroSystem.INTRO_HOLD_FRAMES;

    if (this.state.phase === 'letters' && this.state.frame >= lettersPhaseEnd) {
      this.state.phase = 'versus';
      this.state.frame = 0;
    } else if (
      this.state.phase === 'versus' &&
      this.state.frame >= BossIntroSystem.INTRO_VERSUS_FRAMES
    ) {
      this.state = null;
    }
  }

  /** `cat` is the cat crawler as she is dressed, drawn on the party's panel. */
  render(ctx: CanvasRenderingContext2D, cat: CatAppearance<'crawler'>): void {
    if (!this.state) return;
    const intro = this.state;
    const CX = viewportWidth() / 2;
    const CY = viewportHeight() / 2;

    worldTint(ctx, worldPalette.shade, BACKDROP_ALPHA);

    if (intro.phase === 'letters') {
      const TITLE = BossIntroSystem.INTRO_TITLE;
      const FPC = BossIntroSystem.INTRO_FRAMES_PER_CHAR;
      const charsShown = Math.min(TITLE.length, Math.floor(intro.frame / FPC) + 1);

      const fullText = TITLE.slice(0, charsShown);
      const fontSize = Math.min(
        INTRO_FONT_MIN_SIZE,
        Math.floor(viewportWidth() / INTRO_FONT_DIVISOR),
      );
      const charW = measureWorldText(ctx, 'B', { size: fontSize, bold: true }).width;
      for (let i = 0; i < fullText.length; i++) {
        const isLast = i === charsShown - 1;
        const FLASH_PULSE_SPEED = 0.6;
        const flashPulse = isLast ? Math.sin(intro.frame * FLASH_PULSE_SPEED) : 1;
        const ch = fullText[i];

        const CHAR_ALPHA_BASE = 0.7;
        const CHAR_ALPHA_PULSE_RANGE = 0.3;
        const flashAlpha = CHAR_ALPHA_BASE + CHAR_ALPHA_PULSE_RANGE * flashPulse;
        const { bossIntro } = worldPalette;
        // The flash rides on the colour rather than on the text's alpha: under a
        // canvas shadow the two are not equivalent, and the marquee's glow was
        // tuned with the flash in the colour.
        let charColor: string;
        if (ch === 'B') {
          charColor = isLast ? withAlpha(bossIntro.marqueeFlash, flashAlpha) : bossIntro.marquee;
        } else if (ch === '-') {
          charColor = bossIntro.marqueeDash;
        } else {
          charColor = isLast
            ? withAlpha(bossIntro.marqueeLetterFlash, flashAlpha)
            : bossIntro.marqueeLetter;
        }

        const CHAR_X_CENTER = 0.5;
        const totalW = fullText.length * charW;
        const startX = CX - totalW / 2 + charW * CHAR_X_CENTER;
        const cx = startX + i * charW;

        const scale = isLast ? 1 + LAST_CHAR_SCALE_FACTOR * Math.abs(flashPulse) : 1;
        ctx.save();
        ctx.translate(cx, CY);
        ctx.scale(scale, scale);
        ctx.shadowColor = worldPalette.bossIntro.marquee;
        ctx.shadowBlur = isLast ? CHAR_LAST_SHADOW_BLUR : CHAR_SHADOW_BLUR;
        // The translated origin is the baseline, and the text is set from its top.
        worldText(ctx, ch, {
          x: 0,
          y: -Math.round(fontSize * FONT_BASELINE_FRACTION),
          size: fontSize,
          bold: true,
          color: charColor,
          align: 'center',
        });
        ctx.restore();
      }

      const titleLen = TITLE.length;
      if (charsShown >= titleLen) {
        const holdProgress = (intro.frame - titleLen * FPC) / BossIntroSystem.INTRO_HOLD_FRAMES;
        const alpha = Math.min(1, holdProgress * SUBTEXT_ALPHA_RAMP);
        const subSize = Math.floor(fontSize * SUBTEXT_FONT_SCALE);
        worldText(ctx, 'GET READY!', {
          x: CX,
          y: CY + fontSize * SUBTEXT_Y_FRACTION - Math.round(subSize * FONT_BASELINE_FRACTION),
          size: subSize,
          bold: true,
          color: worldPalette.ink.danger,
          align: 'center',
          alpha,
          glow: true,
          glowBlur: GET_READY_GLOW_BLUR,
        });
      }
    } else {
      const t = intro.frame;
      const slideIn = Math.min(1, t / VERSUS_SLIDE_IN_FRAMES);
      const EASE_POWER = 3;
      const eased = 1 - Math.pow(1 - slideIn, EASE_POWER);

      const panelW = Math.min(VERSUS_PANEL_W_MAX, viewportWidth() * VERSUS_PANEL_W_FRACTION);
      const panelH = VERSUS_PANEL_H;
      const panelY = CY - panelH / 2;

      const leftX = CX - VERSUS_PANEL_GAP - panelW - (1 - eased) * CX;
      worldPlate(
        ctx,
        { x: leftX, y: panelY, w: panelW, h: panelH },
        {
          fill: worldPalette.bossIntro.partyPanelFill,
          border: worldPalette.bossIntro.partyPanelEdge,
          borderWidth: VERSUS_PANEL_BORDER_WIDTH,
        },
      );

      ctx.save();
      drawHumanSprite(
        ctx,
        leftX + HUMAN_SPRITE_X_OFFSET,
        panelY + HUMAN_SPRITE_Y_OFFSET,
        HUMAN_SPRITE_SIZE,
      );
      ctx.restore();
      ctx.save();
      drawCatSprite(
        ctx,
        cat,
        leftX + panelW * CAT_SPRITE_X_FRACTION,
        panelY + CAT_SPRITE_Y_OFFSET,
        CAT_SPRITE_SIZE,
        catCellFor(),
      );
      ctx.restore();

      const teamLabel = crawlerTeamLabel();
      const teamLabelRoom = panelW - TEAM_LABEL_SIDE_MARGIN * 2;
      const teamLabelWidth = measureWorldText(ctx, teamLabel, {
        size: PANEL_LABEL_SIZE,
        bold: true,
      }).width;
      const teamLabelSize =
        teamLabelWidth > teamLabelRoom
          ? PANEL_LABEL_SIZE * (teamLabelRoom / teamLabelWidth)
          : PANEL_LABEL_SIZE;
      worldText(ctx, teamLabel, {
        x: leftX + panelW / 2,
        y: panelY + panelH - TEAM_LABEL_Y_OFFSET_FROM_BOTTOM - LABEL_TEXT_ADJUST,
        size: teamLabelSize,
        bold: true,
        color: worldPalette.ink.human,
        align: 'center',
      });
      worldText(ctx, 'Human + Cat', {
        x: leftX + panelW / 2,
        y: panelY + panelH - SMALL_LABEL_Y_OFFSET_FROM_BOTTOM - SMALL_LABEL_TEXT_ADJUST,
        size: PANEL_CAPTION_SIZE,
        color: worldPalette.ink.muted,
        align: 'center',
      });

      const rightX = CX + VERSUS_PANEL_GAP + (1 - eased) * CX;
      worldPlate(
        ctx,
        { x: rightX, y: panelY, w: panelW, h: panelH },
        {
          fill: BOSS_PANEL_BACKGROUNDS[intro.bossType] ?? BOSS_PANEL_DEFAULT_BG,
          border: intro.bossColor,
          borderWidth: VERSUS_PANEL_BORDER_WIDTH,
        },
      );

      ctx.save();
      if (intro.bossType === BIG_ROOSTER_BOSS_TYPE) {
        const portrait = bigRoosterPortraitPlacement();
        drawRoosterSprite(
          ctx,
          'big',
          rightX + panelW / 2 - portrait.size / 2,
          panelY + portrait.yOffset,
          portrait.size,
          {
            facingX: 0,
            facingY: BIG_ROOSTER_INTRO_FACING_Y,
            idleFrame: BIG_ROOSTER_INTRO_IDLE_FRAME,
          },
        );
      } else if (intro.bossType === KRAKEN_BOSS_TYPE) {
        const kS = KRAKEN_SPRITE_SIZE / KRAKEN_ART_HEIGHT_TILES;
        const kY = panelY + KRAKEN_PANEL_TOP_PAD + kS * KRAKEN_ART_TOP_TILES;
        drawKrakenSprite(ctx, rightX + panelW / 2 - kS / 2, kY, kS, {
          facingX: 0,
          facingY: KRAKEN_INTRO_FACING_Y,
          idleFrame: KRAKEN_INTRO_IDLE_FRAME,
        });
      } else if (intro.bossType === ELECTRIC_GOBLIN_BOSS_TYPE) {
        const portrait = electricGoblinPortraitPlacement();
        drawElectricGoblinSprite(ctx, {
          x: rightX + panelW / 2 - portrait.size / 2,
          y: panelY + portrait.yOffset,
          tileSize: portrait.size,
          facingX: ELECTRIC_GOBLIN_PORTRAIT_FACING_X,
          row: ELECTRIC_GOBLIN_PORTRAIT_STATE,
          frame: ELECTRIC_GOBLIN_PORTRAIT_FRAME,
        });
      } else if (intro.bossType === 'grotesque_spider') {
        const spS = spiderPortraitTileSize(panelW);
        const tailTop = panelY + SPIDER_PANEL_PAD;
        const tileCentreY = tailTop + GROTESQUE_SPIDER_IDLE_REACH_TILES.tail * spS;
        // Painted from above facing +Y, the orientation the fight rotates from:
        // here she faces straight down the panel at the player.
        drawGrotesqueSpiderPoseSprite(
          ctx,
          rightX + panelW / 2 - spS / 2,
          tileCentreY - spS / 2,
          spS,
          { kind: 'idle', time: t / SPIDER_FRAMES_PER_SECOND },
        );
      } else if (intro.bossType === NECROMANCER_BOSS_TYPE) {
        const nS = NECROMANCER_SPRITE_SIZE / necromancerArtHeightTiles();
        const nY = panelY + NECROMANCER_PANEL_TOP_PAD + nS * necromancerArtTopTiles();
        drawNecromancerSprite(
          ctx,
          'idle',
          'front',
          NECROMANCER_INTRO_IDLE_FRAME,
          rightX + panelW / 2 - nS / 2,
          nY,
          nS,
          false,
        );
      } else {
        const portrait = trashGremlinPortraitPlacement();
        drawTrashGremlinSprite(
          ctx,
          rightX + panelW / 2 - portrait.size / 2,
          panelY + portrait.yOffset,
          portrait.size,
          {
            facingX: 0,
            facingY: 1,
            idleFrame: TRASH_GREMLIN_PORTRAIT_FRAME,
          },
        );
      }
      ctx.restore();

      worldText(ctx, intro.bossName, {
        x: rightX + panelW / 2,
        y: panelY + panelH - TEAM_LABEL_Y_OFFSET_FROM_BOTTOM - LABEL_TEXT_ADJUST,
        size: PANEL_LABEL_SIZE,
        bold: true,
        color: intro.bossColor,
        align: 'center',
      });
      worldText(ctx, 'BOSS', {
        x: rightX + panelW / 2,
        y: panelY + panelH - SMALL_LABEL_Y_OFFSET_FROM_BOTTOM - SMALL_LABEL_TEXT_ADJUST,
        size: PANEL_CAPTION_SIZE,
        color: worldPalette.ink.muted,
        align: 'center',
      });

      const VS_BASE_SIZE = 48;
      const vsAlpha = Math.min(1, (t - VS_APPEAR_AFTER_FRAMES) / VS_FLASH_FRAMES);
      if (vsAlpha > 0) {
        const vsPulse = 1 + VS_PULSE_SCALE * Math.sin(t * VS_PULSE_SPEED);
        const vsSize = Math.floor(VS_BASE_SIZE * vsPulse);
        const VS_GLOW_BLUR = 20;
        worldText(ctx, 'VS', {
          x: CX,
          y: CY + VERSUS_VS_Y_OFFSET - Math.round(vsSize * FONT_BASELINE_FRACTION),
          size: vsSize,
          bold: true,
          color: worldPalette.ink.danger,
          align: 'center',
          alpha: vsAlpha,
          glow: true,
          glowBlur: VS_GLOW_BLUR,
        });
      }

      const framesLeft = BossIntroSystem.INTRO_VERSUS_FRAMES - t;
      if (framesLeft < FIGHT_LABEL_BEFORE_END) {
        worldText(ctx, 'FIGHT!', {
          x: CX,
          y: CY + panelH / 2 + FIGHT_Y_OFFSET - FIGHT_Y_ADJUST,
          size: FIGHT_LABEL_SIZE,
          color: worldPalette.ink.hint,
          align: 'center',
          alpha: Math.min(1, (FIGHT_LABEL_BEFORE_END - framesLeft) / FIGHT_ALPHA_RAMP),
        });
      }
    }
  }
}
