import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["lib/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["@standard-schema/spec", "nanostores"],
  platform: "neutral",
});
