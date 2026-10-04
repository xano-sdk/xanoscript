/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty, strval } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:realtime_trigger";

const ACTION_KEY = "meta.workspace_realtime_channel.action";
const ACTIONS = ["message", "join"];

export function RealtimeTrigger(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", !phpEmpty(data.name) ? data.name : "trigger_" + strval(data.id ?? "unknown"))],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  blocks.push({ name: "channel", kind: "static:text", value: script().mapIdToChannelName(data.obj_id ?? 0, false) });

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.active)) blocks.push(Transform.inlineAssign("active", data.active ?? null, "static:bool"));

  blocks.push(inputSchema());
  blocks.push(Transform.convertToKind("schema:stack", data.run));
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
        kind: "schema:enum",
        args: [N("action")],
        blocks: [{ kind: "static:text[]", name: "values", value: ["message", "join"] }],
      },
      { kind: "schema:text", args: [N("channel")] },
      {
        kind: "schema:object",
        args: [N("client")],
        blocks: [
          {
            kind: "schema:schema",
            blocks: [
              { kind: "schema:json", args: [N("extras")] },
              {
                kind: "schema:object",
                args: [N("permissions")],
                blocks: [
                  {
                    kind: "schema:schema",
                    blocks: [
                      { kind: "schema:int", args: [N("dbo_id")] },
                      { kind: "schema:text", args: [N("row_id")] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: "schema:object",
        args: [N("options")],
        blocks: [
          {
            kind: "schema:schema",
            blocks: [
              { kind: "schema:bool", args: [N("authenticated")] },
              { kind: "schema:text", args: [N("channel")] },
            ],
          },
        ],
      },
      { kind: "schema:json", args: [N("payload")] },
    ],
  };
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
