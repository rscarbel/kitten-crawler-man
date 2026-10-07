/**
 * What every `verify:construction-contracts` section shares: the runner's
 * recorder, the materials a contract is costed in, and the party-stock reads
 * and writes the flow checks spend from.
 */

import type {
  ContractMaterialId,
  ContractSpotCost,
} from '../../src/systems/constructionContracts/contractCatalog';

/** The runner's pass/fail recorder, handed in so every section counts toward one verdict. */
export type Check = (ok: boolean, label: string) => void;

export const CONTRACT_MATERIALS: readonly ContractMaterialId[] = ['wood_board', 'rope', 'stone'];

/** Comfortably more of every material than any one contract's bill. */
export const PLENTY_OF_EACH_MATERIAL = 60;

interface StockHolder {
  readonly inventory: {
    countOf(id: ContractMaterialId): number;
    addItem(id: ContractMaterialId, quantity: number): boolean;
  };
}

/** What the two crawlers hold of each material between them. */
export function partyStock(human: StockHolder, cat: StockHolder): ContractSpotCost {
  return {
    wood_board: human.inventory.countOf('wood_board') + cat.inventory.countOf('wood_board'),
    rope: human.inventory.countOf('rope') + cat.inventory.countOf('rope'),
    stone: human.inventory.countOf('stone') + cat.inventory.countOf('stone'),
  };
}

/** `before − after` of each material. */
export function stockSpent(before: ContractSpotCost, after: ContractSpotCost): ContractSpotCost {
  return {
    wood_board: before.wood_board - after.wood_board,
    rope: before.rope - after.rope,
    stone: before.stone - after.stone,
  };
}

export function sameCost(a: ContractSpotCost, b: ContractSpotCost): boolean {
  return CONTRACT_MATERIALS.every((material) => a[material] === b[material]);
}

export function stockUp(holder: StockHolder, each: number): void {
  for (const material of CONTRACT_MATERIALS) holder.inventory.addItem(material, each);
}
