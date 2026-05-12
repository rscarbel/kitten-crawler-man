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

Never reach for `ctx.fillText`, `ctx.strokeText`, `ctx.fillRect` for UI chrome when these utilities already handle the pattern — raw `ctx` calls are fine only for game-world rendering (sprites, particles, geometry) where the utilities don't apply.

## Validation Gates

Before considering work complete, **both checks must pass**:

1. **Typecheck:** `npm run typecheck` — must exit 0 with no errors.
2. **Lint:** `npm run lint` — must exit 0 with no errors.

Run these after making changes. If any gate fails, fix the issue before proceeding. Do not skip or ignore failures.
