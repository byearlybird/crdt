import { build } from "tsdown";

export default build({
	entry: {
		index: "src/index.ts",
		core: "src/state/index.ts",
		"persister-idb": "src/persisters/idb/index.ts",
		"synchronizer-http": "src/synchronizers/http/index.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	treeshake: true,
});
