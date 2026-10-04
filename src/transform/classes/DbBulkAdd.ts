/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:db.bulk.add";

export function DbBulkAdd(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const args = ret.args as KindNode[];
  const blocks = ret.blocks as KindNode[];

  const tableId = mapperGet("context.dbo.id", data);
  let tableName: string;
  try {
    tableName = script().mapIdToDboName(tableId);
  } catch {
    tableName = "";
  }

  args.push(Transform.inlineAssign("name", tableName));

  const allowIdField = mapperGet("input.allow_id_field", data);
  if (!phpEmpty(allowIdField)) {
    blocks.push(Transform.convertAssignmentValue(allowIdField, "allow_id_field"));
  }

  const items = mapperGet("input.items", data);
  if (!phpEmpty(items)) {
    blocks.push(Transform.convertAssignmentValue(items, "items"));
  }

  return ret;
}
