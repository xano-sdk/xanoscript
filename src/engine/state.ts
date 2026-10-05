// Engine origin: CoroutineState and class statics.
/**
 * The mutable render flags the engine keeps in process-wide state.
 *
 * The PHP encoder reads a handful of process-wide switches while rendering:
 * verbose (legacy `!var "x"` tags), the object-literal indent counter, the
 * quote/multiline modes the parser honours, the forced-multiline switch, the
 * pipe registry currently in effect, and the transform context stack. One
 * emit call owns this state for its duration; `withRenderState` snapshots and
 * restores it so nested or sequential emits never leak flags into each other.
 */

export type PipeMode = "pipes" | "filters" | "aggregates";

export interface RenderState {
  // `isVerbose()`
  /** Legacy tagged rendering. Production output is minimal. */
  verbose: boolean;
  // `Script.INDEX`
  /** Nesting depth while wrapping object/array literals. */
  index: number;
  // `Parser.QUOTE_MODE`
  /** Force a quote character for text (tests only). */
  quoteMode: '"' | "'" | null;
  // `Parser.QUOTE_MULTILINE`
  /** Allow `"""` blocks. */
  multilineQuotes: boolean;
  // `Parser.TICK_MULTILINE`
  /** Allow ```` ``` ```` blocks. */
  multilineTicks: boolean;
  // `MultiLineValue.FORCE`
  /** Always emit block syntax for multi-line text. */
  multilineForce: boolean;
  // redacted
  /** Which registry resolves pipe display names. */
  pipeMode: PipeMode;
  // redacted
  /** The object being encoded (mocks resolve test names off it). */
  contextStack: unknown[];
}

export const renderState: RenderState = {
  verbose: false,
  index: 0,
  quoteMode: null,
  multilineQuotes: true,
  multilineTicks: true,
  multilineForce: false,
  pipeMode: "pipes",
  contextStack: [],
};

/** Run `fn` with the given flags applied, restoring the previous state afterwards. */
export function withRenderState<T>(overrides: Partial<RenderState>, fn: () => T): T {
  const saved: RenderState = { ...renderState, contextStack: [...renderState.contextStack] };
  Object.assign(renderState, overrides);
  if (overrides.contextStack === undefined) renderState.contextStack = [];
  try {
    return fn();
  } finally {
    Object.assign(renderState, saved);
  }
}
