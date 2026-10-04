import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries, and the split is the point. `index` is the emitter: the port
  // of the engine's encoder plus its vendored kind data, with ZERO imports from
  // `@xano/sdk`. `plugin` (U6) is the only core-facing surface. Anything that
  // needs the peer belongs behind `plugin`, never behind `index`.
  // `plugin` pulls `render-def.ts` — the one peer-importing file — through
  // nothing but the SDK external below, so `index` stays peer-free in the
  // built output as well as in the source.
  entry: { index: "src/index.ts", plugin: "src/plugin.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // The peer is resolved from the consumer's install — never bundled. Matched as
  // a pattern so the subpath entries (`/internal`) stay external too, not just
  // the root; an exact string would miss them.
  external: [/^@xano\/sdk(\/|$)/],
});
