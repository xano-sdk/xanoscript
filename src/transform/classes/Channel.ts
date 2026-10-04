/** Port of redacted. */
import { script } from "../../engine/context.js";
import { intval, phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:channel";

export function Channel(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  // Owning server by NAME, not id. throw:false so a channel whose server was
  // deleted still renders.
  const serverName = script().mapIdToRealtimeServerName(mapperGet("server.id", data, 0) ?? 0, false);
  if (!phpEmpty(serverName)) blocks.push(Transform.inlineAssign("realtime_server", serverName));

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  // Only emitted when false: `active` defaults true.
  if (data.active !== undefined && data.active !== null && phpEmpty(data.active)) {
    blocks.push(Transform.inlineAssign("active", false, "static:bool"));
  }

  // Typed path parameters; emitted only when the channel declares them.
  if (!phpEmpty(data.input)) blocks.push(Transform.convertToKind("schema:input", data.input));

  onAccess(data, ret);
  onPublish(data, ret);
  onConversation(data, ret);
  onDelivery(data, ret);
  onRateLimit(data, ret);

  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  Transform.onSchemaRequestHistory(data, ret, "message_enabled", "message_limit");
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** `$a["b"]["c"] ?? $fallback`: a missing OR null leaf yields the fallback. */
function coalesce(path: string, obj: unknown, fallback: unknown): unknown {
  const v = mapperGet(path, obj, fallback);
  return v === null || v === undefined ? fallback : v;
}

function onAccess(item: Record<string, unknown>, schema: KindNode): void {
  const access: KindNode[] = [
    Transform.inlineAssign("anonymous", item.anonymous_clients ?? false, "static:bool"),
    Transform.inlineAssign("presence", item.presence ?? false, "static:bool"),
  ];
  (schema.blocks as KindNode[]).push(Transform.inlineAssign("access", access, "static:object"));
}

function onPublish(item: Record<string, unknown>, schema: KindNode): void {
  const publish: KindNode[] = [
    Transform.inlineAssign("who", coalesce("publish.who", item, "nobody")),
    Transform.inlineAssign("direct", coalesce("publish.direct", item, false), "static:bool"),
  ];
  (schema.blocks as KindNode[]).push(Transform.inlineAssign("publish", publish, "static:object"));
}

function onConversation(item: Record<string, unknown>, schema: KindNode): void {
  // `enabled` in storage is spelled `active` in script.
  const conversation: KindNode[] = [
    Transform.inlineAssign("active", coalesce("conversation.enabled", item, false), "static:bool"),
    Transform.inlineAssign("limit", coalesce("conversation.limit", item, 0), "static:int"),
    Transform.inlineAssign("ttl", coalesce("conversation.ttl", item, 0), "static:int"),
  ];
  (schema.blocks as KindNode[]).push(Transform.inlineAssign("conversation", conversation, "static:object"));
}

function onDelivery(item: Record<string, unknown>, schema: KindNode): void {
  const delivery: KindNode[] = [
    Transform.inlineAssign("guarantee", coalesce("delivery.guarantee", item, "at_most_once")),
    Transform.inlineAssign("per_recipient", coalesce("delivery.per_recipient", item, false), "static:bool"),
  ];
  (schema.blocks as KindNode[]).push(Transform.inlineAssign("delivery", delivery, "static:object"));
}

function onRateLimit(item: Record<string, unknown>, schema: KindNode): void {
  const limit = intval(coalesce("rate_limit.messages_per_minute", item, 0));

  // Omitted entirely when unset.
  if (limit <= 0) return;

  (schema.blocks as KindNode[]).push(
    Transform.inlineAssign("rate_limit", [Transform.inlineAssign("messages_per_minute", limit, "static:int")], "static:object"),
  );
}
