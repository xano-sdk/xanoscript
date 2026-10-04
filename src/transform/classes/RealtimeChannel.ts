/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:realtime_channel";

export function RealtimeChannel(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.pattern ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.enabled)) blocks.push(Transform.inlineAssign("active", data.enabled ?? null, "static:bool"));

  onMessaging(data, ret);
  onSettings(data, ret);

  return ret;
}

function onMessaging(item: Record<string, unknown>, schema: KindNode): void {
  const blocks = schema.blocks as KindNode[];

  let messaging: KindNode[] = [];
  if (!phpEmpty(item.client_public_messaging)) {
    messaging.push(Transform.inlineAssign("auth", item.client_public_messaging_authenticated_only ?? null, "static:bool"));
  } else {
    messaging.push(Transform.inlineAssign("active", false, "static:bool"));
  }
  blocks.push(Transform.inlineAssign("public_messaging", messaging, "static:object"));

  messaging = [];
  if (!phpEmpty(item.client_private_messaging)) {
    messaging.push(Transform.inlineAssign("auth", item.client_private_messaging_authenticated_only ?? null, "static:bool"));
  } else {
    messaging.push(Transform.inlineAssign("active", false, "static:bool"));
  }
  blocks.push(Transform.inlineAssign("private_messaging", messaging, "static:object"));
}

function onSettings(item: Record<string, unknown>, schema: KindNode): void {
  const settings: KindNode[] = [];

  settings.push(Transform.inlineAssign("anonymous_clients", item.anonymous_clients ?? false, "static:bool"));
  settings.push(Transform.inlineAssign("nested_channels", item.wildcard ?? false, "static:bool"));
  settings.push(Transform.inlineAssign("message_history", item.history ?? 0, "static:int"));
  settings.push(Transform.inlineAssign("auth_channel", item.client_authenticated_messaging ?? false, "static:bool"));
  settings.push(Transform.inlineAssign("presence", item.presence ?? false, "static:bool"));

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("settings", settings, "static:object"));
}
