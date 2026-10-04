/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty, strval } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:agent_trigger";

const ACTION_KEY = "meta.toolset.action";
const ACTIONS = ["connection"];

export function AgentTrigger(data: Record<string, unknown>): KindNode {
  return encodeAgentTrigger(data, KIND, "agent", false);
}

/**
 * The shared body. PHP's `McpServerTrigger extends AgentTrigger` and only
 * overrides `getKind()` / `getNameLabel()` / `hasPrimitives()`, so the
 * subclass port calls this with its own triple rather than duplicating the
 * encoder.
 */
export function encodeAgentTrigger(
  data: Record<string, unknown>,
  kind: string,
  nameLabel: string,
  hasPrimitives: boolean,
): KindNode {
  const ret: KindNode = {
    kind,
    args: [Transform.inlineAssign("name", !phpEmpty(data.name) ? data.name : "trigger_" + strval(data.id ?? "unknown"))],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  blocks.push({ name: nameLabel, kind: "static:text", value: script().mapIdToToolsetName(data.obj_id ?? 0, false) });

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.active)) blocks.push(Transform.inlineAssign("active", data.active ?? null, "static:bool"));

  const input = inputSchema();
  (input.blocks as KindNode[]).push(...primitiveInputBlocks(hasPrimitives));
  blocks.push(input);
  blocks.push(Transform.convertToKind("schema:stack", data.run ?? []));
  blocks.push(Transform.onSchemaResponse(data));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  Transform.onSchemaRequestHistory(data, ret);
  onActions(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

const N = (value: string): KindNode => ({ name: "name", kind: "static:text", value });

/** The fixed lifecycle contract the PHP embeds as a JSON literal. */
function inputSchema(): KindNode {
  return {
    kind: "schema:input",
    blocks: [
      {
        kind: "schema:object",
        args: [N("toolset")],
        blocks: [
          {
            kind: "schema:schema",
            blocks: [
              { kind: "schema:int", args: [N("id")], blocks: [] },
              { kind: "schema:text", args: [N("name")], blocks: [] },
              { kind: "schema:text", args: [N("instructions")], blocks: [] },
            ],
          },
        ],
      },
      {
        kind: "schema:object[]",
        args: [N("tools")],
        blocks: [
          {
            kind: "schema:schema",
            blocks: [
              { kind: "schema:int", args: [N("id")], blocks: [] },
              { kind: "schema:text", args: [N("name")], blocks: [] },
              { kind: "schema:text", args: [N("instructions")], blocks: [] },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * PHP `primitiveInputBlocks()`: the `prompts` / `resources` inputs, appended
 * after `tools` when the trigger's server carries first-class primitives.
 */
function primitiveInputBlocks(hasPrimitives: boolean): KindNode[] {
  if (!hasPrimitives) return [];

  const field = (kind: string, name: string): KindNode => ({ kind, args: [N(name)], blocks: [] });

  const out: KindNode[] = [];
  for (const [name, withUri] of [["prompts", false], ["resources", true]] as const) {
    const children = [field("schema:int", "id"), field("schema:text", "name"), field("schema:text", "description")];
    if (withUri) children.push(field("schema:text", "uri"));

    out.push({ kind: "schema:object[]", args: [N(name)], blocks: [{ kind: "schema:schema", blocks: children }] });
  }

  return out;
}

function onActions(item: Record<string, unknown>, schema: KindNode): void {
  const actions: KindNode[] = [];
  const data = mapperGet(ACTION_KEY, item) as Record<string, unknown> | null;

  for (const action of ACTIONS) {
    const value = data?.[action] ?? false;
    if (!phpEmpty(value)) actions.push(Transform.inlineAssign(action, value, "static:bool"));
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("actions", actions, "static:object"));
}
