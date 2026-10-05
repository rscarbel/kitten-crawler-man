/**
 * The Desperado Club's VIP Lounge: three paid services as cards, each with
 * its own button, the lounge's last word above them and a way out below.
 * Every button but Leave spends coins, so Leave is the one a bare accept
 * press answers.
 */

import { partyCoins } from '../../../core/partyCoins';
import type { ClubVipLoungeSystem, VipServiceCard } from '../../../systems/ClubVipLoungeSystem';
import { centerIn, inset, splitH, splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { skinsFor } from '../../theme/skins';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { card } from '../../widgets/card';
import { panel } from '../../widgets/panel';
import { lineHeightOf, text } from '../../widgets/text';
import { coinPurse, measureCoinPurse } from './shopParts';
import type { ShopParty } from './shopSession';

const TITLE = 'VIP Lounge';
const SUBTITLE = 'A hush-quiet back room — velvet, privacy, and comped luxury.';
const LEAVE_LABEL = 'Leave the Lounge';
/** A service's description wraps to at most this many lines. */
const DESC_MAX_LINES = 2;

export interface VipLoungeScreenOptions {
  readonly id: string;
  readonly lounge: ClubVipLoungeSystem;
  readonly party: () => ShopParty;
}

function cardHeight(ui: Ui): number {
  const skin = skinsFor(ui.theme).panel.raised;
  const body = lineHeightOf(ui, 'secondary') * DESC_MAX_LINES + lineHeightOf(ui, 'caption');
  return skin.padding * 2 + lineHeightOf(ui, 'title') + ui.theme.space.sm + body;
}

/** The lounge as a surface: halts the world and keeps the keyboard; Escape and Leave close it. */
export function vipLoungeSurface(opts: VipLoungeScreenOptions): Surface {
  const { lounge } = opts;
  const close = (): void => lounge.close();
  return {
    id: opts.id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => lounge.open,
    close,
    render: (ui) => {
      const party = opts.party();
      const services = lounge.serviceCards(party.active, party.companion);
      const { space } = ui.theme;
      const lineH = lineHeightOf(ui, 'body');
      const cardH = cardHeight(ui);
      const contentHeight =
        lineH + space.md + services.length * cardH + Math.max(0, services.length - 1) * space.sm;
      panel(ui, {
        id: opts.id,
        title: TITLE,
        subtitle: SUBTITLE,
        width: 'md',
        height: 'content',
        contentHeight,
        scrollBody: true,
        onClose: close,
        footer:
          ui.size === 'compact'
            ? undefined
            : [
                {
                  id: 'leave',
                  label: LEAVE_LABEL,
                  variant: 'secondary',
                  primary: true,
                  onTap: close,
                },
              ],
        content: (body) => {
          const tracks = [lineH, ...services.map(() => cardH)];
          const [lineRow, ...cells] = splitV({ ...body, h: contentHeight }, tracks, space.sm);
          const coins = partyCoins(party.active, party.companion);
          const purseW = measureCoinPurse(ui, coins);
          coinPurse(ui, { ...lineRow, x: lineRow.x + lineRow.w - purseW, w: purseW }, coins);
          text(ui, inset(lineRow, { r: purseW + space.sm }), {
            text: lounge.feedback,
            role: 'accent',
          });
          services.forEach((service, index) => {
            serviceCard(ui, cells[index], opts.id, service, () =>
              lounge.activate(service.kind, party.active, party.companion),
            );
          });
        },
      });
    },
  };
}

const SHORT_OF_COINS = 'Not enough coins.';

/** Why a service's button is off: its own status when it has one, else the purse. */
function disabledReason(service: VipServiceCard): string {
  return service.statusLine === '' ? SHORT_OF_COINS : service.statusLine;
}

function serviceCard(
  ui: Ui,
  rect: Rect,
  surfaceId: string,
  service: VipServiceCard,
  onTap: () => void,
): void {
  const { space, palette } = ui.theme;
  const result = card(ui, rect, {
    id: `${surfaceId}/${service.kind}`,
    title: service.name,
    accent: palette.accent.base,
  });
  const buttonW = measureButton(ui, { label: service.actionLabel, size: 'md' });
  const [copy, action] = splitH(result.body, ['fill', buttonW], space.md);
  const descH = lineHeightOf(ui, 'secondary') * DESC_MAX_LINES;
  const [descRect, statusRect] = splitV(copy, [descH, 'fill'], 0);
  text(ui, descRect, {
    text: service.desc,
    role: 'secondary',
    wrap: true,
    maxLines: DESC_MAX_LINES,
  });
  if (service.statusLine !== '') {
    text(ui, statusRect, { text: service.statusLine, role: 'muted' });
  }
  const buttonRect = centerIn(
    { ...action, y: rect.y, h: rect.h },
    action.w,
    buttonHeight(ui, 'md'),
  );
  button(ui, buttonRect, {
    id: `${surfaceId}/${service.kind}/buy`,
    label: service.actionLabel,
    variant: 'primary',
    disabled: service.disabled ? disabledReason(service) : false,
    onTap,
  });
}
