/** Port of redacted. */
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:stack|expect.to_throw";

export function StackExpectToThrow(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.onSchemaStack(mapperGet("context.run", data) ?? []));
  blocks.push(Transform.convertAssignmentValue(mapperGet("context.value1", data) ?? "", "exception"));

  return ret;
}
