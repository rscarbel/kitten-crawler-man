/**
 * The "how it works" explainers for the craft skills, behind one handle.
 *
 * Each craft skill has its own paged explainer, but only one is ever up at a
 * time, and every scene has to treat whichever it is the same way: claim the
 * screen, route clicks and Escape to it, draw it over the pause menu. Holding
 * them here means a scene wires that once, and a craft skill that gains an
 * explainer later only registers it.
 */

import type { CraftSkillId } from '../core/CraftSkills';

/** What a craft skill's explainer has to offer to be hosted here. */
export interface CraftExplainer {
  readonly isOpen: boolean;
  /** The focus-ring id its buttons register under, which the scene's overlay claim names. */
  readonly focusId: string;
  open(): void;
  close(): void;
  advance(): void;
  handleClick(mx: number, my: number): boolean;
  render(ctx: CanvasRenderingContext2D): void;
}

/** The claim id used while none is open, so a claim built from this host always names something. */
const NO_EXPLAINER_FOCUS_ID = 'craft-explainer';

export class CraftExplainers {
  private readonly explainers = new Map<CraftSkillId, CraftExplainer>();

  register(id: CraftSkillId, explainer: CraftExplainer): void {
    this.explainers.set(id, explainer);
  }

  /** Opens the explainer for `id`. Returns false when that skill has none. */
  open(id: CraftSkillId): boolean {
    const explainer = this.explainers.get(id);
    if (explainer === undefined) return false;
    this.close();
    explainer.open();
    return true;
  }

  private get current(): CraftExplainer | null {
    for (const explainer of this.explainers.values()) {
      if (explainer.isOpen) return explainer;
    }
    return null;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  get focusId(): string {
    return this.current?.focusId ?? NO_EXPLAINER_FOCUS_ID;
  }

  close(): void {
    this.current?.close();
  }

  advance(): void {
    this.current?.advance();
  }

  handleClick(mx: number, my: number): boolean {
    return this.current?.handleClick(mx, my) ?? false;
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.current?.render(ctx);
  }
}
