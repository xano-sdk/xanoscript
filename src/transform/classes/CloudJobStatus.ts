/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:cloud.job.status";

export function CloudJobStatus(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };

  // `input` arrives keyed by name (convertStackItemImpl ran migrateInput).
  const input = (data.input ?? {}) as Record<string, unknown>;
  for (const key of ["id"]) {
    if (!phpEmpty(input[key])) (ret.blocks as KindNode[]).push(Transform.convertAssignmentValue(input[key], key));
  }

  return ret;
}
