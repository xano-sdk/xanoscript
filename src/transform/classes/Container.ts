/** Port of redacted. */
import { isPhpArray, phpEmpty, strval } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:container";

export function Container(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("image", data.image ?? "", "static:text"));

  // pull_secret: optional image pull secret name — only emit when present.
  if (!phpEmpty(data.pull_secret)) blocks.push(Transform.inlineAssign("pull_secret", data.pull_secret, "static:text"));

  // type defaults to "standard" — only emit a non-default value (e.g. "init").
  const type = data.type ?? "";
  if (type !== "" && type !== "standard") blocks.push(Transform.inlineAssign("type", type, "static:text"));

  // command[] -> schema block "command"
  const command = data.command ?? [];
  if (isPhpArray(command) && !phpEmpty(command)) blocks.push(createToSchemaNameList("command", command));

  // args[] (DBO) -> schema block "arg"
  const args = data.args ?? [];
  if (isPhpArray(args) && !phpEmpty(args)) blocks.push(createToSchemaNameList("arg", args));

  // envs[] (DBO) -> schema block "env"
  const envs = data.envs ?? [];
  if (isPhpArray(envs) && !phpEmpty(envs)) blocks.push(createToSchemaEnvs(envs));

  // ports: static:object[] — ports = [{containerPort, servicePort}]
  const ports = data.ports ?? [];
  if (isPhpArray(ports) && !phpEmpty(ports)) {
    const rows: KindNode[][] = [];
    for (const port of Object.values(ports as object) as Array<Record<string, unknown>>) {
      rows.push([
        Transform.inlineAssign("containerPort", field(port, "containerPort") ?? "", "static:text"),
        Transform.inlineAssign("servicePort", field(port, "servicePort") ?? "", "static:text"),
      ]);
    }
    blocks.push(Transform.createStaticObject("ports", rows, true));
  }

  // resources: static:object — resources = { cpu, ram }
  const resources = data.resources ?? [];
  if (isPhpArray(resources) && !phpEmpty(resources)) {
    const r = resources as Record<string, unknown>;
    blocks.push(
      Transform.createStaticObject("resources", [
        Transform.inlineAssign("cpu", r.cpu ?? "", "static:text"),
        Transform.inlineAssign("ram", r.ram ?? "", "static:text"),
      ]),
    );
  }

  // volumes[] -> repeating "volume" blocks (schema:container_volume)
  for (const volume of Object.values((data.volumes ?? []) as object)) {
    blocks.push(Transform.convertToKind("schema:container_volume", volume));
  }

  return ret;
}

/** `$item["k"] ?? null` on a value that may not be an array (PHP yields null, never throws, under `??`). */
function field(item: unknown, key: string): unknown {
  if (item === null || typeof item !== "object") return null;
  return (item as Record<string, unknown>)[key] ?? null;
}

/** command / arg: !static:objects of { name:text } */
function createToSchemaNameList(name: string, items: unknown): KindNode {
  const blocks: KindNode[][] = [];
  for (const item of Object.values(items as object)) {
    blocks.push([Transform.inlineAssign("name", field(item, "name") ?? "", "static:text")]);
  }
  return Transform.createStaticObject(name, blocks, true);
}

/**
 * env: !static:objects of { name:text, value?:text, from_env?:text }. An entry
 * carries EITHER a literal `value` OR a `from_env` reference; the absent side
 * is OMITTED so a literal-only container renders byte-identically.
 */
function createToSchemaEnvs(items: unknown): KindNode {
  const blocks: KindNode[][] = [];
  for (const item of Object.values(items as object)) {
    const row: KindNode[] = [];
    row.push(Transform.inlineAssign("name", field(item, "name") ?? "", "static:text"));
    const fromEnv = strval(field(item, "from_env") ?? "");
    if (fromEnv !== "") {
      row.push(Transform.inlineAssign("from_env", fromEnv, "static:text"));
    } else {
      row.push(Transform.inlineAssign("value", field(item, "value") ?? "", "static:text"));
    }
    blocks.push(row);
  }
  return Transform.createStaticObject("env", blocks, true);
}
