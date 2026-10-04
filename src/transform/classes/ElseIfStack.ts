/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:elseifstack";

export function ElseIfStack(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  if (!phpEmpty(data.name)) ret.name = data.name;
  (ret.args as KindNode[]).push({ name: "expr", kind: "assign:expr", value: Transform.createInlineComparison(data.expr) });
  ret.blocks = Transform.onSchemaStackBlocks(data.stack ?? []);
  return ret;
}
