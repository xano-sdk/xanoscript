/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:cloud.job";

export function CloudJob(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };

  // `input` arrives keyed by name (convertStackItemImpl ran migrateInput).
  const input = (data.input ?? {}) as Record<string, unknown>;
  for (const key of ["image", "command", "args", "secret", "await", "template"]) {
    if (!phpEmpty(input[key])) (ret.blocks as KindNode[]).push(Transform.convertAssignmentValue(input[key], key));
  }

  return ret;
}
