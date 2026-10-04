/** Port of redacted. */
import { script } from "../../engine/context.js";
import { isPhpArray, phpEmpty, strval } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:microservice";

export function Microservice(data: Record<string, unknown>): KindNode {
  try {
    Transform.pushContext(data);

    const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
    const blocks = ret.blocks as KindNode[];

    if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

    // Deployment kind. Emit ONLY when non-default so existing "builtin" rows
    // produce byte-identical XanoScript.
    if ((data.kind ?? "builtin") !== "builtin") blocks.push(Transform.inlineAssign("kind", data.kind));

    // Tenant-release deploy mode. ALWAYS emitted ("auto" or "manual").
    blocks.push(Transform.inlineAssign("tenant_deploy", strval(data.tenant_deploy ?? "auto")));

    // A microservice is EITHER helm-kind (bring-your-own chart) OR builtin
    // (declarative configs/volumes/deployment/ingresses).
    const isHelm = (data.kind ?? "builtin") === "helm";

    // Builtin declarative blocks — order: configs, volumes, deployment, ingresses.
    if (!isHelm) {
      for (const config of Object.values((data.configs ?? []) as object)) {
        blocks.push(Transform.convertToKind("schema:microservice_config", config));
      }

      for (const volume of Object.values((data.volumes ?? []) as object)) {
        blocks.push(Transform.convertToKind("schema:microservice_volume", volume));
      }

      const deployment = data.deployment ?? [];
      if (isPhpArray(deployment) && !phpEmpty(deployment)) {
        blocks.push(Transform.convertToKind("schema:deployment", deployment));
      }

      for (const ingress of Object.values((data.ingresses ?? []) as object)) {
        blocks.push(Transform.convertToKind("schema:ingress", ingress));
      }
    }

    // Chart block — emitted ONLY for helm-kind rows.
    if (isHelm) {
      const chart = data.chart ?? [];
      blocks.push(Transform.convertToKind("schema:chart", chart));
    }

    if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

    return ret;
  } finally {
    Transform.popContext();
  }
}
