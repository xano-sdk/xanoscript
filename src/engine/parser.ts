/**
 * Port of the static helpers on redacted the encoder calls:
 * quoting, wrapping, splitting on pipes/colons/dots, and the "is this text
 * wrapped in …" predicates that drive parenthesization decisions.
 */
import { isGroupSupported, parseGroup } from "./group-parser.js";
import { MalformedError, UnexpectedError } from "./errors.js";
import { parseMultiline, prepForParse } from "./multiline-parser.js";
import {
  addcslashesControl,
  addcslashesControlAndHigh,
  ctypeAlnum,
  ctypeDigit,
  isNumeric,
  ltrim,
  mbSubstr,
  phpEmpty,
  stripcslashes,
  strval,
  trim,
} from "./php.js";
import { renderState } from "./state.js";
import { MultiLineValue } from "./values.js";

const STRING_VALUED_SCHEMA_TYPES = ["text", "email", "password", "enum", "uuid"];

const splitVarCache = new Map<string, string[]>();

/** PHP string coercion for the str_* predicates: strings pass, Stringable objects render, the rest is not a string. */
function asStr(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v instanceof MultiLineValue || (v !== null && typeof v === "object" && typeof (v as { getValue?: unknown }).getValue === "function")) return String(v);
  return null;
}

export class Parser {
  static QUOTE_CHAR = '"';
  static NEWLINE_CHAR = "\n";
  static BACKSLASH_CHAR = "\\";
  static FORWARDSLASH_CHAR = "/";
  static SINGLE_QUOTE_CHAR = "'";
  static EXCLAMATION_CHAR = "!";
  static SPACE_CHAR = " ";
  static PIPE_CHAR = "|";
  static TICK_CHAR = "`";

  static isMultilineTicksEnabled(): boolean {
    return renderState.multilineTicks;
  }

  /** Swap the tick-multiline flag, returning the previous value (mirrors `setMultilineTicks`). */
  static setMultilineTicks(multiline: boolean): boolean {
    const old = renderState.multilineTicks;
    renderState.multilineTicks = multiline;
    return old;
  }

  static setMultilineQuotes(multiline: boolean): boolean {
    const old = renderState.multilineQuotes;
    renderState.multilineQuotes = multiline;
    return old;
  }

  static isVarName(value: string): boolean {
    try {
      Parser.splitVar(value, true, true);
    } catch {
      return false;
    }
    return true;
  }

  static wrapVarName(value: unknown): string {
    const v = strval(value);
    if (Parser.isVarName(v)) return v;
    for (const name of ["$this", "$index"]) {
      if (v === name || v.startsWith(name + ".")) return v;
    }
    const parts = Parser.splitVar(v);
    return Parser.joinVar(parts);
  }

  static wrapResponseName(value: unknown): string {
    const parts = Parser.splitVar(strval(value));
    return Parser.joinVar(parts);
  }

  static wrapSchemaName(value: string, _kind = "", argNameIsVar = false): string {
    if (value === '""') return value;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return value;

    if (argNameIsVar) {
      if (value === "$") return value;
      const parts = Parser.splitVar(ltrim(value, "$"));
      if (!/^[A-Za-z0-9_-]+$/.test(parts[0] ?? "")) {
        throw new MalformedError("Invalid variable syntax.");
      }
      return "$" + Parser.joinVar(parts);
    }

    return Parser.wrapText(value);
  }

  static schemaKindIsStringValued(kind: string): boolean {
    let type = kind;
    if (type.startsWith("schema:")) type = type.substring(7);
    if (type.endsWith("[]")) type = type.substring(0, type.length - 2);
    return STRING_VALUED_SCHEMA_TYPES.includes(type);
  }

  static wrapDefaultValueWithinSchema(value: unknown, kind = ""): string {
    const stringValued = kind === "" ? true : Parser.schemaKindIsStringValued(kind);

    if (typeof value !== "string") {
      if (stringValued) return Parser.wrapText(strval(value));
      value = strval(value);
    }
    const v = value as string;

    if (v === '""' || v === "") return '""';

    if (stringValued) {
      const lower = v.toLowerCase();
      if (lower === "true" || lower === "false" || lower === "null" || isNumeric(v)) {
        return Parser.wrapText(v);
      }
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)) return v;
      return Parser.wrapText(v);
    }

    for (const ch of v) {
      if (ctypeAlnum(ch)) continue;
      return Parser.wrapText(v);
    }
    return v;
  }

  static stripParentheses<T>(str: T): T | string {
    if (typeof str === "string" && str.startsWith("(") && str.endsWith(")")) {
      const ret = parseGroup(str);
      if (ret === str) return mbSubstr(str, 1, -1);
    }
    return str;
  }

  static stripQuotes<T>(str: T, _strip = true, strict = false): T | string {
    if (typeof str !== "string") return str;
    let s: string = str;
    if (s.startsWith(Parser.QUOTE_CHAR) && s.endsWith(Parser.QUOTE_CHAR)) {
      if (strict) {
        const ret = parseGroup(s);
        if (ret !== s) return s;
      }
      s = mbSubstr(s, 1, -1);
      s = stripcslashes(s);
    } else if (s.startsWith(Parser.SINGLE_QUOTE_CHAR) && s.endsWith(Parser.SINGLE_QUOTE_CHAR)) {
      if (strict) {
        const ret = parseGroup(s);
        if (ret !== s) return s;
      }
      s = mbSubstr(s, 1, -1);
      s = s.split("\\\\").join("\u0000BS\u0000").split("\\'").join("'").split("\u0000BS\u0000").join("\\");
    }
    return s;
  }

  static escapeMultiline<T>(str: T): T | string {
    if (typeof str === "string") return str.split("\n").join("\\n");
    return str;
  }

  static unescapeMultiline<T>(str: T): T | string {
    if (typeof str === "string") return str.split("\\n").join("\n");
    return str;
  }

  static isMultilineQuotes(str: unknown): boolean {
    return renderState.multilineQuotes && typeof str === "string" && str.includes("\n");
  }

  static isMultilineTicks(str: unknown): boolean {
    return renderState.multilineTicks && typeof str === "string" && trim(str).includes("\n");
  }

  static isWrappedInMultilineSyntax(strIn: unknown): boolean {
    const str = asStr(strIn);
    if (str === null) return false;
    for (const pattern of ['"""', "'''", "```"]) {
      if (str.startsWith(pattern)) return true;
    }
    return false;
  }

  static isWrappedInQuotes(str: unknown): boolean {
    return Parser.isWrapped(str, Parser.QUOTE_CHAR) || Parser.isWrapped(str, Parser.SINGLE_QUOTE_CHAR);
  }

  static isWrappedInCurlyBrackets(str: unknown): boolean {
    return Parser.isWrapped(str, "{", "}");
  }

  static isWrappedInParentheses(str: unknown): boolean {
    return Parser.isWrapped(str, "(", ")");
  }

  static isWrappedInBrackets(str: unknown): boolean {
    return Parser.isWrapped(str, "[", "]");
  }

  static isWrappedInTicks(str: unknown): boolean {
    return Parser.isWrapped(str, Parser.TICK_CHAR);
  }

  static hasQuotes(strIn: unknown): boolean {
    const str = asStr(strIn);
    return str !== null && (str.startsWith(Parser.QUOTE_CHAR) || str.startsWith(Parser.SINGLE_QUOTE_CHAR));
  }

  static hasQuotesAndIsNotExpression(str: string): boolean {
    let ret = Parser.hasQuotes(str);
    if (ret) {
      const group = parseGroup(str);
      let remainder = mbSubstr(str, group.length);
      remainder = ltrim(remainder);
      if (!phpEmpty(remainder) && !remainder.startsWith("|")) ret = false;
    }
    return ret;
  }

  static hasTicks(strIn: unknown): boolean {
    const str = asStr(strIn);
    return str !== null && str.startsWith(Parser.TICK_CHAR);
  }

  static mightByBadSyntax(strIn: unknown): boolean {
    const str = asStr(strIn);
    if (str === null) return false;
    if (isGroupSupported(str)) {
      try {
        parseGroup(str);
      } catch {
        return true;
      }
    }
    return false;
  }

  static stripTicks<T>(str: T): T | string {
    if (typeof str === "string" && str.startsWith(Parser.TICK_CHAR) && str.endsWith(Parser.TICK_CHAR)) {
      let s = mbSubstr(str, 1, -1);
      s = s.split("\\\\").join("\u0000BS\u0000").split("\\`").join("`").split("\u0000BS\u0000").join("\\");
      return s;
    }
    return str;
  }

  static unescapeExpression<T>(str: T): T | string {
    if (typeof str === "string") {
      if (Parser.isWrappedInMultilineSyntax(str)) {
        const prepped = prepForParse(str);
        return parseMultiline(prepped, "```").result;
      }
      return Parser.stripTicks(str);
    }
    return str;
  }

  static hasCtrlChars(value: unknown): boolean {
    if (typeof value === "string") {
      let value2 = addcslashesControlAndHigh(value);
      value2 = value2.split("\\\\").join("\\");
      return value !== value2;
    }
    return false;
  }

  static wrapText(value: unknown): string {
    const v = strval(value);
    const quoteMode = renderState.quoteMode;
    if (quoteMode) return Parser.wrap(v, quoteMode);

    if (v.includes(Parser.QUOTE_CHAR)) {
      if (!Parser.hasCtrlChars(v)) {
        return Parser.wrap(v, Parser.SINGLE_QUOTE_CHAR);
      }
    }
    return Parser.wrap(v, Parser.QUOTE_CHAR);
  }

  static wrapExpressionText(value: unknown): string {
    if (Parser.isMultilineTicks(value)) {
      return new MultiLineValue(value as string, "const:expr2", 2).toString();
    }
    return Parser.wrap(strval(value), Parser.TICK_CHAR);
  }

  static isWrapped(valueIn: unknown, start: string, stop: string | null = null): boolean {
    const value = asStr(valueIn);
    if (value === null) return false;
    let ret = value.startsWith(start) && value.endsWith(stop ?? start);
    if (ret && start.length === 1 && !value.startsWith(start.repeat(3))) {
      try {
        const group = parseGroup(value);
        return group === value;
      } catch {
        return false;
      }
    }
    return ret;
  }

  static wrap(value: string, ch: string): string {
    if (ch === Parser.QUOTE_CHAR) {
      let v = addcslashesControl(value);
      v = ch + v.split(ch).join(Parser.BACKSLASH_CHAR + ch) + ch;
      return v;
    }
    return Parser.wrapSingleQuoteMethod(value, ch);
  }

  static wrapSingleQuoteMethod(value: string, quoteChar = Parser.SINGLE_QUOTE_CHAR): string {
    let ret = "";
    const len = value.length;
    for (let i = 0; i < len; i++) {
      const ch = value[i]!;
      if (ch === quoteChar) {
        ret += Parser.BACKSLASH_CHAR + ch;
        continue;
      }
      if (ch === Parser.BACKSLASH_CHAR) {
        const next = value[i + 1];
        if (next === undefined) {
          ret += ch + ch;
          continue;
        } else if (next === ch) {
          ret += ch + ch + ch + ch;
          i++;
          continue;
        } else if (next === quoteChar) {
          ret += ch + ch + ch + quoteChar;
          i++;
          continue;
        }
      }
      ret += ch;
    }
    return quoteChar + ret + quoteChar;
  }

  static wrapTicks(value: string): string {
    return Parser.wrap(value, Parser.TICK_CHAR);
  }

  static getPipePositionFromRawValue(value: string): number | false {
    let offset = 0;
    try {
      const ret = Parser.splitPipe(value);
      if (ret.length > 1) {
        offset = ret[0]!.length;
      } else {
        const group = parseGroup(value);
        offset = group.length;
      }
    } catch {
      // ignore
    }

    const pos = value.indexOf("|", offset);
    if (pos === -1) return false;
    if (pos) {
      if (value.substring(pos, pos + 2) === "||") return false;
    }
    return pos;
  }

  static split(delimiter: string, value: string, doTrim = true, notNext: string[] = []): string[] {
    let parts: string[] = [];
    let str = "";
    const len = value.length;

    outer: for (let i = 0; i < len; i++) {
      const ch = value[i]!;
      switch (ch) {
        case delimiter:
          if (notNext.length) {
            for (const find of notNext) {
              const findMe = value.substring(i + 1, i + 1 + find.length);
              if (findMe === find) {
                str += ch + findMe;
                i += find.length;
                continue outer;
              }
            }
          }
          parts.push(str);
          str = "";
          continue outer;
        case "(":
        case "{":
        case "[":
        case Parser.QUOTE_CHAR:
        case Parser.SINGLE_QUOTE_CHAR:
        case Parser.TICK_CHAR: {
          if (ch === Parser.SINGLE_QUOTE_CHAR || ch === Parser.QUOTE_CHAR || ch === Parser.TICK_CHAR) {
            const pk = value.substring(i + 1, i + 3);
            if (pk === ch + ch) {
              const newStr = value.substring(i + 3);
              const result = parseMultiline(newStr, ch + ch + ch);
              const cnt = result.cnt + 2;
              const taken = value.substring(i, i + cnt);
              str += taken;
              i += cnt - 1;
              continue outer;
            }
          }
          const newStr = value.substring(i);
          let ret: string;
          try {
            ret = parseGroup(newStr, true);
          } catch {
            ret = Parser.wrapTicks(newStr);
          }
          str += ret;
          i += ret.length - 1;
          continue outer;
        }
      }
      str += ch;
    }

    if (str.length > 0) parts.push(str);

    if (doTrim) {
      parts = parts.map((x) => trim(x)).filter((x) => x.length > 0);
    }
    return parts;
  }

  static splitColon(value: string): string[] {
    return Parser.split(":", value);
  }

  static splitPipe(value: string): string[] {
    return Parser.split("|", value, true, ["|"]);
  }

  static joinPipe(parts: string[]): string {
    return parts.join("|");
  }

  static splitVar(value: unknown, expression = true, doThrow = false): string[] {
    const key = `${expression ? 1 : 0}${doThrow ? 1 : 0}:${strval(value)}`;
    const cached = splitVarCache.get(key);
    if (cached) return cached.slice();
    const ret = Parser.splitVarImpl(strval(value), expression, doThrow);
    if (splitVarCache.size > 5000) splitVarCache.clear();
    splitVarCache.set(key, ret);
    return ret.slice();
  }

  static splitVarImpl(value: string, expression: boolean, doThrow: boolean): string[] {
    value = trim(value);
    if (value.length === 0) {
      if (doThrow) throw new MalformedError("Empty variable name");
      return [""];
    }

    const parts: string[] = [];
    let str = "";
    const len = value.length;

    outer: for (let i = 0; i < len; i++) {
      const ch = value[i]!;
      switch (ch) {
        case ".": {
          const next = value.substring(i + 1, i + 2);
          if (next === ch) {
            str += ch;
            i++;
            continue outer;
          }
          if (str.length > 0) parts.push(str);
          str = "";
          continue outer;
        }
        case '"':
        case "'":
          if (str.length === 0) {
            const newStr = value.substring(i);
            const ret = parseGroup(newStr, true);
            parts.push(Parser.stripQuotes(ret.substring(1, ret.length - 1)) as string);
            i += ret.length - 1;
            continue outer;
          }
          break;
        case "[": {
          if (str.length > 0) parts.push(str);
          str = "";
          const newStr = value.substring(i);
          const ret = parseGroup(newStr, true);
          const noBrackets = ret.substring(1, ret.length - 1);
          if (Parser.hasQuotes(noBrackets)) {
            parts.push(Parser.stripQuotes(noBrackets) as string);
          } else if (ctypeDigit(noBrackets)) {
            parts.push(noBrackets);
          } else {
            let r = ret;
            if (!expression) {
              const tmp = parts.pop();
              if (tmp !== undefined) r = tmp + r;
            }
            parts.push(r);
          }
          i += ret.length - 1;
          continue outer;
        }
        default:
          if (ctypeAlnum(ch)) break;
          if (ch === "_") break;
          if (ch === "$" && str === "") break;
          if (doThrow) throw new UnexpectedError(ch);
      }
      str += ch;
    }

    if (str.length > 0) parts.push(str);
    return parts;
  }

  static getRootVar(value: string): string {
    return Parser.splitVar(value)[0]!;
  }

  static joinVar(parts: string[], strict = true): string {
    let str = "";
    for (let part of parts) {
      const test = ltrim(part, "$");
      let isVarName: boolean;
      if (str === "" && strict) {
        isVarName = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(test);
      } else {
        isVarName = /^[a-zA-Z0-9_]*$/.test(test);
      }
      if (isVarName && ctypeDigit(part)) isVarName = false;

      if (isVarName) {
        if (str !== "" && str !== "$") str += ".";
      } else {
        if (!part.startsWith("[")) {
          if (!ctypeDigit(part)) part = Parser.wrapText(part);
          part = `[${part}]`;
        }
      }
      str += part;
    }
    return str;
  }

  static hasPipes(str: unknown): boolean {
    if (typeof str === "string" && str.includes("|")) {
      const parts = Parser.splitPipe(str);
      if (parts.length > 1) return true;
    }
    return false;
  }

  static removeQuotes(str: string): string {
    return str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, "");
  }
}
