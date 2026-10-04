/** Port of redacted. */
import { isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:container_volume";

export function ContainerVolume(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("type", data.type ?? "", "static:text"));

  const persistent = data.persistent ?? [];
  if (isPhpArray(persistent) && !phpEmpty(persistent)) {
    const p = persistent as Record<string, unknown>;
    const mountRows: KindNode[][] = [];
    for (const mount of normalizeMounts(p.mounts ?? [])) {
      mountRows.push([
        Transform.inlineAssign("mountPath", mount.mountPath ?? "", "static:text"),
        Transform.inlineAssign("subPath", mount.subPath ?? "", "static:text"),
      ]);
    }
    blocks.push(
      Transform.createStaticObject("persistent", [
        Transform.inlineAssign("claimName", p.claimName ?? "", "static:text"),
        Transform.createStaticObject("mounts", mountRows, true),
      ]),
    );
  }

  const emptyDir = data.emptyDir ?? [];
  if (isPhpArray(emptyDir) && !phpEmpty(emptyDir)) {
    const e = emptyDir as Record<string, unknown>;
    blocks.push(
      Transform.createStaticObject("emptyDir", [
        Transform.inlineAssign("mountPath", e.mountPath ?? "", "static:text"),
        Transform.inlineAssign("medium", e.medium ?? "", "static:text"),
      ]),
    );
  }

  const config = data.config ?? [];
  if (isPhpArray(config) && !phpEmpty(config)) {
    const c = config as Record<string, unknown>;
    blocks.push(
      Transform.createStaticObject("config", [
        Transform.inlineAssign("name", c.name ?? "", "static:text"),
        Transform.inlineAssign("mountPath", c.mountPath ?? "", "static:text"),
      ]),
    );
  }

  return ret;
}

/** mounts is a list of maps; normalize to a stable shape so encode/decode round-trip exactly. */
function normalizeMounts(mounts: unknown): Array<Record<string, unknown>> {
  const ret: Array<Record<string, unknown>> = [];
  if (!isPhpArray(mounts)) return ret;
  for (const mount of Object.values(mounts as object)) {
    if (!isPhpArray(mount)) continue;
    const m = mount as Record<string, unknown>;
    ret.push({ mountPath: m.mountPath ?? "", subPath: m.subPath ?? "" });
  }
  return ret;
}
