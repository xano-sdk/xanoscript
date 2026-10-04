/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:message";

export function Message(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  // Owning server by NAME, emitted BEFORE the channel. Resolve from the
  // message row's server.id; FALL BACK to the owning channel's server for rows
  // that predate the mvp_message.server field.
  let serverName = script().mapIdToRealtimeServerName(mapperGet("server.id", data, 0) ?? 0, false);
  if (phpEmpty(serverName)) {
    serverName = script().mapIdToV2ChannelServerName(mapperGet("channel.id", data, 0) ?? 0, false);
  }
  if (!phpEmpty(serverName)) blocks.push(Transform.inlineAssign("realtime_server", serverName));

  // Channel by PATH, not id. throw:false so a message whose channel was
  // deleted still renders.
  const channelName = script().mapIdToV2ChannelName(mapperGet("channel.id", data, 0) ?? 0, false);
  if (!phpEmpty(channelName)) blocks.push(Transform.inlineAssign("channel", channelName));

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  if (data.active !== undefined && data.active !== null && phpEmpty(data.active)) {
    blocks.push(Transform.inlineAssign("active", false, "static:bool"));
  }

  // Auth table for this message type; emitted only when set.
  if (!phpEmpty(data.auth)) {
    let authName: string;
    try {
      authName = script().mapIdToDboName(data.auth);
    } catch {
      authName = "";
    }
    blocks.push(Transform.inlineAssign("auth", authName));
  }

  // ALWAYS emitted, even at its default.
  blocks.push(Transform.inlineAssign("deliver_to", data.deliver_to ?? "channel"));

  blocks.push(Transform.convertToKind("schema:input", data.input ?? []));
  blocks.push(Transform.convertToKind("schema:stack", data.run ?? []));
  blocks.push(Transform.onSchemaResponse(data));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  Transform.onSchemaRequestHistory(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
