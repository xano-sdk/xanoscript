/**
 * Port of the parts of the engine's schema-key parameter reader the kind parsers use: reading a
 * schema key like `sort[]?`, `lock?=false`, `?name?=null` or `value[][]?=[]`
 * into its name, optionality, default and list/hash wrapping.
 */
import { ctypeAlnum, ctypeDigit, isNumeric, ltrim, rtrim, stripcslashes, trim } from "./php.js";

export interface ParsedParam {
  name: string;
  required: boolean;
  default: unknown;
  hasDefault: boolean;
  wrap: Array<{ type: "list" | "hash"; data: string }> | false;
  op: string;
  nullable: boolean;
  private: boolean;
}

const NUM = /^[0-9]+(?:\.[0-9]+)?/;
const STRING = /^"([^#"\\]*(?:\\.[^#"\\]*)*)"|^'([^'\\]*(?:\\.[^'\\]*)*)'/s;
const PATTERN_ARRAY = /^\[.*\]/s;
const PATTERN_OBJECT = /^\{.*\}/s;

const cache = new Map<string, ParsedParam>();

function getFirstElement(block: string): string {
  return block.split("=")[0]!;
}

function tryJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** The first `name=default` unit of a key, stopping before any `|filter` pipe. */
function getFirstBlock(key: string): string {
  const eq = key.indexOf("=");
  if (eq === -1) return key.split("|")[0]!;

  let bar = key.indexOf("|");
  if (bar === -1) return key;

  let i = Math.min(bar, eq);
  const len = key.length;
  let quote: string | false = false;
  bar = -1;
  for (; i < len; i++) {
    const ch = key[i]!;
    if (!quote) {
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
    } else {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = false;
      continue;
    }
    if (ch === "|") {
      bar = i;
      break;
    }
  }

  if (bar === -1) return key;
  if (bar < eq || eq + 1 === bar) return key.split("|")[0]!;

  const params = key.substring(eq + 1, bar);

  if (["null", "false", "true"].includes(params)) return key.substring(0, eq + 1 + params.length);

  let m = NUM.exec(params);
  if (m) return key.substring(0, eq + 1 + m[0].length);
  m = STRING.exec(params);
  if (m) return key.substring(0, eq + 1 + m[0].length);
  m = PATTERN_ARRAY.exec(params);
  if (m) {
    if (tryJson(m[0]).ok) return key.substring(0, eq + 1 + m[0].length);
  } else {
    m = PATTERN_OBJECT.exec(params);
    if (m && tryJson(m[0]).ok) return key.substring(0, eq + 1 + m[0].length);
  }
  throw new Error(`Invalid pattern: ${key}`);
}

function validateName(name: string, extras = ""): void {
  for (const ch of name) {
    if (extras.includes(ch)) continue;
    if (ctypeAlnum(ch)) continue;
    throw new Error(`Invalid column syntax: ${name}`);
  }
}

function simplyStripQuotes(str: string): string {
  if (str.startsWith('"') && str.endsWith('"')) {
    return stripcslashes(str.substring(1, str.length - 1));
  }
  if (str.startsWith("'") && str.endsWith("'")) {
    return str.substring(1, str.length - 1).split("\\\\").join("\u0000").split("\\'").join("'").split("\u0000").join("\\");
  }
  return str;
}

function getName(el: string, validate = true): string {
  el = getFirstElement(el);
  let result = rtrim(el, "?+-");
  result = ltrim(result, "?");

  while (true) {
    const listTest = rtrim(result, "]}");
    if (listTest !== result) {
      result = rtrim(listTest, "0123456789:");
      result = rtrim(result, "?!");
      result = rtrim(result, "[{");
      continue;
    }
    break;
  }
  if (validate) {
    validateName(result, "_:-@!?");
    if ((result[0] ?? "") === "-") throw new Error(`Invalid column syntax: ${result}`);
  }
  return simplyStripQuotes(result);
}

function hasDefault(block: string): boolean {
  const parts = block.split("=");
  return parts[1] !== undefined && parts.slice(1).join("=").length > 0;
}

/** A tiny YAML-scalar reader standing in for the engine's YAML decode of a default token. */
function yamlScalar(params: string): { ok: boolean; value: unknown } {
  const t = trim(params);
  if (t === "") return { ok: true, value: null };
  if (t === "~") return { ok: true, value: null };
  if (t === "[]") return { ok: true, value: [] };
  if (t === "{}") return { ok: true, value: {} };
  if (t.startsWith("[") || t.startsWith("{")) {
    const j = tryJson(t);
    return j.ok ? j : { ok: false, value: undefined };
  }
  if (t.startsWith('"') || t.startsWith("'")) {
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return { ok: true, value: simplyStripQuotes(t) };
    }
    return { ok: false, value: undefined };
  }
  if (t === "true") return { ok: true, value: true };
  if (t === "false") return { ok: true, value: false };
  if (t === "null") return { ok: true, value: null };
  if (/^[-+]?\d+$/.test(t)) return { ok: true, value: parseInt(t, 10) };
  if (isNumeric(t)) return { ok: true, value: Number(t) };
  return { ok: true, value: t };
}

function getDefault(block: string): unknown {
  const ret = block.indexOf("=");
  if (ret === -1) return null;
  let params = block.substring(ret + 1);

  if (params === "null") return null;
  if (params === "true") return true;
  if (params === "false") return false;

  const y = yamlScalar(params);
  if (y.ok) {
    let result = y.value;
    if ((result === null || (typeof result === "object" && result !== null && Object.keys(result as object).length === 0)) && params === "{}") {
      result = {};
    }
    if (result !== null && result !== undefined) return result;
  }

  let m = NUM.exec(params);
  if (m) return m[0].includes(".") ? Number(m[0]) : parseInt(m[0], 10);
  m = STRING.exec(params);
  if (m) return stripcslashes(trim(m[0], "'\""));
  m = PATTERN_ARRAY.exec(params);
  if (m) {
    const j = tryJson(m[0]);
    if (j.ok) return j.value;
  } else {
    m = PATTERN_OBJECT.exec(params);
    if (m) {
      const j = tryJson(m[0]);
      if (j.ok) return j.value;
    }
  }
  return params;
}

function getWrap(el: string, off = 0): ParsedParam["wrap"] {
  const len = el.length;
  let openList = false;
  let openHash = false;
  let data = "";
  const wrap: Array<{ type: "list" | "hash"; data: string }> = [];

  outer: for (let i = off; i < len; i++) {
    switch (el[i]) {
      case "=":
        break outer;
      case "[":
        openList = true;
        data = "";
        break;
      case "]":
        if (openList) {
          openList = false;
          wrap.push({ type: "list", data });
        }
        break;
      case "{":
        openHash = true;
        data = "";
        break;
      case "}":
        if (openHash) {
          openHash = false;
          wrap.push({ type: "hash", data });
        }
        break;
      default:
        if (openHash || openList) data += el[i]!;
    }
  }
  return wrap.length === 0 ? false : wrap;
}

function isNullable(el: string): boolean {
  return el[0] === "?";
}

function isOptional(el: string): boolean {
  el = getFirstElement(el);
  el = ltrim(el, "?");
  return el.includes("?");
}

function getOp(el: string): string {
  el = getFirstElement(el);
  const result = rtrim(el, "+-.");
  if (result !== el) {
    const findMe = el.substring(el.length - result.length);
    if (findMe.includes("+")) return "+";
    if (findMe.includes("-")) return "-";
    if (findMe.includes(".")) return ".";
  }
  return "=";
}

/** the engine's `parseAssignment($key, $validate)`. */
export function parseAssignment(entry: string, validate = true): ParsedParam {
  const cacheKey = `${validate ? 1 : 0}:${entry}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const el = getFirstBlock(entry);
  const name = getName(el, validate);
  const a: ParsedParam = {
    name,
    required: !isOptional(el),
    default: getDefault(el),
    hasDefault: hasDefault(el),
    wrap: getWrap(el, name.length),
    op: getOp(el),
    nullable: isNullable(el),
    private: false,
  };
  a.private = a.default !== null && a.required;

  cache.set(cacheKey, a);
  return a;
}

export function isDigits(s: string): boolean {
  return ctypeDigit(s);
}
