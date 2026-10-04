/** Port of redacted. */
import { isPhpArray, phpEmpty, strval } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:market_item";

export function MarketItem(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("type", matchType(data.type)));

  for (const key of ["email", "guid", "canonical", "category", "license", "video", "icon_url", "banner_url", "short_description", "long_description", "readme"]) {
    if (!phpEmpty(data[key])) blocks.push(Transform.inlineAssign(key, data[key]));
  }

  onEnv(data, ret);

  for (const tablemap of Object.values((data.tablemap ?? []) as object)) {
    blocks.push(Transform.convertToKind("schema:tablemap", tablemap));
  }

  onSchemaDependency(data, ret);
  onSchemaDemo(data, ret);

  return ret;
}

/** The engine's `match ($data["type"])` — strict, and `\UnhandledMatchError` on anything else. */
function matchType(type: unknown): unknown {
  switch (type) {
    case "extension":
      return type;
  }
  throw new Error("Unhandled match case " + JSON.stringify(type));
}

/** Private port of redacted (the Workspace class is not ported yet). */
function onEnv(item: Record<string, unknown>, schema: KindNode): void {
  const envs: KindNode[] = [];

  for (const env of Object.values((item.env ?? []) as object) as Array<Record<string, unknown>>) {
    envs.push(Transform.inlineAssign(strval(env.name), env.value ?? null));
  }

  if (!phpEmpty(envs)) (schema.blocks as KindNode[]).push(Transform.inlineAssign("env", envs, "static:object"));
}

/** the engine's `onSchemaDemo`. */
function onSchemaDemo(item: Record<string, unknown>, schema: KindNode): void {
  if (phpEmpty(item.demo)) return;
  const demo = item.demo as Record<string, unknown>;

  const blocks: KindNode[] = [];
  blocks.push(Transform.inlineAssign("video", demo.video ?? null));
  blocks.push(Transform.inlineAssign("link", demo.link ?? null));

  (schema.blocks as KindNode[]).push(Transform.createStaticObject("demo", blocks));
}

/** the engine's `onSchemaDependency`. */
function onSchemaDependency(item: Record<string, unknown>, schema: KindNode): void {
  if (phpEmpty(item.dependency)) return;

  const blocks: KindNode[][] = [];
  for (const node of Object.values(item.dependency as object)) {
    try {
      blocks.push(createSchemaDependency(node));
    } catch {
      // ignore
    }
  }

  (schema.blocks as KindNode[]).push(Transform.createStaticObject("dependency", blocks, true));
}

/** the engine's `createSchemaDependency`. */
function createSchemaDependency(item: unknown): KindNode[] {
  if (!isPhpArray(item)) throw new Error("Invalid dependency entry");
  const it = item as Record<string, unknown>;

  const blocks: KindNode[] = [];

  blocks.push(Transform.inlineAssign("name", it.name ?? null));
  blocks.push(Transform.inlineAssign("link", it.link ?? null));

  return blocks;
}
