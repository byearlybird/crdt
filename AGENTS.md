# Repository Guidelines

## Project Structure

- `lib/` is the source of truth for this TypeScript package.
  - `lib/core/` contains the core CRDT-ish primitives (documents, collections, clocks, merge utilities).
  - `lib/store/` contains the higher-level store API built on top of `core`.
  - `lib/index.ts` is the public entrypoint used for builds.
- `dist/` is generated build output (ESM + `.d.ts`). Do not hand-edit.
- Tooling/config lives at the repo root: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `bun.lock`, `.oxfmtrc.json`, `.oxlintrc.json`.

## Build, Test, and Development Commands

- `bun install`: install dependencies (this repo uses Bun; prefer it over npm/pnpm/yarn).
- `bun run build`: bundle from `lib/index.ts` into `dist/` using `tsdown` (also generates types).
- `bun run dev`: watch mode build for local iteration.
- `bun test`: run all tests (Bun test runner).
- `bun run fmt` / `bun run fmt:check`: format or verify formatting with oxfmt.
- `bun run lint` / `bun run lint:fix`: lint or auto-fix linting issues with oxlint.

Examples:

- Run a single test file: `bun test lib/core/document.test.ts`
- Clean rebuild: `bun run build` (uses `clean: true` in `tsdown.config.ts`).

## Coding Style & Naming Conventions

- TypeScript ESM (`"type": "module"`). Prefer `import`/`export`; avoid CommonJS patterns.
- Formatting is enforced by oxfmt (2-space indentation, semicolons, double quotes as configured/auto-formatted). Run `bun run fmt` before pushing.
- Linting is enforced by oxlint. Run `bun run lint` to check for issues.
- Naming:
  - Types/interfaces: `PascalCase`
  - Values/functions: `camelCase`
  - Test files: `*.test.ts` colocated next to the module under `lib/**`.

## Testing Guidelines

- Tests use `bun:test` (`describe/test/expect`) and live in `lib/**/**/*.test.ts`.
- Add/adjust tests alongside behavior changes; prefer small unit tests plus targeted integration coverage (see `lib/core/integration.test.ts`).

## Commit & Pull Request Guidelines

- Commits generally follow an imperative, summary-first style (e.g., “Add …”, “Refactor …”, “Enhance …”). Keep subjects concise and scoped.
- PRs should include:
  - Clear description of behavior changes and rationale
  - Linked issue/context (if applicable)
  - Tests run (`bun test`) and any notes for reviewers

## Agent-Specific Notes

- Default to Bun commands (`bun run …`, `bun test`) and keep changes focused on `lib/`; treat `dist/` as build output.
