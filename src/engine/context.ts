/**
 * The "current script context" accessor.
 *
 * The PHP encoder reaches its kind registry, name maps and feature flags
 * through `$app->{'MVP\Script'}` from anywhere. The port keeps one live
 * `ScriptContext` per emit call and exposes it here, so deeply nested helpers
 * (the static-array reformatter, the pipe-name resolver) reach it the same way
 * without threading a parameter through every call.
 */
import type { ScriptContext } from "./script-context.js";

let current: ScriptContext | null = null;

export function script(): ScriptContext {
  if (!current) throw new Error("XanoScript emitter used outside of an emit call.");
  return current;
}

export function withScriptContext<T>(ctx: ScriptContext, fn: () => T): T {
  const prev = current;
  current = ctx;
  try {
    return fn();
  } finally {
    current = prev;
  }
}
