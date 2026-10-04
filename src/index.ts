/**
 * XanoScript emitter — renders the engine's persisted JSON to XanoScript text
 * locally, as a byte-exact port of the engine's own PHP encoder.
 *
 * `emitXanoScript("schema:function", row)` is the single-object entry
 * (`mvp:xano_script_process`); the multidoc assembly lives in `multidoc.ts`.
 */
import { withScriptContext } from "./engine/context.js";
import { ScriptContext, type Feature, type ScriptMaps } from "./engine/script-context.js";
import { withRenderState, type RenderState } from "./engine/state.js";
import { processConvert } from "./transform/process.js";

export type { ScriptMaps, Feature };
export { ScriptContext };
export { emitWorkspaceMultidoc } from "./multidoc.js";
export type { MultidocOptions, MultidocSections } from "./multidoc.js";

export interface EmitOptions {
  /** id → name maps for every cross-reference the object makes. */
  maps?: ScriptMaps;
  /** Engine export features (`guid` emits guid lines, etc.). */
  features?: Partial<Record<Feature, boolean>>;
  /** Render flags; the defaults are what the engine's export path uses. */
  render?: Partial<Omit<RenderState, "index" | "contextStack" | "pipeMode">>;
  /** Reuse a prepared context (its maps stay registered across calls). */
  context?: ScriptContext;
}

let shared: ScriptContext | null = null;

/** A context with the vendored engine kinds loaded; cached because the registry is large. */
export function createScriptContext(maps?: ScriptMaps, features?: Partial<Record<Feature, boolean>>): ScriptContext {
  const ctx = new ScriptContext();
  if (maps) ctx.registerMaps(maps);
  if (features) {
    for (const [k, v] of Object.entries(features)) ctx.setFeature(k as Feature, Boolean(v));
  }
  return ctx;
}

function contextFor(o: EmitOptions): ScriptContext {
  if (o.context) {
    // A prepared context is the caller's to reuse; this call's maps and
    // features still apply to it, as they do for a multidoc render.
    if (o.maps) o.context.registerMaps(o.maps);
    if (o.features) o.context.setFeatures({ guid: false, workspaceEnv: false, tableItems: false, ...o.features });
    return o.context;
  }
  // Maps are per call: a call that supplies them gets its own context, so a
  // table id resolved for one workspace can never name a table in the next.
  // The shared context serves only map-less calls, and never holds a map.
  if (o.maps) return createScriptContext(o.maps, { guid: false, workspaceEnv: false, tableItems: false, ...(o.features ?? {}) });
  if (!shared) shared = new ScriptContext();
  shared.setFeatures({ guid: false, workspaceEnv: false, tableItems: false, ...(o.features ?? {}) });
  return shared;
}

/** Render one object (`schema:function`, `schema:query`, a statement kind, …) to XanoScript. */
export function emitXanoScript(kind: string, data: unknown, options: EmitOptions = {}): string {
  const ctx = contextFor(options);
  const out = withScriptContext(ctx, () =>
    withRenderState(
      {
        verbose: false,
        quoteMode: null,
        multilineQuotes: true,
        multilineTicks: true,
        multilineForce: false,
        pipeMode: "pipes",
        index: 0,
        ...(options.render ?? {}),
      },
      () => processConvert(kind, data).output,
    ),
  );
  // A context this call owns (shared or per-call) records unresolved references
  // nobody will read; drain it so a long-lived process does not accumulate them.
  // A caller-supplied context keeps its record for the caller to take.
  if (!options.context) ctx.takeUnresolved();
  return out;
}
export { placeMultidoc, placeDocuments, splitMultidoc, parseDocument, layoutRoots } from "./tree.js";
export type { PlacedDocument, ParsedDocument } from "./tree.js";
