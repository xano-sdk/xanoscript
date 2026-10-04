/** Port of redacted. */
import { script } from "../../engine/context.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";
import { DB } from "../db.js";

export const KIND = "schema:db.bulk.delete";

export function DbBulkDelete(data: Record<string, unknown>): KindNode {
  const tableId = mapperGet("context.dbo.id", data);
  let tableName: string;
  try {
    tableName = script().mapIdToDboName(tableId);
  } catch {
    tableName = "";
  }

  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", tableName), Transform.inlineAssign("as", data.as ?? "")],
    blocks: [],
  };

  const MODE = Transform.getPipeMode();
  Transform.setPipeMode(Transform.PIPE_MODE_FILTERS);
  try {
    const renameMap = DB.getNormalizedMap(data);
    DB.onSearch(mapperGet("context.search", data) ?? [], ret.blocks as KindNode[], renameMap);
  } finally {
    Transform.setPipeMode(MODE);
  }
  return ret;
}
