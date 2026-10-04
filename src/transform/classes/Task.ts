/** Port of redacted. */
import { script } from "../../engine/context.js";
import { isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:task";

export function Task(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.active)) blocks.push(Transform.inlineAssign("active", data.active, "static:bool"));

  if (!phpEmpty(data.datasource) && data.datasource !== "live") {
    blocks.push(Transform.inlineAssign("datasource", data.datasource, "static:text"));
  }

  blocks.push(Transform.convertToKind("schema:stack", data.run));

  blocks.push(onSchemaSchedule(data.schedule ?? []));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret, "enabled", "limit", true);
  Transform.onSchemaTesting(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** The `onSchemaSchedule` helper of the PHP Task transform. */
function onSchemaSchedule(items: unknown): KindNode {
  const blocks: KindNode[][] = [];

  if (isPhpArray(items)) {
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      blocks.push(createSchemaSchemaEventItem(item));
    }
  }

  return Transform.createStaticObject("schedule", blocks, true);
}

/** The `createSchemaSchemaEventItem` helper of the PHP Task transform. */
function createSchemaSchemaEventItem(item: Record<string, unknown>): KindNode[] {
  const blocks: KindNode[] = [];

  blocks.push(Transform.inlineAssign("starts_on", item.starts_on, "static:timestamp"));

  if (!phpEmpty(mapperGet("repeat.enabled", item, false))) {
    blocks.push(Transform.inlineAssign("freq", mapperGet("repeat.freq", item), "static:int"));

    if (!phpEmpty(mapperGet("repeat.ends.enabled", item, false))) {
      blocks.push(Transform.inlineAssign("ends_on", mapperGet("repeat.ends.on", item), "static:timestamp"));
    }
  }

  return blocks;
}
