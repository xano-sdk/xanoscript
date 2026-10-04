/**
 * The `!class` transform dispatcher. A kind's `transform: !class <Name>` names
 * the encoder class for that kind; each has a same-named module under
 * `classes/` here, so the drift map is file-for-file. The vendored data
 * carries the bare class name; a qualified name is reduced to its last segment.
 */
import type { KindNode } from "./transform.js";
import { CLASS_ENCODERS } from "./classes/index.js";

export type ClassEncoder = (data: Record<string, unknown>) => KindNode;

export function classNameOf(name: string): string {
  return name.substring(name.lastIndexOf("\\") + 1);
}

export function encodeWithClass(fqcn: string, data: unknown): KindNode {
  const name = classNameOf(fqcn);
  const encoder = CLASS_ENCODERS[name];
  if (!encoder) throw new Error(`Transform class not ported: ${name}`);
  return encoder((data ?? {}) as Record<string, unknown>);
}
