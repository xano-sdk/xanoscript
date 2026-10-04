/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:elsestack";

export function ElseStack(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  if (!phpEmpty(data.name)) ret.name = data.name;
  ret.blocks = Transform.onSchemaStackBlocks(data.stack ?? []);
  return ret;
}
