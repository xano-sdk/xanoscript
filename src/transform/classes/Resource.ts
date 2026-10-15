/**
 * Port of redacted: an MCP resource or resource
 * template whose stack produces its contents. The declaration identifier is
 * the resource NAME, never its uri. Every optional field (`input` too, for a
 * static resource) is omitted at its default, and the encoder never throws on
 * a stored value. `title` / `icons` reuse the tool helpers.
 */
import { script } from "../../engine/context.js";
import { StdClass, floatval, isNumeric, isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";
import { onIcons, onTitle } from "./Tool.js";

export const KIND = "schema:resource";

export function Resource(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  onTitle(data, ret);

  const uri = data.uri ?? "";
  blocks.push(Transform.inlineAssign("uri", typeof uri === "string" ? uri : ""));

  const mimeType = data.mime_type ?? null;
  if (typeof mimeType === "string" && mimeType !== "") blocks.push(Transform.inlineAssign("mime_type", mimeType));

  onAnnotations(data, ret);
  onIcons(data, ret);

  if (!phpEmpty(data.input)) blocks.push(Transform.convertToKind("schema:input", data.input));

  blocks.push(Transform.convertToKind("schema:stack", data.run ?? []));
  blocks.push(Transform.onSchemaResponse(data));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** The MCP `Annotations` (audience, priority, last_modified), emitted only for the keys that are set; never throws. */
function onAnnotations(data: Record<string, unknown>, ret: KindNode): void {
  let stored = data.annotations ?? null;
  if (stored instanceof StdClass) stored = [];
  if (!isPhpArray(stored)) return;
  const s = stored as Record<string, unknown>;

  const nodes: KindNode[] = [];

  const audience = s.audience ?? null;
  if (isPhpArray(audience)) {
    const kept = Object.values(audience).filter((v) => typeof v === "string");
    if (kept.length) nodes.push(Transform.inlineAssign("audience", kept, "static:text[]"));
  }

  const priority = s.priority ?? null;
  if (typeof priority === "number" || (typeof priority === "string" && isNumeric(priority))) {
    nodes.push(Transform.inlineAssign("priority", floatval(priority), "static:decimal"));
  }

  const lastModified = s.last_modified ?? null;
  if (typeof lastModified === "string" && lastModified !== "") nodes.push(Transform.inlineAssign("last_modified", lastModified));

  if (nodes.length) (ret.blocks as KindNode[]).push(Transform.inlineAssign("annotations", nodes, "static:object"));
}
