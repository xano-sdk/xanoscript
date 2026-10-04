/** Port of redacted. */
import { script } from "../../engine/context.js";
import { isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";
import { DB } from "../db.js";

export const KIND = "schema:table_trigger";

const ACTION_KEY = "meta.database.action";
const ACTIONS = ["delete", "insert", "update", "truncate"];

/** The fixed `input { json new; json old; enum action; text datasource }` block the PHP `json_decode`s inline. */
function inputBlock(): KindNode {
  return {
    kind: "schema:input",
    blocks: [
      {
        kind: "schema:json",
        args: [{ name: "name", kind: "static:text", value: "new" }],
      },
      {
        kind: "schema:json",
        args: [{ name: "name", kind: "static:text", value: "old" }],
      },
      {
        kind: "schema:enum",
        args: [{ name: "name", kind: "static:text", value: "action" }],
        blocks: [{ kind: "static:text[]", name: "values", value: ["insert", "update", "delete", "truncate"] }],
      },
      {
        kind: "schema:text",
        args: [{ name: "name", kind: "static:text", value: "datasource" }],
      },
    ],
  };
}

export function TableTrigger(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", phpEmpty(data.name) ? "trigger_" + String(data.id ?? "unknown") : data.name)],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  blocks.push({
    name: "table",
    kind: "static:text",
    value: script().mapIdToDboName(data.obj_id ?? 0, false),
  });

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.active)) blocks.push(Transform.inlineAssign("active", data.active, "static:bool"));

  blocks.push(inputBlock());
  blocks.push(Transform.convertToKind("schema:stack", data.run));

  if (!phpEmpty(mapperGet("meta.database.search.expression", data))) {
    DB.onSearch(mapperGet("meta.database.search", data), blocks);
  }

  onActions(data, ret);

  const datasources = mapperGet("meta.database.datasource", data);
  if (!phpEmpty(datasources)) {
    createToSchemaDatasources(ret, datasources);
  }

  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  Transform.onSchemaRequestHistory(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** The `onActions` helper of the PHP TableTrigger transform. */
function onActions(item: Record<string, unknown>, schema: KindNode): void {
  const actions: KindNode[] = [];

  const data = (mapperGet(ACTION_KEY, item) ?? {}) as Record<string, unknown>;

  for (const action of ACTIONS) {
    if (!phpEmpty(data[action] ?? false)) {
      actions.push(Transform.inlineAssign(action, data[action], "static:bool"));
    }
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("actions", actions, "static:object"));
}

/** The `createToSchemaDatasources` helper of the PHP TableTrigger transform. */
function createToSchemaDatasources(schema: KindNode, items: unknown): void {
  if (isPhpArray(items) && !phpEmpty(items)) {
    const tags: unknown[] = [];
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      tags.push(item.tag);
    }

    (schema.blocks as KindNode[]).push(Transform.inlineAssign("datasources", tags, "static:text[]"));
  }
}
