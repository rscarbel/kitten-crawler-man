# CLAUDE.md

## Agent Configuration

Sub-agents should be used liberally for parallelizable work: running checks, exploring code, researching before implementing.

## Type Safety

Type safety is the highest priority in this codebase. The tsconfig has strict mode and every strict flag enabled — honor that rigorously.

- **No type casting.** Do not use `as` to cast types. If the type system disagrees with you, fix the types or restructure the code so the types flow naturally. The only acceptable exception is `as const`.
- **No non-null assertions.** Never use the `!` (bang) operator. Handle `null`/`undefined` explicitly with narrowing, nullish coalescing (`??`), or optional chaining (`?.`).
- **No `any`.** The linter already enforces `@typescript-eslint/no-explicit-any` as an error — never circumvent it. Use `unknown` and narrow, or use proper generics.
- **Use type utilities.** Prefer `Partial`, `Required`, `Pick`, `Omit`, `Record`, `Extract`, `Exclude`, `NonNullable`, `ReturnType`, `Parameters`, etc. over hand-rolling equivalent types.
- **Infer where possible.** Let TypeScript infer return types and variable types when the inference is clear. Add explicit annotations when inference is ambiguous or at module boundaries.

- if you discover a case of a violation of any of these rules, consider it in-scope to fix it, even if it is a pre-existing violation

## Canvas UI Utilities

Prefer the shared utilities in `src/ui/` over raw `ctx` calls:

- **`src/ui/TextBox.ts`** — `drawText()` for all canvas text. Handles font, color, outline, glow, word-wrap, and alignment in one call. Use `TEXT_PRESETS` for common styles (`danger`, `heading`, `label`, `value`, etc.).
- **`src/ui/Box.ts`** — `drawBox()` / `drawModal()` for panels, dialogs, and containers; `drawProgressBar()` for fill bars; `drawOverlay()` for full-screen tints. Use `BOX_PRESETS` (e.g. `panel`, `modal`, `danger`) and `PROGRESS_PRESETS` (e.g. `hp`, `stamina`) for consistent styling.
- **`src/ui/Button.ts`** — `drawButton()` for all canvas buttons. Handles fill, border, radius, hover brightening, press darkening, label rendering, word-wrap, glow, and shadow in one call. Use `BUTTON_PRESETS` for common styles (`primary`, `danger`, `success`, `gold`, `toggle`, `mobile`, etc.). Call `setButtonMouseState(mx, my)` once per render frame so hover/press state flows automatically to every button. Call `playButtonSound(audio)` from every `handleClick` that activates a button. Use `addButton()` (draw + register hit-rect in one call) for menu-style buttons with action callbacks. If a button needs a visual not covered by existing presets, add a new preset to `BUTTON_PRESETS` rather than hand-rolling the style inline.

Never reach for `ctx.fillText`, `ctx.strokeText`, `ctx.fillRect` for UI chrome when these utilities already handle the pattern — raw `ctx` calls are fine only for game-world rendering (sprites, particles, geometry) where the utilities don't apply.

## Code Clarity

**Comments explain *why*, never *what*.** Well-named identifiers already say what code does — a comment restating that is noise. Only write a comment when something would surprise a reader: a hidden constraint, a subtle invariant, a non-obvious workaround, or a reason that can't be inferred from the names alone. If removing a comment wouldn't confuse a future reader, don't write it. When you encounter a pre-existing "what" comment while editing, remove it.

**JSDoc is an exception.** Public functions and types benefit from JSDoc when it adds meaning beyond the signature — keep and write these freely.

**Prefer named variables over comments and over terse one-liners.** If an expression is complex or its intent is unclear, extract it into a well-named variable rather than explaining it with a comment. Even if the variable doesn't affect performance and a one-liner would work, prefer the named variable when it makes the purpose obvious to a reader. More lines of obviously clear code is better than fewer lines of opaque code.

**No magic numbers.** Every numeric literal whose meaning isn't self-evident must be extracted into a named constant. This codebase accumulates lots of numbers (frame counts, tile sizes, damage values, pixel offsets, timers) — unnamed literals make them all look the same and make future changes brittle. When you encounter a pre-existing magic number while editing, refactor it into a named constant as part of that edit. Name the constant after what the number *means*, not what it *is* (e.g. `TONGUE_STRIKE_FRAMES = 18`, not `FRAMES_18`).

## Validation Gates

Before considering work complete, **both checks must pass**:

1. **Typecheck:** `npm run typecheck` — must exit 0 with no errors.
2. **Lint:** `npm run lint` — must exit 0 with no errors.

Run these after making changes. If any gate fails, fix the issue before proceeding. Do not skip or ignore failures.

In addition to the checks, make sure the code has been formatted: `npm run format`
