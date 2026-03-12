# Repository Guidelines

## Project Structure

- `src/` is the source of truth for this TypeScript package.
  - `src/crdt/` contains the core CRDT primitives (atoms, documents, stamps, types).
  - `src/api/` contains higher-level factories like the clock API.
  - `src/sync/` contains sync utilities (hash-based diffing, cipher for transport encryption).
  - `src/utils/` contains shared utilities (object flattening, hashing).
  - `src/index.ts` is the public entrypoint used for builds.
- `test/` contains all test files, mirroring the `src/` directory structure.
- `dist/` is generated build output (ESM + `.d.ts`). Do not hand-edit.
- Tooling/config lives at the repo root: `package.json`, `tsconfig.json`, `build.ts`, `.oxfmtrc.json`, `.oxlintrc.json`.

## Build, Test, and Development Commands

- `bun install`: install dependencies (this repo uses Bun; prefer it over npm/pnpm/yarn).
- `bun run build`: bundle from `src/index.ts` into `dist/` using Bun bundler + tsc for declarations.
- `bun run dev`: watch mode build for local iteration.
- `bun test`: run all tests (Bun test runner).
- `bun test test/crdt/document.test.ts`: run a single test file.
- `bun run fmt` / `bun run fmt:check`: format or verify formatting with oxfmt.
- `bun run lint` / `bun run lint:fix`: lint or auto-fix linting issues with oxlint.
- `bun run typecheck`: type-check with tsc.

## Coding Style & Naming Conventions

- TypeScript ESM (`"type": "module"`). Prefer `import`/`export`; avoid CommonJS patterns.
- Formatting is enforced by oxfmt (2-space indentation, semicolons, double quotes as configured/auto-formatted). Run `bun run fmt` before pushing.
- Linting is enforced by oxlint. Run `bun run lint` to check for issues.
- Naming:
  - Types/interfaces: `PascalCase`
  - Values/functions: `camelCase`
  - Test files: `*.test.ts` in `test/` mirroring the `src/` layout.

## Testing Guidelines

- Tests use Bun's Jest-compatible test runner (`bun test` with `describe`/`test`/`expect`) and live in `test/**/*.test.ts`.
- Add/adjust tests alongside behavior changes; prefer small unit tests plus targeted integration coverage.

## Commit & Pull Request Guidelines

- Commits generally follow an imperative, summary-first style (e.g., "Add …", "Refactor …", "Enhance …"). Keep subjects concise and scoped.
- PRs should include:
  - Clear description of behavior changes and rationale
  - Linked issue/context (if applicable)
  - Tests run (`bun test`) and any notes for reviewers

## Agent-Specific Notes

- Default to Bun commands (`bun run …`, `bun test`) and keep changes focused on `src/`; treat `dist/` as build output.
