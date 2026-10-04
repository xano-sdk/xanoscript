/** Port of redacted. */
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:util.get_raw_input";

export function GetRawInput(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  // `input` arrives keyed by name (convertStackItemImpl ran migrateInput).
  const input = (data.input ?? {}) as Record<string, unknown>;
  blocks.push(Transform.convertAssignmentValue(input.encoding ?? "json", "encoding"));
  blocks.push(Transform.convertAssignmentValue(input.exclude_middleware_modification ?? false, "exclude_middleware"));

  return ret;
}
