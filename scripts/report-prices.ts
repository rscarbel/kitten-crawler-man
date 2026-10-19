#!/usr/bin/env tsx
/**
 * Writes a price sheet for every item, shop and service to
 * `.price-report/prices.md` and prints its path. A report to read while
 * rebalancing, never a gate.
 *
 *  - **Items**: base, pricing category, whether a shop will buy it, which
 *    shops stock it, and the cheapest and dearest buy price among them.
 *  - **Shops**: each shop's modifiers as one sentence, then every catalog row
 *    at normal stock, with the last-unit price and the price after the player
 *    has sold a stack.
 *  - **Services**: every fixed fee, grouped by counter.
 *
 * Run: npm run report:prices [-- --shop <id>] [-- --item <id>]
 *
 * `--shop` narrows the sheet to one shop. `--item` narrows it to one item and
 * adds its full working (every step, its multiplier and running total) at
 * every shop that stocks it, buying and selling.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ITEM_DEF, canSellItemId, isItemId, type ItemId } from '../src/core/ItemDefs';
import { ITEM_PRICES, type ItemCategory } from '../src/economy/itemPrices';
import {
  DEFAULT_BUYBACK,
  SPECIALTY_BUYBACK,
  lineBreakdown,
  priceBreakdown,
  type PriceBreakdown,
} from '../src/economy/pricing';
import { SERVICE_PRICES } from '../src/economy/servicePrices';
import {
  SHOPS,
  catalogLineUnits,
  isShopId,
  shopDef,
  type CatalogLine,
  type ShopDef,
  type ShopId,
} from '../src/economy/shops';
import { createShopStock, shopStockKey, type ShopStock } from '../src/economy/shopStock';
import * as stockCurves from '../src/economy/stockCurves';
import type { StockCurve } from '../src/economy/stockCurves';

const REPORT_DIR = '.price-report';
const REPORT_FILE = 'prices.md';
/** The stack the "sell after selling" column assumes the player has already sold. */
const UNITS_ALREADY_SOLD = 5;
const PERCENT = 100;
const MULTIPLIER_DECIMALS = 3;
const USAGE_EXIT_CODE = 2;

const CATEGORY_PLURAL = {
  potion: 'potions',
  food: 'food',
  armor: 'armour',
  weapon: 'weapons',
  tool: 'tools',
  resource: 'resources',
  tome: 'tomes',
  magic_scroll: 'magic scrolls',
  explosive: 'explosives',
  trap: 'traps',
  environment: 'environment items',
  special: 'special items',
  quest: 'quest items',
} as const satisfies Record<ItemCategory, string>;

const SHOP_IDS: readonly ShopId[] = Object.keys(SHOPS).filter(isShopId);
const ITEM_IDS: readonly ItemId[] = Object.keys(ITEM_PRICES).filter(isItemId);

function usageError(message: string): never {
  console.error(message);
  process.exit(USAGE_EXIT_CODE);
}

/** The value after `--<name>`, validated against the ids it may name. */
function idFlag<Id extends string>(
  name: string,
  validIds: readonly Id[],
  isValid: (value: string) => value is Id,
): Id | undefined {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return undefined;
  const valueAt = at + 1;
  if (valueAt >= args.length || args[valueAt].startsWith('--')) {
    usageError(`--${name} needs a value. Valid ids:\n  ${validIds.join('\n  ')}`);
  }
  const value = args[valueAt];
  if (!isValid(value)) {
    usageError(`Unknown ${name} id "${value}". Valid ids:\n  ${validIds.join('\n  ')}`);
  }
  return value;
}

const shopFilter = idFlag('shop', SHOP_IDS, isShopId);
const itemFilter = idFlag('item', ITEM_IDS, isItemId);

/** The name of an exported curve that is this very object, or "custom" for an inline one. */
function curveName(curve: StockCurve): string {
  for (const [name, named] of Object.entries(stockCurves)) {
    if (named === curve) return name.toLowerCase().split('_').join(' ');
  }
  return 'custom';
}

function formatMultiplier(multiplier: number): string {
  return `×${Number(multiplier.toFixed(MULTIPLIER_DECIMALS))}`;
}

function formatCoins(working: number): string {
  return String(Number(working.toFixed(MULTIPLIER_DECIMALS)));
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/** Groups keys by the value they map to, so "potions and food ×1.67" reads as one clause. */
function groupByValue<Value>(entries: readonly (readonly [string, Value])[]): Map<Value, string[]> {
  const groups = new Map<Value, string[]>();
  for (const [key, value] of entries) groups.set(value, [...(groups.get(value) ?? []), key]);
  return groups;
}

function isItemCategory(value: string): value is ItemCategory {
  return value in CATEGORY_PLURAL;
}

function categoryWords(categories: readonly string[]): string[] {
  return categories.map((category) =>
    isItemCategory(category) ? CATEGORY_PLURAL[category] : category,
  );
}

function definedEntries<Value>(
  record: Partial<Record<string, Value>> | undefined,
): (readonly [string, Value])[] {
  const entries: (readonly [string, Value])[] = [];
  for (const [key, value] of Object.entries(record ?? {})) {
    if (value !== undefined) entries.push([key, value]);
  }
  return entries;
}

function itemName(id: string): string {
  return isItemId(id) ? ITEM_DEF[id].name : id;
}

/** A shop's modifiers as one plain sentence. */
function describeShop(def: ShopDef): string {
  const clauses: string[] = [];
  clauses.push(
    def.markup === 1
      ? 'Sells at base'
      : `Marks everything ${def.markup > 1 ? 'up' : 'down'} ${formatMultiplier(def.markup)}`,
  );
  for (const [multiplier, categories] of groupByValue(definedEntries(def.categoryMarkup))) {
    clauses.push(`${joinWords(categoryWords(categories))} ${formatMultiplier(multiplier)}`);
  }
  for (const [multiplier, items] of groupByValue(definedEntries(def.itemMarkup))) {
    clauses.push(`${joinWords(items.map(itemName))} ${formatMultiplier(multiplier)}`);
  }
  const specialties = def.specialties ?? [];
  clauses.push(
    specialties.length === 0
      ? `no specialty (pays ${Math.round(DEFAULT_BUYBACK * PERCENT)}%)`
      : `specialises in ${joinWords(categoryWords(specialties))} (pays ${Math.round(SPECIALTY_BUYBACK * PERCENT)}%)`,
  );
  clauses.push(`${curveName(def.stockCurve)} stock curve`);
  for (const [curve, categories] of groupByValue(definedEntries(def.categoryStockCurve))) {
    clauses.push(`${curveName(curve)} curve for ${joinWords(categoryWords(categories))}`);
  }
  if (!def.buysFromPlayer) clauses.push('buys nothing from the player');
  return `${clauses.join('; ')}.`;
}

function markupFor(def: ShopDef, item: ItemId): number {
  return def.itemMarkup?.[item] ?? def.categoryMarkup?.[ITEM_PRICES[item].category] ?? def.markup;
}

function stockWithOffset(shop: ShopId, item: ItemId, offset: number): ShopStock {
  const stock = createShopStock();
  stock.offsets[shopStockKey(shop, item)] = offset;
  return stock;
}

function shopsStocking(item: ItemId): ShopId[] {
  return SHOP_IDS.filter((shop) => shopDef(shop).catalog.some((line) => line.item === item));
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

function itemsSection(items: readonly ItemId[]): string[] {
  const normal = createShopStock();
  const rows = items.map((item) => {
    const { base, category } = ITEM_PRICES[item];
    const stockists = shopsStocking(item);
    const prices = stockists.map((shop) => priceBreakdown(shop, item, normal, 'buy').final);
    const range =
      prices.length === 0 ? ['—', '—'] : [String(Math.min(...prices)), String(Math.max(...prices))];
    return [
      `${ITEM_DEF[item].name} (\`${item}\`)`,
      String(base),
      category,
      canSellItemId(item) ? 'yes' : 'no',
      stockists.length === 0 ? '—' : stockists.join(', '),
      ...range,
    ];
  });
  return [
    '## Items',
    '',
    ...table(['Item', 'Base', 'Category', 'Sellable', 'Stocked by', 'Cheapest', 'Dearest'], rows),
    '',
  ];
}

function lineName(line: CatalogLine): string {
  const units = catalogLineUnits(line);
  return units > 1 ? `${line.label} (pack of ${units})` : line.label;
}

function catalogRow(shop: ShopId, line: CatalogLine): string[] {
  const def = shopDef(shop);
  const { item, normalStock } = line;
  const normal = createShopStock();
  const units = catalogLineUnits(line);
  const buy = lineBreakdown(shop, line, normal, 'buy').final;
  const sell = lineBreakdown(shop, line, normal, 'sell').final;
  const lastUnitAffordable = normalStock !== 'unlimited' && units === 1;
  const buyWithOneLeft = lastUnitAffordable
    ? String(lineBreakdown(shop, line, stockWithOffset(shop, item, 1 - normalStock), 'buy').final)
    : '—';
  const buysThisBack = def.buysFromPlayer && canSellItemId(item);
  const sellAfterStack = buysThisBack
    ? String(
        lineBreakdown(shop, line, stockWithOffset(shop, item, UNITS_ALREADY_SOLD), 'sell').final,
      )
    : '—';
  return [
    lineName(line),
    String(normalStock),
    String(ITEM_PRICES[item].base),
    formatMultiplier(markupFor(def, item)),
    String(buy),
    buysThisBack ? String(sell) : '—',
    buyWithOneLeft,
    sellAfterStack,
  ];
}

function shopSection(shop: ShopId): string[] {
  const def = shopDef(shop);
  const lines = [`### ${def.name} (\`${shop}\`)`, '', describeShop(def), ''];
  if (def.catalog.length === 0) return [...lines, '_No catalog lines._', ''];
  return [
    ...lines,
    ...table(
      [
        'Line',
        'Normal stock',
        'Base',
        'Markup',
        'Buy',
        'Sell',
        'Buy (one left)',
        `Sell (after ${UNITS_ALREADY_SOLD} sold)`,
      ],
      def.catalog.map((line) => catalogRow(shop, line)),
    ),
    '',
  ];
}

function servicesSection(): string[] {
  const lines = ['## Services', ''];
  for (const [counter, fees] of Object.entries(SERVICE_PRICES)) {
    lines.push(`### ${counter}`, '');
    lines.push(
      ...table(
        ['Service', 'Coins'],
        Object.entries(fees).map(([service, coins]) => [service, String(coins)]),
      ),
    );
    lines.push('');
  }
  return lines;
}

function workingLines(working: PriceBreakdown): string[] {
  const lines = [`- Base: ${working.base}`];
  for (const step of working.steps) {
    lines.push(
      `- ${step.label}: ${formatMultiplier(step.multiplier)} → ${formatCoins(step.runningTotal)}`,
    );
  }
  lines.push(`- **Final: ${working.final}** (unrounded ${formatCoins(working.unrounded)})`);
  return lines;
}

function itemBreakdownSection(item: ItemId, shops: readonly ShopId[]): string[] {
  const normal = createShopStock();
  const lines = [`## Breakdown: ${ITEM_DEF[item].name} (\`${item}\`)`, ''];
  const stockists = shops.filter((shop) => shopsStocking(item).includes(shop));
  if (stockists.length === 0) {
    if (!canSellItemId(item)) {
      return [...lines, '_Not stocked by any shop in this sheet, and no shop buys it._', ''];
    }
    lines.push('_Not stocked by any shop in this sheet; what each one would pay for it:_', '');
    for (const shop of shops) {
      if (!shopDef(shop).buysFromPlayer) continue;
      lines.push(`### ${shopDef(shop).name}: sell`, '');
      lines.push(...workingLines(priceBreakdown(shop, item, normal, 'sell')), '');
    }
    return lines;
  }
  for (const shop of stockists) {
    const def = shopDef(shop);
    for (const line of def.catalog.filter((candidate) => candidate.item === item)) {
      lines.push(`### ${def.name}: buy ${lineName(line)}`, '');
      lines.push(...workingLines(lineBreakdown(shop, line, normal, 'buy')), '');
    }
    if (def.buysFromPlayer && canSellItemId(item)) {
      lines.push(`### ${def.name}: sell`, '');
      lines.push(...workingLines(priceBreakdown(shop, item, normal, 'sell')), '');
    }
  }
  return lines;
}

const shops = shopFilter === undefined ? SHOP_IDS : [shopFilter];
const items =
  itemFilter !== undefined
    ? [itemFilter]
    : shopFilter !== undefined
      ? ITEM_IDS.filter((item) => shopsStocking(item).includes(shopFilter))
      : ITEM_IDS;

const narrowedTo = [
  shopFilter === undefined ? undefined : `shop \`${shopFilter}\``,
  itemFilter === undefined ? undefined : `item \`${itemFilter}\``,
].filter((part) => part !== undefined);

const report = [
  '# Price sheet',
  '',
  narrowedTo.length === 0
    ? 'Every price at normal stock unless a column says otherwise.'
    : `Narrowed to ${narrowedTo.join(' and ')}. Prices at normal stock unless a column says otherwise.`,
  '',
  ...itemsSection(items),
  ...(itemFilter === undefined ? [] : itemBreakdownSection(itemFilter, shops)),
  ...(itemFilter === undefined ? ['## Shops', '', ...shops.flatMap(shopSection)] : []),
  ...(shopFilter === undefined && itemFilter === undefined ? servicesSection() : []),
].join('\n');

mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = resolve(join(REPORT_DIR, REPORT_FILE));
writeFileSync(reportPath, report);
console.log(reportPath);
