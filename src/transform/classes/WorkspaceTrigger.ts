/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:workspace_trigger";

const ACTION_KEY = "meta.workspace.action";
const ACTIONS = ["branch_live", "branch_merge", "branch_new"];

/** A `{ int id, text label }` branch object input, as the PHP `json_decode`s it inline. */
function branchInput(name: string): KindNode {
  return {
    kind: "schema:object",
    args: [{ name: "name", kind: "static:text", value: name }],
    blocks: [
      {
        kind: "schema:schema",
        blocks: [
          { kind: "schema:int", args: [{ name: "name", kind: "static:text", value: "id" }] },
          { kind: "schema:text", args: [{ name: "name", kind: "static:text", value: "label" }] },
        ],
      },
    ],
  };
}

/** The fixed `input { object to_branch; object from_branch; enum action }` block. */
function inputBlock(): KindNode {
  return {
    kind: "schema:input",
    blocks: [
      branchInput("to_branch"),
      branchInput("from_branch"),
      {
        kind: "schema:enum",
        args: [{ name: "name", kind: "static:text", value: "action" }],
        blocks: [{ kind: "static:text[]", name: "values", value: ["branch_live", "branch_merge", "branch_new"] }],
      },
    ],
  };
}

export function WorkspaceTrigger(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", phpEmpty(data.name) ? "trigger_" + String(data.id ?? "unknown") : data.name)],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.active)) blocks.push(Transform.inlineAssign("active", data.active, "static:bool"));

  blocks.push(inputBlock());

  blocks.push(Transform.convertToKind("schema:stack", data.run));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret);
  onActions(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** The `onActions` helper of the PHP WorkspaceTrigger transform. */
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
