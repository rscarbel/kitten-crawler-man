/**
 * The shared frame for localhost-only review scenes (creature previews, art
 * benches): a header strip with a title, an optional back button, a wrapping
 * row of control buttons and captions (a right-aligned column, or wrapped rows
 * under the controls when a caption is too long for the column), all drawn
 * with widgets through the scene's own `UiRoot`. A subclass paints its art in
 * `render`, then calls {@link PreviewScene.renderChrome} last so the header
 * sits on top and owns the clicks that land on it.
 */

import { Scene } from '../core/Scene';
import { inset, type Rect } from '../ui/core/geom';
import { PRIMARY_BUTTON } from '../ui/core/pointer';
import { UiRoot, type Surface, type Ui, type WorldGesture } from '../ui/core/UiRoot';
import { browserViewportInput } from '../ui/core/viewport';
import { buttonHeight, button, measureButton } from '../ui/widgets/button';
import { card } from '../ui/widgets/card';
import { iconButton, iconButtonSize } from '../ui/widgets/iconButton';
import { lineHeightOf, measureText, measureTextHeight, text } from '../ui/widgets/text';
import { skinsFor } from '../ui/theme/skins';

/** One header button. Its label is re-read every frame, so it can show the current setting. */
export interface PreviewControl {
  readonly label: string;
  readonly onTap: () => void;
  /** Unique among the controls; defaults to the label, so give one when the label changes. */
  readonly id?: string;
  readonly selected?: boolean;
}

const HEADER_SURFACE_ID = 'preview-header';
const HEADER_WIDGET_ID = 'header';
const CONTROL_SIZE = 'sm';
/**
 * The widest share of the header the right-hand caption column may take. A
 * caption longer than that would squeeze the controls into a single column, so
 * the captions move under the controls and wrap at full width instead.
 */
const CAPTION_COLUMN_MAX_SHARE = 0.4;

interface PlacedCaption {
  readonly caption: string;
  readonly rect: Rect;
}

interface HeaderLayout {
  readonly frame: Rect;
  readonly title: Rect;
  readonly back: Rect | null;
  readonly controls: readonly { readonly control: PreviewControl; readonly rect: Rect }[];
  readonly captions: readonly PlacedCaption[];
  /** Right-aligned single lines in a top-right column, or wrapped left-aligned rows under the controls. */
  readonly captionsBeside: boolean;
}

export abstract class PreviewScene extends Scene {
  readonly ui: UiRoot;
  /** Bottom edge of the header in UI units, as of the last frame. */
  private headerBottomUnits = 0;

  constructor() {
    super();
    this.ui = new UiRoot({
      audio: null,
      viewport: browserViewportInput,
      handleWorldPointer: (gesture) => {
        const isWheel = gesture.kind === 'wheel';
        const isPrimaryPress = gesture.button === PRIMARY_BUTTON;
        if (isWheel || isPrimaryPress) this.handlePreviewWorldPointer?.(gesture);
      },
    });
    this.ui.mount(this.headerSurface());
  }

  /** The heading, conventionally `"<name> preview — ?<route>"`. */
  protected abstract previewTitle(): string;

  /** The header's buttons, left to right; they wrap onto more rows when the screen is narrow. */
  protected abstract previewControls(): readonly PreviewControl[];

  /** Short status lines (the current backdrop, a frame counter), shown at the top right when they fit. */
  protected previewCaptions(): readonly string[] {
    return [];
  }

  /** When present, a back button leads the title and calls this. */
  protected previewBack?(): void;

  /** A primary-button press (or a wheel turn) on the art below the header. */
  protected handlePreviewWorldPointer?(gesture: WorldGesture): void;

  /** Canvas pixels from the top of the screen to just below the header, for laying the art out under it. */
  protected get headerBottom(): number {
    return this.headerBottomUnits * this.ui.uiScale;
  }

  /** Draws the header over whatever the scene has painted. Call last in `render`. */
  protected renderChrome(ctx: CanvasRenderingContext2D): void {
    this.ui.frame(ctx);
  }

  private headerSurface(): Surface {
    return {
      id: HEADER_SURFACE_ID,
      band: 'hud',
      haltsWorld: false,
      isOpen: () => true,
      render: (ui) => {
        this.renderHeader(ui);
      },
    };
  }

  private layoutHeader(
    ui: Ui,
    controls: readonly PreviewControl[],
    captions: readonly string[],
  ): HeaderLayout {
    const { space } = ui.theme;
    const padding = skinsFor(ui.theme).panel.hud.padding;
    const outer = inset(ui.viewport, space.sm);
    const titleHeight = lineHeightOf(ui, 'title');
    const captionHeight = lineHeightOf(ui, 'caption');
    const captionWidth = Math.max(
      0,
      ...captions.map((caption) => measureText(ui, caption, { role: 'caption' })),
    );
    const innerLeft = outer.x + padding;
    const innerRight = outer.x + outer.w - padding;
    const innerWidth = Math.max(0, innerRight - innerLeft);
    const captionColumnLimit = innerWidth * CAPTION_COLUMN_MAX_SHARE;
    const captionsBeside = captionWidth <= captionColumnLimit;
    const captionColumn = captionsBeside && captionWidth > 0 ? captionWidth + space.lg : 0;
    const contentLeft = innerLeft;
    const contentRight = innerRight - captionColumn;
    const contentTop = outer.y + padding;

    const hasBack = this.previewBack !== undefined;
    const backSide = iconButtonSize(ui, CONTROL_SIZE);
    const back: Rect | null = hasBack
      ? {
          x: contentLeft,
          y: contentTop + (titleHeight - backSide) / 2,
          w: backSide,
          h: backSide,
        }
      : null;
    const titleLeft = back === null ? contentLeft : contentLeft + backSide + space.sm;
    const title: Rect = {
      x: titleLeft,
      y: contentTop,
      w: Math.max(0, contentRight - titleLeft),
      h: titleHeight,
    };

    const rowHeight = buttonHeight(ui, CONTROL_SIZE);
    const placed: { control: PreviewControl; rect: Rect }[] = [];
    let cursorX = contentLeft;
    let cursorY = contentTop + titleHeight + space.sm;
    for (const control of controls) {
      const width = measureButton(ui, { label: control.label, size: CONTROL_SIZE });
      const overflows = cursorX > contentLeft && cursorX + width > contentRight;
      if (overflows) {
        cursorX = contentLeft;
        cursorY += rowHeight + space.xs;
      }
      placed.push({ control, rect: { x: cursorX, y: cursorY, w: width, h: rowHeight } });
      cursorX += width + space.xs;
    }
    const controlsBottom = controls.length > 0 ? cursorY + rowHeight : contentTop + titleHeight;
    const placedCaptions: PlacedCaption[] = [];
    let captionsBottom = contentTop;
    if (captionsBeside) {
      captions.forEach((caption, index) => {
        placedCaptions.push({
          caption,
          rect: {
            x: innerRight - captionWidth,
            y: contentTop + index * captionHeight,
            w: captionWidth,
            h: captionHeight,
          },
        });
      });
      captionsBottom = contentTop + captions.length * captionHeight;
    } else {
      let captionY = controlsBottom + space.sm;
      for (const caption of captions) {
        const height = measureTextHeight(ui, innerWidth, { text: caption, role: 'caption' });
        placedCaptions.push({
          caption,
          rect: { x: innerLeft, y: captionY, w: innerWidth, h: height },
        });
        captionY += height;
      }
      captionsBottom = captionY;
    }
    const contentBottom = Math.max(controlsBottom, captionsBottom);
    const frame: Rect = {
      x: outer.x,
      y: outer.y,
      w: outer.w,
      h: contentBottom + padding - outer.y,
    };
    return { frame, title, back, controls: placed, captions: placedCaptions, captionsBeside };
  }

  private renderHeader(ui: Ui): void {
    const controls = this.previewControls();
    const captions = this.previewCaptions();
    const layout = this.layoutHeader(ui, controls, captions);
    this.headerBottomUnits = layout.frame.y + layout.frame.h;

    ui.block(layout.frame);
    card(ui, layout.frame, { id: HEADER_WIDGET_ID, kind: 'hud' });
    if (layout.back !== null) {
      iconButton(ui, layout.back, {
        id: 'back',
        icon: 'back',
        label: 'Back',
        size: CONTROL_SIZE,
        variant: 'ghost',
        onTap: () => {
          this.previewBack?.();
        },
      });
    }
    text(ui, layout.title, { text: this.previewTitle(), role: 'title' });

    for (const { control, rect } of layout.controls) {
      button(ui, rect, {
        id: control.id,
        label: control.label,
        size: CONTROL_SIZE,
        selected: control.selected,
        onTap: control.onTap,
      });
    }

    for (const { caption, rect } of layout.captions) {
      text(ui, rect, {
        text: caption,
        role: 'caption',
        align: layout.captionsBeside ? 'right' : 'left',
        wrap: !layout.captionsBeside,
      });
    }
  }
}
