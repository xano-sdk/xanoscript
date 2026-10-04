/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:tablemap";

export function TableMap(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("mode", data.mode));

  onSchemaColumns(data, ret);

  if (!phpEmpty(data.schema)) {
    blocks.push(Transform.convertToKind("schema:schema", data.schema));
  }

  return ret;
}

/** The `onSchemaColumns` helper of the PHP TableMap transform. */
function onSchemaColumns(item: Record<string, unknown>, schema: KindNode): void {
  if (phpEmpty(item.columns)) return;

  const blocks: KindNode[][] = [];
  for (const node of Object.values(item.columns as object) as Array<Record<string, unknown>>) {
    try {
      blocks.push(createSchemaColumn(node));
    } catch {
      // ignore
    }
  }

  (schema.blocks as KindNode[]).push(Transform.createStaticObject("columns", blocks, true));
}

/** The `createSchemaColumn` helper of the PHP TableMap transform. */
function createSchemaColumn(item: Record<string, unknown>): KindNode[] {
  const blocks: KindNode[] = [];

  blocks.push(Transform.inlineAssign("name", item.name));
  if (!phpEmpty(item.type)) {
    blocks.push(Transform.inlineAssign("type", item.type));
  }
  blocks.push(Transform.inlineAssign("required", item.required ?? true, "static:bool"));

  return blocks;
}
