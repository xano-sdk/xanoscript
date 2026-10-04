/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty, strval } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:channel_trigger";

const ACTION_KEY = "meta.channel.action";
const ACTIONS = ["join", "leave", "deliver"];

export function ChannelTrigger(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", !phpEmpty(data.name) ? data.name : "trigger_" + strval(data.id ?? "unknown"))],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  // Owning server by NAME, emitted BEFORE the channel — it scopes the path,
  // which is unique only per server. Derived from the owning channel's server
  // (obj_id is a channel id). throw:false so a trigger whose server/channel
  // was deleted still renders.
  const serverName = script().mapIdToV2ChannelServerName(data.obj_id ?? 0, false);
  if (!phpEmpty(serverName)) blocks.push({ name: "realtime_server", kind: "static:text", value: serverName });

  blocks.push({ name: "channel", kind: "static:text", value: script().mapIdToV2ChannelName(data.obj_id ?? 0, false) });

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
        blocks: [{ kind: "static:text[]", name: "values", value: [...ACTIONS] }],
      },
      { kind: "schema:text", args: [N("channel")] },
      { kind: "schema:json", args: [N("payload")] },
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
