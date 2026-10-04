/**
 * PHP semantics the XanoScript emitter port depends on.
 *
 * The emitter is a line-for-line port of the engine's PHP encoder, and byte
 * equality with that encoder is the acceptance bar. Where PHP's built-ins have
 * behaviour JavaScript's do not (`empty("0")`, `is_numeric(" 1")`, byte-length
 * `strlen`, `addcslashes`, `json_encode` escaping `/`), the port calls these
 * helpers instead of the JS near-equivalent so the decision matches.
 *
 * Data model: a PHP array (list or assoc) is a JS array or plain object; a PHP
 * stdClass — what the engine's JSON decoder keeps for an EMPTY `{}` — is a
 * `StdClass` instance (see `jsonDecode`). Everything else is a JS primitive.
 */

/** The engine keeps an empty JSON `{}` as stdClass so it stays distinct from `[]`. */
export class StdClass {
  readonly [key: string]: unknown;
}

export function isStdClass(v: unknown): v is StdClass {
  return v instanceof StdClass;
}

/** A plain object standing in for a PHP associative array. */
export function isAssoc(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof StdClass) && Object.getPrototypeOf(v) === Object.prototype;
}

/** PHP `is_array`: a list or an associative array (never stdClass, never a class instance). */
export function isPhpArray(v: unknown): v is unknown[] | Record<string, unknown> {
  return Array.isArray(v) || isAssoc(v);
}

/** PHP `is_object`: stdClass or any non-array object (RawValue, MultiLineValue, …). */
export function isPhpObject(v: unknown): boolean {
  return v !== null && typeof v === "object" && !isPhpArray(v);
}

export function isScalar(v: unknown): v is string | number | boolean | bigint {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint";
}

/** A PHP int: a JS integer, or a bigint when the value needs more than 2^53 (PHP ints are 64-bit). */
export function isInt(v: unknown): v is number | bigint {
  return typeof v === "bigint" || (typeof v === "number" && Number.isInteger(v));
}

export function isFloat(v: unknown): v is number {
  return typeof v === "number" && !Number.isInteger(v);
}

/** PHP `empty()`. Objects are never empty; "0" is. */
export function phpEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || v === "0") return true;
  if (typeof v === "number") return v === 0 || Number.isNaN(v) ? true : false;
  if (Array.isArray(v)) return v.length === 0;
  if (isAssoc(v)) return Object.keys(v).length === 0;
  return false;
}

/** The engine's mapper-empty test: casts an object to an array first, so an empty stdClass is empty. */
export function mapperEmpty(v: unknown): boolean {
  if (v instanceof StdClass) return Object.keys(v).length === 0;
  if (isPhpObject(v)) return Object.keys(v as object).length === 0;
  return phpEmpty(v);
}

/** PHP `array_is_list`. */
export function arrayIsList(v: unknown): boolean {
  return Array.isArray(v);
}

/** PHP `count()` of an array. */
export function count(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v !== null && typeof v === "object") return Object.keys(v).length;
  return 0;
}

/** Iterate a PHP array (list or assoc) as `[key, value]` pairs in insertion order. */
export function entries(v: unknown): [string | number, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x] as [number, unknown]);
  if (v !== null && typeof v === "object") return Object.entries(v as object);
  return [];
}

/** Values of a PHP array in order. */
export function values(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.slice();
  if (v !== null && typeof v === "object") return Object.values(v as object);
  return [];
}

/** PHP `is_numeric`: numbers, or numeric strings with optional surrounding whitespace. */
export function isNumeric(v: unknown): boolean {
  if (typeof v === "bigint") return true;
  if (typeof v === "number") return !Number.isNaN(v) && Number.isFinite(v);
  if (typeof v !== "string") return false;
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(v);
}

/** PHP `ctype_digit`: a non-empty string of ASCII digits. */
export function ctypeDigit(v: unknown): boolean {
  if (typeof v === "string") return /^[0-9]+$/.test(v);
  if (typeof v === "number" && Number.isInteger(v)) {
    // PHP treats an int in [-128, 255] as a character code (deprecated but live).
    if (v >= -128 && v <= 255) return v >= 48 && v <= 57;
    return /^[0-9]+$/.test(String(v));
  }
  return false;
}

/** PHP `ctype_alpha` for a single character (or string). */
export function ctypeAlpha(v: string): boolean {
  return v.length > 0 && /^[A-Za-z]+$/.test(v);
}

/** PHP `ctype_alnum`. */
export function ctypeAlnum(v: string): boolean {
  return v.length > 0 && /^[A-Za-z0-9]+$/.test(v);
}

/** PHP `ctype_space`. */
export function ctypeSpace(v: string): boolean {
  return v.length > 0 && /^[ \t\n\r\v\f]+$/.test(v);
}

/** PHP `ctype_cntrl`. */
export function ctypeCntrl(v: string): boolean {
  // eslint-disable-next-line no-control-regex -- the control range IS the predicate
  return v.length > 0 && /^[\x00-\x1f\x7f]+$/.test(v);
}

const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;

/** Clamp a decimal digit string to PHP's 64-bit int range, as a number when it fits 2^53. */
function intFromDigits(digits: string): number | bigint {
  let big = BigInt(digits);
  if (big > INT64_MAX) big = INT64_MAX;
  if (big < INT64_MIN) big = INT64_MIN;
  const n = Number(big);
  return Number.isSafeInteger(n) ? n : big;
}

/** PHP `intval`: saturates at the 64-bit range; a value past 2^53 is returned as a bigint so it prints exactly. */
export function intval(v: unknown): number | bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return Number.isSafeInteger(Math.trunc(v)) ? Math.trunc(v) : intFromDigits(BigInt(Math.trunc(v)).toString());
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    // A plain (possibly huge) integer string converts digit-exact with saturation.
    const whole = /^[ \t\n\r\v\f]*([+-]?\d+)[ \t\n\r\v\f]*$/.exec(v);
    if (whole) return intFromDigits(whole[1]!);
    // PHP intval("9.0E+15") === 9000000000000000: a fully numeric string is
    // converted as a number; otherwise the leading integer digits win.
    if (isNumeric(v)) return intval(Math.trunc(Number(v)));
    const leading = /^[ \t\n\r\v\f]*([+-]?\d+)/.exec(v);
    if (leading) return intFromDigits(leading[1]!);
    return 0;
  }
  if (Array.isArray(v)) return v.length ? 1 : 0;
  if (v === null || v === undefined) return 0;
  return 1;
}

/** PHP `floatval`. */
export function floatval(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const f = /^[ \t\n\r\v\f]*([+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(v);
    return f ? Number(f[1]) : 0;
  }
  return v ? 1 : 0;
}

/** PHP `(string)` of a float: `1.0` → "1", `0.5` → "0.5", large → "1.0E+25". */
export function floatToString(v: number): string {
  // A PHP int always prints as plain digits; only floats use `precision=14`
  // (`%.14G`: exponent form below 1e-4 or from 1e14, mantissa trailing zeros
  // stripped but always keeping one decimal, e.g. "1.0E-8", "1.5E+25").
  // JSON integers that fit 2^53 are ints on the PHP side, so they stay plain.
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp < -4 || exp >= 14) {
    const [mantissaRaw, expRaw] = v.toExponential(13).split("e") as [string, string];
    let mantissa = mantissaRaw.replace(/0+$/, "").replace(/\.$/, "");
    if (!mantissa.includes(".")) mantissa += ".0";
    const sign = expRaw.startsWith("-") ? "-" : "+";
    return `${mantissa}E${sign}${expRaw.replace(/^[+-]/, "")}`;
  }
  return String(Number(v.toPrecision(14)));
}

/** PHP string conversion of a scalar. */
export function strval(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "1" : "";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return floatToString(v);
  if (v === null || v === undefined) return "";
  return String(v);
}

const TRIM_CHARS = " \t\n\r\0\x0B";

function trimChars(chars?: string): string {
  return chars ?? TRIM_CHARS;
}

/** PHP `trim` (default character set). */
export function trim(s: string, chars?: string): string {
  const set = trimChars(chars);
  let start = 0;
  let end = s.length;
  while (start < end && set.includes(s[start]!)) start++;
  while (end > start && set.includes(s[end - 1]!)) end--;
  return s.slice(start, end);
}

export function ltrim(s: string, chars?: string): string {
  const set = trimChars(chars);
  let start = 0;
  while (start < s.length && set.includes(s[start]!)) start++;
  return s.slice(start);
}

export function rtrim(s: string, chars?: string): string {
  const set = trimChars(chars);
  let end = s.length;
  while (end > 0 && set.includes(s[end - 1]!)) end--;
  return s.slice(0, end);
}

/** PHP `strlen`: UTF-8 byte length. */
export function strlen(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** PHP `mb_strlen`: code points. */
export function mbStrlen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** PHP `mb_substr` on code points; `length` may be negative (drop from the end). */
export function mbSubstr(s: string, start: number, length?: number | null): string {
  const cps = Array.from(s);
  let from = start < 0 ? Math.max(cps.length + start, 0) : start;
  if (from > cps.length) return "";
  let to: number;
  if (length === undefined || length === null) to = cps.length;
  else if (length < 0) to = cps.length + length;
  else to = from + length;
  if (to < from) return "";
  return cps.slice(from, to).join("");
}

/** PHP `substr` on bytes is only ever used here on ASCII-structural positions; map to code units. */
export function substr(s: string, start: number, length?: number | null): string {
  let from = start < 0 ? Math.max(s.length + start, 0) : start;
  if (from > s.length) return "";
  let to: number;
  if (length === undefined || length === null) to = s.length;
  else if (length < 0) to = s.length + length;
  else to = from + length;
  if (to < from) return "";
  return s.slice(from, to);
}

/** PHP `mb_str_split($s, 1)`: code points. */
export function mbChars(s: string): string[] {
  return Array.from(s);
}

/** PHP `str_repeat`. */
export function strRepeat(s: string, n: number): string {
  return n > 0 ? s.repeat(n) : "";
}

/** PHP `ucfirst`. */
export function ucfirst(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** PHP `addcslashes($value, "\0..\37\\")`: control chars to C escapes, backslash doubled. */
export function addcslashesControl(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (code < 32) {
      switch (code) {
        case 7: out += "\\a"; break;
        case 8: out += "\\b"; break;
        case 9: out += "\\t"; break;
        case 10: out += "\\n"; break;
        case 11: out += "\\v"; break;
        case 12: out += "\\f"; break;
        case 13: out += "\\r"; break;
        default: out += "\\" + code.toString(8).padStart(3, "0");
      }
    } else out += ch;
  }
  return out;
}

/** PHP `addcslashes($value, "\0..\37\\\177..\377")` as used by `hasCtrlChars` (bytes ≥ 127 too). */
export function addcslashesControlAndHigh(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    if (byte === 92) out += "\\\\";
    else if (byte < 32 || byte >= 127) {
      switch (byte) {
        case 7: out += "\\a"; break;
        case 8: out += "\\b"; break;
        case 9: out += "\\t"; break;
        case 10: out += "\\n"; break;
        case 11: out += "\\v"; break;
        case 12: out += "\\f"; break;
        case 13: out += "\\r"; break;
        default: out += "\\" + byte.toString(8).padStart(3, "0");
      }
    } else out += String.fromCharCode(byte);
  }
  return out;
}

/** PHP `stripcslashes`. */
export function stripcslashes(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch !== "\\" || i + 1 >= value.length) {
      out += ch;
      continue;
    }
    const next = value[i + 1]!;
    switch (next) {
      case "n": out += "\n"; i++; break;
      case "t": out += "\t"; i++; break;
      case "r": out += "\r"; i++; break;
      case "a": out += "\x07"; i++; break;
      case "v": out += "\v"; i++; break;
      case "b": out += "\b"; i++; break;
      case "f": out += "\f"; i++; break;
      case "x": {
        const m = /^[0-9A-Fa-f]{1,2}/.exec(value.slice(i + 2));
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 16));
          i += 1 + m[0].length;
        } else {
          out += "x";
          i++;
        }
        break;
      }
      default: {
        const m = /^[0-7]{1,3}/.exec(value.slice(i + 1));
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 8));
          i += m[0].length;
        } else {
          out += next;
          i++;
        }
      }
    }
  }
  return out;
}

/** PHP `addslashes`. */
export function addslashes(value: string): string {
  return value.replace(/([\\'"])/g, "\\$1").replace(/\0/g, "\\0");
}

/** PHP `str_replace` with a single search string. */
export function strReplace(search: string, replace: string, subject: string): string {
  return subject.split(search).join(replace);
}

/**
 * PHP `json_encode` with default flags (escape `/`, escape non-ASCII as \uXXXX).
 * Used where the engine measures the encoded length or searches it for a token.
 */
export function phpJsonEncode(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (typeof val === "bigint") return Number(val);
    if (val !== null && typeof val === "object" && typeof (val as { jsonSerialize?: unknown }).jsonSerialize === "function") {
      return (val as { jsonSerialize: () => unknown }).jsonSerialize();
    }
    return val;
  })
    .replace(/\//g, "\\/")
    .replace(/[-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/**
 * PHP `json_decode` as the engine calls it (`JSON_BIGINT_AS_STRING`, then
 * `walkObj`): objects become assoc arrays, EMPTY objects stay stdClass, and an
 * integer literal past 2^53 keeps its digits — as a bigint inside the 64-bit
 * range (a PHP int), as a string beyond it (what the flag does).
 */
export function jsonDecode(text: string): unknown {
  const reviver = (_key: string, value: unknown, context?: { source?: string }): unknown => {
    if (typeof value === "number" && context?.source && /^-?\d+$/.test(context.source) && !Number.isSafeInteger(value)) {
      const big = BigInt(context.source);
      if (big > INT64_MAX || big < INT64_MIN) return context.source;
      return big;
    }
    return value;
  };
  return walkObj((JSON.parse as (t: string, r: typeof reviver) => unknown)(text, reviver));
}

/** The engine's the engine's `walkObj`: recursively convert objects to arrays, keeping empty ones as stdClass. */
export function walkObj(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(walkObj);
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v as object);
    if (keys.length === 0) return new StdClass();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = walkObj((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** PHP loose `==` for the scalar cases the port hits (id comparisons). */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined || b === "" || b === false;
  if (b === null || b === undefined) return a === "" || a === false;
  if (typeof a === "number" && typeof b === "string") return isNumeric(b) ? Number(b) === a : String(a) === b;
  if (typeof a === "string" && typeof b === "number") return isNumeric(a) ? Number(a) === b : a === String(b);
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  if (typeof a === "string" && typeof b === "string" && isNumeric(a) && isNumeric(b)) return Number(a) === Number(b);
  return false;
}

/** PHP `in_array` (loose). */
export function inArrayLoose(needle: unknown, haystack: unknown[]): boolean {
  return haystack.some((h) => looseEquals(needle, h));
}

/** PHP `array_unique` on strings (keeps first occurrence). */
export function arrayUnique<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

/** PHP `substr_count`. */
export function substrCount(haystack: string, needle: string): number {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}

/** PHP `strcasecmp`-style comparator (byte-wise, case-insensitive). */
export function strcasecmp(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
