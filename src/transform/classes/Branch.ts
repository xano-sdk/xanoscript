/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:branch";

export function Branch(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.label)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (!phpEmpty(data.color)) blocks.push(Transform.inlineAssign("color", data.color));

  onSchemaMiddlewareMapping(data, ret);
  onSchemaHistory(data, ret);

  return ret;
}

/** The branch-level `onSchemaMiddlewareMapping` (its own shape, distinct from the shared `Transform.onSchemaMiddlewareMapping`). */
function onSchemaMiddlewareMapping(item: Record<string, unknown>, schema: KindNode): void {
  const master: KindNode[] = [];

  for (const key of ["function", "query", "task", "tool", "message"]) {
    const blocks: KindNode[] = [];
    for (const type of ["pre", "post"]) {
      const middleware = mapperGet("middleware." + key + "_" + type, item);
      const subblocks: KindNode[][] = [];
      if (!phpEmpty(middleware)) {
        for (const node of Object.values(middleware as object) as Array<Record<string, unknown>>) {
          subblocks.push(Transform.createSchemaMiddlewareAssignment(node));
        }
      }
      blocks.push(Transform.createStaticObject(type, subblocks, true));
    }

    master.push(Transform.createStaticObject(key, blocks));
  }

  (schema.blocks as KindNode[]).push(Transform.createStaticObject("middleware", master));
}

/** The `onSchemaHistory` helper of the PHP Branch transform. */
function onSchemaHistory(item: Record<string, unknown>, schema: KindNode): void {
  const blocks: KindNode[] = [];

  for (const key of ["function", "query", "task", "tool", "trigger", "middleware"]) {
    const enabledKey = "history." + key + "_enabled";
    const enabled = mapperGet(enabledKey, item, false);
    if (phpEmpty(enabled)) {
      if (key == "task") {
        blocks.push(Transform.inlineAssign(key, 0, "static:int"));
      } else {
        blocks.push(Transform.inlineAssign(key, false, "static:bool"));
      }

      continue;
    }

    const limit = mapperGet("history." + key + "_limit", item, 0);

    // PHP `match` compares strictly, so only these exact ints map through.
    if (limit === -1) {
      blocks.push(Transform.inlineAssign(key, "all", "static:text"));
    } else if (limit === 0 || limit === 10 || limit === 100 || limit === 1000 || limit === 10000) {
      blocks.push(Transform.inlineAssign(key, limit, "static:int"));
    } else {
      blocks.push(Transform.inlineAssign(key, 100, "static:int"));
    }
  }

  (schema.blocks as KindNode[]).push(Transform.createStaticObject("history", blocks));
}
