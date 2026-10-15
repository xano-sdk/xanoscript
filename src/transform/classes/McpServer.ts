/** Port of redacted. */
import { script } from "../../engine/context.js";
import { StdClass, ctypeDigit, isPhpArray, isScalar, phpEmpty, strval } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:mcp_server";

export function McpServer(data: Record<string, unknown>): KindNode {
  // `?? ""` before the `?:` chain: the key can be ABSENT, not merely empty.
  const nameRaw = data.name ?? "";
  const name = !phpEmpty(nameRaw) ? nameRaw : (data.canonical ?? data.guid ?? "unnamed");

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.enabled)) blocks.push(Transform.inlineAssign("active", false, "static:bool"));
  blocks.push(Transform.inlineAssign("canonical", data.canonical ?? null));

  if (!phpEmpty(data.instructions)) blocks.push(Transform.inlineAssign("instructions", data.instructions));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  Transform.onSchemaToolMapping(data, ret);
  // Omitted when empty, so a tools-only server is unchanged.
  Transform.onSchemaPrimitiveMapping(data, ret, "prompt");
  Transform.onSchemaPrimitiveMapping(data, ret, "resource");
  // Omitted when OAuth is off.
  onOauth(data, ret);
  Transform.onSchemaRequestHistory(data, ret, "tool_enabled", "tool_limit");

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

const str = (v: unknown): string => (isScalar(v) ? strval(v) : "");

function strList(vIn: unknown): string[] {
  const v = vIn instanceof StdClass ? [] : vIn;
  if (!isPhpArray(v)) return [];
  const out: string[] = [];
  for (const item of Object.values(v)) {
    if (isScalar(item)) out.push(strval(item));
  }
  return out;
}

interface OauthConfig {
  mode: string;
  auth_table: number;
  login_url: string;
  issuer: string;
  audience: string[];
  audience_ack: boolean;
  claim: string;
  claim_ack: boolean;
  column: string;
  preset: string;
  allowed_client_ids: string[];
}

/** The stored `oauth` block normalized to every key, or null when OAuth is off. */
function normalizeOauth(rawIn: unknown): OauthConfig | null {
  const raw = (rawIn instanceof StdClass ? [] : rawIn) as Record<string, unknown>;
  if (!isPhpArray(raw) || phpEmpty(raw)) return null;

  const authTable = raw.auth_table ?? 0;
  const claim = str(raw.claim ?? "");

  return {
    mode: str(raw.mode ?? ""),
    auth_table: (typeof authTable === "number" && Number.isInteger(authTable)) || (typeof authTable === "string" && ctypeDigit(authTable)) ? Number(authTable) : 0,
    login_url: str(raw.login_url ?? ""),
    issuer: str(raw.issuer ?? ""),
    audience: strList(raw.audience ?? []),
    audience_ack: !phpEmpty(raw.audience_ack ?? false),
    claim: !phpEmpty(claim) ? claim : "sub",
    claim_ack: !phpEmpty(raw.claim_ack ?? false),
    column: str(raw.column ?? ""),
    preset: str(raw.preset ?? ""),
    allowed_client_ids: strList(raw.allowed_client_ids ?? []),
  };
}

/**
 * The `oauth = { ... }` assignment: `mode` and `auth_table` always, every
 * other key only when it differs from its default. Never throws: a table
 * outside the export renders as "".
 */
function onOauth(item: Record<string, unknown>, schema: KindNode): void {
  const config = normalizeOauth(item.oauth ?? null);
  if (config === null) return;

  let authName = "";
  if (config.auth_table > 0) {
    try {
      authName = strval(script().mapIdToDboName(config.auth_table));
    } catch {
      authName = "";
    }
  }

  const nodes: KindNode[] = [];
  nodes.push(Transform.inlineAssign("mode", config.mode));
  nodes.push(Transform.inlineAssign("auth_table", authName));

  if (config.login_url !== "") nodes.push(Transform.inlineAssign("login_url", config.login_url));
  if (config.issuer !== "") nodes.push(Transform.inlineAssign("issuer", config.issuer));
  if (!phpEmpty(config.audience)) nodes.push(Transform.inlineAssign("audience", config.audience, "static:text[]"));
  if (config.audience_ack) nodes.push(Transform.inlineAssign("audience_ack", true, "static:bool"));
  if (config.claim !== "sub") nodes.push(Transform.inlineAssign("claim", config.claim));
  if (config.claim_ack) nodes.push(Transform.inlineAssign("claim_ack", true, "static:bool"));
  if (config.column !== "") nodes.push(Transform.inlineAssign("column", config.column));
  if (config.preset !== "") nodes.push(Transform.inlineAssign("preset", config.preset));
  if (!phpEmpty(config.allowed_client_ids)) nodes.push(Transform.inlineAssign("allowed_client_ids", config.allowed_client_ids, "static:text[]"));

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("oauth", nodes, "static:object"));
}
