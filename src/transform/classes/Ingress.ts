/** Port of redacted. */
import { isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:ingress";

export function Ingress(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("domain", data.domain ?? "", "static:text"));

  const paths = data.paths ?? [];
  if (isPhpArray(paths) && !phpEmpty(paths)) blocks.push(createToSchemaIngressPaths(paths));

  return ret;
}

/** `$item["k"] ?? null` on a value that may not be an array (PHP yields null, never throws, under `??`). */
function field(item: unknown, key: string): unknown {
  if (item === null || typeof item !== "object") return null;
  return (item as Record<string, unknown>)[key] ?? null;
}

/** paths[]: !static:objects of { service:text, path:text }, emitted under block name "path". */
function createToSchemaIngressPaths(items: unknown): KindNode {
  const blocks: KindNode[][] = [];
  for (const item of Object.values(items as object)) {
    blocks.push([
      Transform.inlineAssign("service", field(item, "service") ?? "", "static:text"),
      Transform.inlineAssign("path", field(item, "path") ?? "", "static:text"),
    ]);
  }
  return Transform.createStaticObject("path", blocks, true);
}
