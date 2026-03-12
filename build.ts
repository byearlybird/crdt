import { $ } from "bun";

await $`rm -rf dist`;

await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "esm",
  sourcemap: "linked",
  target: "browser",
});

await $`tsc -p tsconfig.build.json`;
