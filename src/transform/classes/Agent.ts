/** Port of redacted. */
import { script } from "../../engine/context.js";
import { StdClass, floatval, intval, isNumeric, isPhpArray, looseEquals, phpEmpty, strval } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:agent";

export function Agent(dataIn: Record<string, unknown>): KindNode {
  const data: Record<string, unknown> = { ...dataIn };
  if (data.agent_settings !== undefined && data.agent_settings !== null) {
    data.agent_settings = jsonRoundTrip(data.agent_settings) ?? [];
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  blocks.push(Transform.inlineAssign("canonical", data.canonical ?? null));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  onLLM(data, ret);

  onOutput(data, ret);

  Transform.onSchemaToolMapping(data, ret);
  Transform.onSchemaRequestHistory(data, ret, "tool_enabled", "tool_limit");

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/**
 * `json_decode(json_encode($x), true)`: every object becomes a PHP array, so
 * the empty stdClass the engine's decoder keeps for `{}` collapses to `[]`.
 */
function jsonRoundTrip(v: unknown): unknown {
  if (v instanceof StdClass) return [];
  if (Array.isArray(v)) return v.map(jsonRoundTrip);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = jsonRoundTrip(val);
    return out;
  }
  return v;
}

/** `$a["b"]["c"] ?? $fallback`: a missing OR null leaf yields the fallback. */
function coalesce(path: string, obj: unknown, fallback: unknown): unknown {
  const v = mapperGet(path, obj, fallback);
  return v === null || v === undefined ? fallback : v;
}

function onOutput(item: Record<string, unknown>, schema: KindNode): void {
  if (!phpEmpty(mapperGet("agent_settings.structuredOutputs", item)) && !phpEmpty(mapperGet("agent_settings.structuredOutputsSchema", item))) {
    (schema.blocks as KindNode[]).push(Transform.onSchemaOutput(mapperGet("agent_settings.structuredOutputsSchema", item)));
  }
}

function onLLM(item: Record<string, unknown>, schema: KindNode): void {
  const llm: KindNode[] = [];

  let type = coalesce("agent_settings.type", item, "");
  if (phpEmpty(type)) type = "anthropic";

  llm.push(Transform.inlineAssign("type", type));
  llm.push(Transform.inlineAssign("system_prompt", coalesce("agent_settings.system_prompt", item, "")));
  llm.push(Transform.inlineAssign("max_steps", coalesce("agent_settings.max_steps", item, 0), "static:int"));

  onPrompt(item.agent_settings, llm);

  const configKey = `agent_settings.configs.${strval(type)}`;
  let config = mapperGet(configKey, item, []);
  if (!isPhpArray(config)) config = [];
  const c = config as Record<string, unknown>;

  // PHP `switch` compares loosely.
  if (looseEquals(type, "anthropic")) onLLMAnthropic(c, llm);
  else if (looseEquals(type, "google-genai")) onLLMGoogleGenAi(c, llm);
  else if (looseEquals(type, "openai")) onLLMOpenAi(c, llm);
  else if (looseEquals(type, "xano-free")) onLLMXanoFree(c, llm);

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("llm", llm, "static:object"));
}

function onPrompt(item: unknown, blocks: KindNode[]): void {
  switch (coalesce("prompt_type", item, "prompt")) {
    case "prompt":
      blocks.push(Transform.inlineAssign("prompt", coalesce("prompt", item, "")));
      break;
    case "messages":
      blocks.push(Transform.inlineAssign("messages", coalesce("prompt_messages", item, "")));
      break;
  }
}

/** Empty/non-numeric legacy values (e.g. "{{$args.temperature}}") collapse to 0. */
function temperatureOf(item: Record<string, unknown>): number {
  let temperature: unknown = item.temperature ?? 1;
  if (!isNumeric(temperature)) temperature = 0;
  return floatval(temperature);
}

function onLLMAnthropic(item: Record<string, unknown>, blocks: KindNode[]): void {
  blocks.push(Transform.inlineAssign("api_key", item.apiKey ?? ""));
  blocks.push(Transform.inlineAssign("model", item.model ?? "claude-4-sonnet-20250514"));
  blocks.push(Transform.inlineAssign("temperature", temperatureOf(item), "static:decimal"));
  blocks.push(Transform.inlineAssign("reasoning", item.sendReasoning ?? true, "static:bool"));

  if (looseEquals(coalesce("thinking.type", item, ""), "enabled")) {
    blocks.push(Transform.inlineAssign("thinking_tokens", coalesce("thinking.budgetTokens", item, 0), "static:int"));
  }

  blocks.push(Transform.inlineAssign("baseURL", item.baseURL ?? ""));
  blocks.push(Transform.inlineAssign("headers", item.headers ?? ""));
}

function onLLMGoogleGenAi(item: Record<string, unknown>, blocks: KindNode[]): void {
  blocks.push(Transform.inlineAssign("api_key", item.apiKey ?? ""));
  blocks.push(Transform.inlineAssign("model", item.model ?? "gemini-2.5-flash"));
  blocks.push(Transform.inlineAssign("temperature", temperatureOf(item), "static:decimal"));
  blocks.push(Transform.inlineAssign("search_grounding", item.useSearchGrounding ?? false, "static:bool"));

  const thinkingConfig = (isPhpArray(item.thinkingConfig ?? null) ? item.thinkingConfig : []) as Record<string, unknown>;
  const thinkingBudget = thinkingConfig.thinkingBudget ?? 0;
  blocks.push(Transform.inlineAssign("thinking_tokens", isNumeric(thinkingBudget) ? intval(thinkingBudget) : 0, "static:int"));
  blocks.push(Transform.inlineAssign("include_thoughts", thinkingConfig.includeThoughts ?? false, "static:bool"));

  blocks.push(Transform.inlineAssign("baseURL", item.baseURL ?? ""));
  blocks.push(Transform.inlineAssign("headers", item.headers ?? ""));
  blocks.push(Transform.inlineAssign("safety_settings", item.safetySettings ?? ""));
  blocks.push(Transform.inlineAssign("dynamic_retrival", item.dynamicRetrievalConfig ?? ""));
}

function onLLMOpenAi(item: Record<string, unknown>, blocks: KindNode[]): void {
  blocks.push(Transform.inlineAssign("api_key", item.apiKey ?? ""));
  blocks.push(Transform.inlineAssign("model", item.model ?? "gpt-5-mini"));
  blocks.push(Transform.inlineAssign("temperature", temperatureOf(item), "static:decimal"));
  blocks.push(Transform.inlineAssign("reasoning_effort", item.reasoningEffort ?? "medium"));

  blocks.push(Transform.inlineAssign("baseURL", item.baseURL ?? ""));
  blocks.push(Transform.inlineAssign("headers", item.headers ?? ""));
  blocks.push(Transform.inlineAssign("organization", item.organization ?? ""));
  blocks.push(Transform.inlineAssign("project", item.project ?? ""));
  blocks.push(Transform.inlineAssign("compatibility", item.compatibility ?? ""));
}

function onLLMXanoFree(item: Record<string, unknown>, blocks: KindNode[]): void {
  blocks.push(Transform.inlineAssign("temperature", temperatureOf(item), "static:decimal"));
  blocks.push(Transform.inlineAssign("search_grounding", item.useSearchGrounding ?? false, "static:bool"));

  const thinkingConfig = (isPhpArray(item.thinkingConfig ?? null) ? item.thinkingConfig : []) as Record<string, unknown>;
  const thinkingBudget = thinkingConfig.thinkingBudget ?? 0;
  blocks.push(Transform.inlineAssign("thinking_tokens", isNumeric(thinkingBudget) ? intval(thinkingBudget) : 0, "static:int"));
  blocks.push(Transform.inlineAssign("include_thoughts", thinkingConfig.includeThoughts ?? false, "static:bool"));

  blocks.push(Transform.inlineAssign("baseURL", item.baseURL ?? ""));
  blocks.push(Transform.inlineAssign("headers", item.headers ?? ""));
  blocks.push(Transform.inlineAssign("safety_settings", item.safetySettings ?? ""));
  blocks.push(Transform.inlineAssign("dynamic_retrival", item.dynamicRetrievalConfig ?? ""));
}
