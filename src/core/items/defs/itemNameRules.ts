/**
 * Naming rule for gear: a word that names a kind of garment or weapon belongs
 * to the one sub-slot that kind goes in. A "Harness" is a vest, so no coat may
 * be called one; two pieces share such a word only when they compete for the
 * same sub-slot and so can never be worn together. A name need not use any of
 * these words.
 *
 * Checked by the compiler: `defineItemDefs` refuses a definition whose name
 * holds another sub-slot's word, with an `__error` naming the item, its name
 * and the sub-slot the word belongs to. Words are matched whole, after
 * lower-casing and splitting on spaces and hyphens, so "Tin Claw Caps" holds
 * "caps" but not "cap", and "Stoneheart" is not "stone".
 */

import type { ItemSubSlot } from './ItemDefs';

/** The words each sub-slot owns, lower case. */
export interface ItemNameSubSlotRules {
  readonly Main: 'sword' | 'shiv' | 'wrench' | 'sling' | 'axe' | 'spade' | 'club';
  readonly Off: 'buckler' | 'shield';
  readonly Claws: 'claw' | 'claws' | 'talons';
  readonly Relic: 'wisp' | 'stone' | 'seed';
  readonly Hat: 'hat' | 'cap' | 'hood' | 'hardhat' | 'helmet' | 'helm' | 'crest' | 'halo';
  readonly Face: 'goggles' | 'specs' | 'monocle' | 'mask';
  readonly Neck: 'pendant' | 'amulet' | 'locket' | 'collar';
  readonly Shirt: 'shirt' | 'vest' | 'harness' | 'apron';
  readonly Jacket: 'jacket' | 'coat' | 'tailcoat' | 'hoodie';
  readonly Back: 'mantle' | 'cloak' | 'duster' | 'cape';
  readonly Pants: 'pants' | 'trousers';
  readonly Knees: 'kneeguards' | 'kneepads';
  readonly Gloves: 'gloves' | 'gauntlet' | 'wraps' | 'bracers';
  readonly Shoes: 'boots' | 'booties' | 'shoes';
  readonly Trinket: 'charm' | 'bangle' | 'ring' | 'penny';
}

type RuledSubSlot = keyof ItemNameSubSlotRules & ItemSubSlot;

/** Splits on `Separator`, keeping every piece. */
type SplitOn<
  S extends string,
  Separator extends string,
> = S extends `${infer Head}${Separator}${infer Rest}` ? Head | SplitOn<Rest, Separator> : S;

/** The whole words of a name, lower case: split on spaces, then on hyphens. */
export type NameWords<Name extends string> = SplitOn<SplitOn<Lowercase<Name>, ' '>, '-'>;

/** Whether `Name` holds one of `Keywords` as a whole word. */
export type ContainsKeyword<Name extends string, Keywords extends string> = [
  Extract<NameWords<Name>, Keywords>,
] extends [never]
  ? false
  : true;

/** Every sub-slot whose words `Name` uses. */
export type MatchingSlots<Name extends string> = {
  [Slot in RuledSubSlot]: ContainsKeyword<Name, ItemNameSubSlotRules[Slot]> extends true
    ? Slot
    : never;
}[RuledSubSlot];

/** `unknown` when `Name` uses only `Slot`'s words; otherwise an error shape that names the clash. */
export type ValidItemName<Id, Name extends string, Slot extends ItemSubSlot> = [
  Exclude<MatchingSlots<Name>, Slot>,
] extends [never]
  ? unknown
  : {
      readonly __error: 'item name uses a word that belongs to another sub-slot';
      readonly __item: Id;
      readonly __name: Name;
      readonly __slot: Exclude<MatchingSlots<Name>, Slot>;
    };

/** Each entry of `T` checked by {@link ValidItemName}; entries that are not gear pass. */
export type ValidateItemNames<T> = {
  [Id in keyof T]: T[Id] extends {
    readonly name: infer Name extends string;
    readonly equipSubSlot: infer Slot extends ItemSubSlot;
  }
    ? ValidItemName<Id, Name, Slot>
    : unknown;
};

/**
 * Returns `defs` unchanged, refusing to compile when a piece's name uses a
 * word another sub-slot owns. `const` keeps each name's literal type.
 */
export function defineItemDefs<const T>(defs: T & ValidateItemNames<T>): T {
  return defs;
}
