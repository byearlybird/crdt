# Repository Guidelines

## Project Structure

- `lib/` is the source of truth for this TypeScript package.
  - `lib/core/` contains the core CRDT-ish primitives (documents, collections, clocks, merge utilities).
  - `lib/store/` contains the higher-level store API built on top of `core`.
  - `lib/index.ts` is the public entrypoint used for builds.
- `dist/` is generated build output (ESM + `.d.ts`). Do not hand-edit.
- Tooling/config lives at the repo root: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `pnpm-lock.yaml`, `.oxfmtrc.json`, `.oxlintrc.json`.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies (this repo uses pnpm; prefer it over npm/yarn/bun).
- `pnpm run build`: bundle from `lib/index.ts` into `dist/` using `tsdown` (also generates types).
- `pnpm run dev`: watch mode build for local iteration.
- `pnpm test`: run all tests (Vitest test runner).
- `pnpm run test:watch`: run tests in watch mode.
- `pnpm run fmt` / `pnpm run fmt:check`: format or verify formatting with oxfmt.
- `pnpm run lint` / `pnpm run lint:fix`: lint or auto-fix linting issues with oxlint.

Examples:

- Run a single test file: `pnpm test lib/core/document.test.ts`
- Clean rebuild: `pnpm run build` (uses `clean: true` in `tsdown.config.ts`).

## Coding Style & Naming Conventions

- TypeScript ESM (`"type": "module"`). Prefer `import`/`export`; avoid CommonJS patterns.
- Formatting is enforced by oxfmt (2-space indentation, semicolons, double quotes as configured/auto-formatted). Run `pnpm run fmt` before pushing.
- Linting is enforced by oxlint. Run `pnpm run lint` to check for issues.
- Naming:
  - Types/interfaces: `PascalCase`
  - Values/functions: `camelCase`
  - Test files: `*.test.ts` colocated next to the module under `lib/**`.

## Testing Guidelines

- Tests use `vitest` (`describe/test/expect`) and live in `lib/**/**/*.test.ts`.
- Add/adjust tests alongside behavior changes; prefer small unit tests plus targeted integration coverage (see `lib/core/integration.test.ts`).

## Commit & Pull Request Guidelines

- Commits generally follow an imperative, summary-first style (e.g., “Add …”, “Refactor …”, “Enhance …”). Keep subjects concise and scoped.
- PRs should include:
 - Clear description of behavior changes and rationale
 - Linked issue/context (if applicable)
 - Tests run (`pnpm test`) and any notes for reviewers

## Agent-Specific Notes

- Default to pnpm commands (`pnpm run …`, `pnpm test`) and keep changes focused on `lib/`; treat `dist/` as build output.
