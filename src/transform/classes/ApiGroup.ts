/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:api_group";

export function ApiGroup(data: Record<string, unknown>): KindNode {
  // Legacy/malformed api_group records can have an empty name but a populated canonical
  // (public URL slug). Fall back to the canonical, or a generic placeholder, so the export
  // produces a valid document instead of failing "Missing block1: name".
  let name = data.name ?? "";
  if (name === "") {
    name = data.canonical ?? "api_group_" + String(data.id ?? "unknown");
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.api_group_enabled)) {
    blocks.push(Transform.inlineAssign("active", data.api_group_enabled ?? false, "static:bool"));
  }

  if (!phpEmpty(data.canonical)) blocks.push(Transform.inlineAssign("canonical", data.canonical));

  onSwagger(data, ret);

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret, "query_enabled", "query_limit");
  Transform.onSchemaCors(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** The `onSwagger` helper of the PHP ApiGroup transform. */
function onSwagger(item: Record<string, unknown>, schema: KindNode): void {
  const swagger = item.swagger ?? false;
  const token = !phpEmpty(mapperGet("documentation.require_token", item, false) ?? false)
    ? (mapperGet("documentation.token", item, "") ?? "")
    : "";

  if (!phpEmpty(swagger) && phpEmpty(token)) return;

  const blocks: KindNode[] = [];

  if (phpEmpty(swagger)) {
    blocks.push(Transform.inlineAssign("active", swagger, "static:bool"));
  }

  if (!phpEmpty(token)) {
    blocks.push(Transform.inlineAssign("token", token));
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("swagger", blocks, "static:object"));
}
