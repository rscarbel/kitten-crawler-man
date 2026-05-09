import { type Player } from '../../Player';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { menuBtn, type ButtonRect, type PauseTab } from './types';
import { drawText } from '../TextBox';
import { drawBox, drawDivider, drawScrollbar } from '../Box';

type StatDef = {
  key: 'STR' | 'INT' | 'CON' | 'EXP';
  name: string;
  description: string;
  accent: string;
  dimBorder: string;
  cardBg: string;
  getValue: (p: Player) => number;
};

const HUMAN_STAT_DEFS: StatDef[] = [
  {
    key: 'STR',
    name: 'Strength',
    description: 'Hit harder. Each point raises melee damage by 1.',
    accent: '#f97316',
    dimBorder: 'rgba(249,115,22,0.22)',
    cardBg: '#160b02',
    getValue: (p) => p.strength,
  },
  {
    key: 'EXP',
    name: 'Explosives Handling',
    description: 'Bigger booms. Boosts dynamite damage & throw range.',
    accent: '#fbbf24',
    dimBorder: 'rgba(251,191,36,0.22)',
    cardBg: '#16110a',
    getValue: (p) => (p instanceof HumanPlayer ? p.explosivesHandling : 0),
  },
  {
    key: 'CON',
    name: 'Constitution',
    description: 'Toughen up. Each point grants +2 maximum HP.',
    accent: '#4ade80',
    dimBorder: 'rgba(74,222,128,0.22)',
    cardBg: '#031208',
    getValue: (p) => p.constitution,
  },
];

const CAT_STAT_DEFS: StatDef[] = [
  {
    key: 'STR',
    name: 'Strength',
    description: 'Sharper claws. Each point raises claw attack damage.',
    accent: '#f97316',
    dimBorder: 'rgba(249,115,22,0.22)',
    cardBg: '#160b02',
    getValue: (p) => p.strength,
  },
  {
    key: 'INT',
    name: 'Intelligence',
    description: 'Think bigger. Amplifies magic missile power & range.',
    accent: '#818cf8',
    dimBorder: 'rgba(129,140,248,0.22)',
    cardBg: '#08061a',
    getValue: (p) => p.intelligence,
  },
  {
    key: 'CON',
    name: 'Constitution',
    description: 'Nine lives. Each point grants +2 maximum HP.',
    accent: '#4ade80',
    dimBorder: 'rgba(74,222,128,0.22)',
    cardBg: '#031208',
    getValue: (p) => p.constitution,
  },
];

const CARD_H = 70;
const CARD_GAP = 6;
const BTN_W = 32;
const BTN_H = 26;

function renderStatCard(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  localX: number,
  localY: number,
  scrollTop: number,
  scrollY: number,
  scrollH: number,
  w: number,
  stat: StatDef,
  player: Player,
  hasPoints: boolean,
): void {
  const BORDER_W = 3;
  const PAD = 10;

  ctx.fillStyle = hasPoints ? stat.cardBg : '#0c1118';
  ctx.fillRect(localX, localY, w, CARD_H);

  ctx.fillStyle = hasPoints ? stat.accent : '#475569';
  ctx.fillRect(localX, localY, BORDER_W, CARD_H);

  ctx.strokeStyle = hasPoints ? stat.dimBorder : 'rgba(51,65,85,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(localX, localY, w, CARD_H);

  const textX = localX + BORDER_W + PAD;
  const accentColor = hasPoints ? stat.accent : '#64748b';
  const rightEdge = localX + w - 8;

  drawText(ctx, stat.name.toUpperCase(), {
    x: textX,
    y: localY + 9,
    bold: true,
    size: 12,
    color: accentColor,
  });

  drawText(ctx, 'Current level', {
    x: rightEdge,
    y: localY + 9,
    size: 8,
    color: hasPoints ? '#475569' : '#64748b',
    align: 'right',
  });

  drawText(ctx, String(stat.getValue(player)), {
    x: rightEdge,
    y: localY + 22,
    bold: true,
    size: 13,
    color: accentColor,
    align: 'right',
  });

  const descMaxW = w - (BORDER_W + PAD) - (hasPoints ? BTN_W + 24 : PAD);
  drawText(ctx, stat.description, {
    x: textX,
    y: localY + 40,
    size: 10,
    color: hasPoints ? '#64748b' : '#475569',
    width: descMaxW,
  });

  if (hasPoints) {
    const btnLocalX = localX + w - BTN_W - 8;
    const btnLocalY = localY + 40;
    const btnScreenY = btnLocalY + scrollTop - scrollY;

    drawBox(ctx, {
      x: btnLocalX,
      y: btnLocalY,
      width: BTN_W,
      height: BTN_H,
      fill: stat.cardBg,
      border: stat.accent,
      borderWidth: 1.5,
    });
    drawText(ctx, '+', {
      x: btnLocalX + BTN_W / 2,
      y: btnLocalY + (BTN_H - 14) / 2,
      bold: true,
      size: 14,
      color: stat.accent,
      align: 'center',
    });

    if (btnLocalY + BTN_H > scrollY && btnLocalY < scrollY + scrollH) {
      buttons.push({
        x: btnLocalX,
        y: btnScreenY,
        w: BTN_W,
        h: BTN_H,
        action: () => player.spendPoint(stat.key),
      });
    }
  }
}

export function renderSpendTab(
  ctx: CanvasRenderingContext2D,
  buttons: ButtonRect[],
  bx: number,
  by: number,
  bw: number,
  bh: number,
  human: HumanPlayer,
  cat: CatPlayer,
  setTab: (tab: PauseTab) => void,
  scrollY = 0,
): number {
  drawText(ctx, 'SPEND SKILL POINTS', {
    x: bx + bw / 2,
    y: by + 16,
    bold: true,
    size: 16,
    color: '#f1f5f9',
    align: 'center',
  });
  drawText(ctx, 'Grow stronger between battles', {
    x: bx + bw / 2,
    y: by + 36,
    size: 10,
    color: '#475569',
    align: 'center',
  });

  drawDivider(ctx, { x: bx + 20, y: by + 50, length: bw - 40 });

  const BACK_BTN_H = 52;
  const scrollTop = by + 56;
  const scrollBot = by + bh - BACK_BTN_H;
  const scrollH = scrollBot - scrollTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, scrollTop, bw, scrollH);
  ctx.clip();
  ctx.translate(0, scrollTop - scrollY);

  let y = 8;

  const pairs: [Player, string, StatDef[], string][] = [
    [human, 'Human', HUMAN_STAT_DEFS, '#93c5fd'],
    [cat, 'Cat', CAT_STAT_DEFS, '#fb923c'],
  ];

  for (const [player, charName, statDefs, nameColor] of pairs) {
    const hasPoints = player.unspentPoints > 0;

    drawText(ctx, `${charName}  ·  Level ${player.level}`, {
      x: bx + 20,
      y: y,
      bold: true,
      size: 13,
      color: nameColor,
    });

    if (hasPoints) {
      const pts = player.unspentPoints;
      const ptsLabel = `${pts} point${pts !== 1 ? 's' : ''} to spend`;
      drawText(ctx, ptsLabel, {
        x: bx + bw - 20,
        y: y,
        bold: true,
        size: 11,
        color: '#fbbf24',
        align: 'right',
      });
    } else {
      drawText(ctx, 'no points available', {
        x: bx + bw - 20,
        y: y + 1,
        size: 10,
        color: '#64748b',
        align: 'right',
      });
    }

    y += 20;

    const cardX = bx + 16;
    const cardW = bw - 32;
    for (const stat of statDefs) {
      renderStatCard(
        ctx,
        buttons,
        cardX,
        y,
        scrollTop,
        scrollY,
        scrollH,
        cardW,
        stat,
        player,
        hasPoints,
      );
      y += CARD_H + CARD_GAP;
    }

    y += 14;

    drawDivider(ctx, { x: bx + 20, y, length: bw - 40, color: '#1e293b' });

    y += 14;
  }

  const contentHeight = y;
  ctx.restore();

  drawScrollbar(ctx, {
    x: bx + bw - 7,
    trackY: scrollTop,
    trackH: scrollH,
    contentH: contentHeight,
    scrollY,
    width: 3,
  });

  const btnY = by + bh - BACK_BTN_H + 8;
  menuBtn(ctx, buttons, bx + 20, btnY, bw - 40, 36, 'Back', () => setTab('main'));

  return contentHeight;
}
