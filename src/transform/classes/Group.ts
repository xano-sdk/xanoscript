/** Port of redacted. */
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:group";

export function Group(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  (ret.blocks as KindNode[]).push(Transform.onSchemaStack(mapperGet("context.run", data, [])));
  return ret;
}
