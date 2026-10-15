/** Port of redacted. */
import { script } from "../../engine/context.js";
import { StdClass, isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:tool";

export function Tool(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  onTitle(data, ret);

  if (!phpEmpty(data.instructions)) blocks.push(Transform.inlineAssign("instructions", data.instructions));

  onAnnotations(data, ret);
  onIcons(data, ret);

  blocks.push(Transform.convertToKind("schema:input", data.input));
  blocks.push(Transform.convertToKind("schema:stack", data.run));
  blocks.push(Transform.onSchemaResponse(data));

  onOutputSchema(data, ret);

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

// MCP tool metadata: each field is OMITTED at its default, and the encoder
// never throws (a throw would lose the whole document).

/** The annotation keys, in output order. */
const ANNOTATION_KEYS = ["read_only_hint", "destructive_hint", "idempotent_hint", "open_world_hint"];

export function onTitle(data: Record<string, unknown>, ret: KindNode): void {
  const title = data.title ?? null;
  if (typeof title === "string" && title !== "") (ret.blocks as KindNode[]).push(Transform.inlineAssign("title", title));
}

function onAnnotations(data: Record<string, unknown>, ret: KindNode): void {
  let stored = data.annotations ?? null;
  if (stored instanceof StdClass) stored = [];
  if (!isPhpArray(stored)) return;

  const nodes: KindNode[] = [];
  for (const key of ANNOTATION_KEYS) {
    const value = (stored as Record<string, unknown>)[key] ?? null;
    if (typeof value === "boolean") nodes.push(Transform.inlineAssign(key, value, "static:bool"));
  }

  if (nodes.length) (ret.blocks as KindNode[]).push(Transform.inlineAssign("annotations", nodes, "static:object"));
}

/** Emitted verbatim, WITHOUT validation: the encoder must not drop data. */
export function onIcons(data: Record<string, unknown>, ret: KindNode): void {
  const stored = data.icons ?? null;
  if (!isPhpArray(stored) || phpEmpty(stored)) return;

  const items: KindNode[][] = [];
  for (const iconIn of Object.values(stored)) {
    const icon = (iconIn instanceof StdClass ? [] : iconIn) as Record<string, unknown>;
    if (!isPhpArray(icon)) continue;

    const src = icon.src ?? null;
    if (typeof src !== "string" || src === "") continue;

    const nodes: KindNode[] = [Transform.inlineAssign("src", src)];

    if (typeof icon.mime_type === "string" && icon.mime_type !== "") nodes.push(Transform.inlineAssign("mime_type", icon.mime_type));

    const sizes = icon.sizes ?? null;
    if (isPhpArray(sizes) && !phpEmpty(sizes)) {
      const kept = Object.values(sizes).filter((v) => typeof v === "string");
      if (kept.length) nodes.push(Transform.inlineAssign("sizes", kept, "static:text[]"));
    }

    if (typeof icon.theme === "string" && icon.theme !== "") nodes.push(Transform.inlineAssign("theme", icon.theme));

    items.push(nodes);
  }

  if (items.length) (ret.blocks as KindNode[]).push(Transform.createStaticObject("icons", items, true));
}

function onOutputSchema(data: Record<string, unknown>, ret: KindNode): void {
  const schema = data.output_schema ?? null;
  if (!isPhpArray(schema) || phpEmpty(schema)) return;

  try {
    (ret.blocks as KindNode[]).push(Transform.onSchemaOutput(schema));
  } catch {
    // losing the output block beats losing the whole tool document
  }
}
