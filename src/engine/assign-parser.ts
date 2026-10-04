/**
 * Port of redacted: the right-hand-side value parser and the
 * expression-shape predicates. The encoder needs the parser to re-render
 * array/object literals canonically (`StaticArray`/`StaticObject` reformat)
 * and the predicates to decide when an expression must be backtick-wrapped.
 */
import { parseGroup } from "./group-parser.js";
import { UnexpectedError } from "./errors.js";
import { parseMultiline, prepForParse } from "./multiline-parser.js";
import { Parser } from "./parser.js";
import {
  StdClass,
  ctypeDigit,
  ctypeSpace,
  isFloat,
  isInt,
  isNumeric,
  ltrim,
  mbSubstr,
  phpEmpty,
  rtrim,
  strval,
  substrCount,
  trim,
} from "./php.js";
import { StaticArray } from "./static-array.js";
import { StaticObject } from "./static-object.js";
import { normalizeIndent } from "./system.js";
import { ValueHelper } from "./value-helper.js";
import { peek, xtFastParse, type XtItem } from "./xt-parser.js";
import { Transform } from "../transform/transform.js";

export const MODE_LEFT = "left";
export const MODE_RIGHT = "right";

export const SYMBOL_OPS = ["=", "!", "<", ">", "*", "%", "/", "+", "-", "~", "?", "@>", "&&", "||"];
export const JOIN_OPS = [".."];
export const SEPERATOR_OPS = [
  "+", "-", "/", "*", "%", "=", "==", "===", "!=", "!==", "<", "<=", ">", ">=", "@>",
  "contains", "not contains", "overlaps", "not overlaps", "in", "not in", "includes", "not includes",
  "ilike", "not ilike", "search",
];
export const GROUP_OPS = ["&&", "||"];
export const WORD_OPS = ["contains", "overlaps", "in", "includes", "ilike", "search"];

export interface AssignResult {
  kind: string;
  name: unknown;
  value: unknown;
  filter?: string;
  raw?: string;
  disabled?: boolean;
}

/** PHP `consumeEntry` on the parser base class: trims and re-types the buffered token. */
function typeEntry(raw: string): unknown {
  const entry = trim(raw);
  if (entry === "true") return true;
  if (entry === "false") return false;
  if (entry === "null") return null;
  if (ctypeDigit(entry)) return parseInt(entry, 10);
  if (isNumeric(entry)) return Number(entry);
  return entry;
}

const KIND_BY_TYPE: Record<string, string> = {
  var: "assign:var",
  input: "assign:input",
  output: "assign:output",
  trycatch: "assign:error",
  response: "assign:response",
  col: "assign:db",
  env: "assign:env",
  timestamp: "assign:timestamp",
};

function kindForType(type: string | null | undefined, withResponse = true): string {
  if (!type) return "assign:text";
  if (type === "response" && !withResponse) return "assign:text";
  return KIND_BY_TYPE[type] ?? "assign:text";
}

class AssignParser {
  entry = "";
  captured = "";
  left: unknown = "";
  disabled = false;
  right: unknown = "";
  hasPreviousProperPreFilterSyntax = false;

  constructor(public mode: string) {}

  addChar(ch: string): void {
    this.entry += ch;
    this.captured += ch;
  }

  private consumeEntry(): { entry: unknown; raw: string } {
    const raw = this.entry;
    const entry = typeEntry(this.entry);
    this.entry = "";
    return { entry, raw };
  }

  addItem(): void {
    const { entry } = this.consumeEntry();
    this.hasPreviousProperPreFilterSyntax = false;
    if (entry === "") return;

    if (this.mode === MODE_LEFT) {
      let e = entry;
      this.disabled = strval(e).startsWith("!");
      if (this.disabled) e = mbSubstr(strval(e), 1);
      this.left = Parser.stripQuotes(e);
    } else {
      this.right = entry;
    }
  }

  hasProperPreFilterSyntax(): boolean {
    if (this.hasPreviousProperPreFilterSyntax) return true;

    let value = trim(this.entry);

    if (value.startsWith("!")) {
      const m = /!\w+\s+(.*)/.exec(value);
      value = m?.[1] ?? "";
    }

    if (["true", "false", "null", "{}", "[]"].includes(value)) return true;
    if (ValueHelper.isInt(value)) return true;
    if (ValueHelper.isDecimal(value)) return true;
    if (ValueHelper.isTimestamp(value)) return true;
    if (ValueHelper.isVarName(value, true)) return true;

    if (Parser.isWrapped(value, Parser.QUOTE_CHAR)) return true;
    if (Parser.isWrapped(value, Parser.SINGLE_QUOTE_CHAR)) return true;
    if (Parser.isWrapped(value, Parser.TICK_CHAR)) return true;
    if (Parser.isWrapped(value, "{", "}")) return true;
    if (Parser.isWrapped(value, "[", "]")) return true;
    if (Parser.isWrapped(value, "(", ")")) return true;

    if (value.startsWith("(")) {
      try {
        const ret = parseGroup(value);
        const rest = value.substring(ret.length);
        if (Parser.isWrapped(rest, "[", "]")) return true;
      } catch {
        // ignore
      }
    }
    return false;
  }

  packageAssign(): AssignResult {
    const assign = Assign.processValue(this.left, this.right);
    if (this.disabled) assign.disabled = true;
    return assign;
  }
}

export const Assign = {
  MODE_LEFT,
  MODE_RIGHT,

  parse(
    str: string,
    mode: string = MODE_LEFT,
    skipEmpty = true,
    seperator = "=",
    expression = false,
    allowMultilineInExpressions = false,
  ): { result: AssignResult; cnt: number } {
    const len = str.length;
    const parser = new AssignParser(mode);
    let i = 0;

    outer: for (i = 0; i < len; i++) {
      let ch = str[i]!;

      if (skipEmpty) {
        if (ctypeSpace(ch)) continue;
        skipEmpty = false;
      }

      switch (ch) {
        case Parser.TICK_CHAR:
        case "(":
        case "{":
        case "[":
        case Parser.QUOTE_CHAR:
        case Parser.SINGLE_QUOTE_CHAR: {
          if (ch === Parser.QUOTE_CHAR || ch === Parser.SINGLE_QUOTE_CHAR || ch === Parser.TICK_CHAR) {
            if (str.substring(i + 1, i + 3) === ch + ch) {
              parser.addChar(ch + ch);
              i += 2;
              break;
            }
          }
          const newStr = str.substring(i);
          let multiline = !(ch === Parser.QUOTE_CHAR || ch === Parser.SINGLE_QUOTE_CHAR || ch === Parser.TICK_CHAR);
          if (allowMultilineInExpressions && ch === Parser.TICK_CHAR) multiline = true;
          const result = parseGroup(newStr, multiline);
          parser.addChar(result);
          i += result.length - 1;
          continue outer;
        }
        case ")":
        case "}":
        case "]":
          throw new UnexpectedError(ch, i);
        case ":":
        case "=": {
          if (ch === ":" && parser.mode === MODE_RIGHT) break;
          if (parser.mode === MODE_LEFT) {
            if (ch !== seperator) throw new UnexpectedError(ch, i);
          }
          if (parser.mode !== MODE_LEFT) break;

          parser.addItem();
          parser.mode = MODE_RIGHT;

          if (expression) {
            let buffer = "";
            skipEmpty = true;
            for (i++; i < len; i++) {
              const c = str[i]!;
              if (skipEmpty) {
                if (ctypeSpace(c)) continue;
                skipEmpty = false;
              }
              if (c === "\n") break;
              buffer += c;
            }
            parser.addChar(Parser.wrapTicks(buffer));
            break outer;
          }

          skipEmpty = true;
          continue outer;
        }
        case "\n": {
          for (const block of ['"""', "'''", "```"]) {
            if (rtrim(parser.entry).endsWith(block)) {
              const newStr = str.substring(i + 1);
              const result = parseMultiline(newStr, block);
              const offset = parser.entry.lastIndexOf(block);
              parser.entry = parser.entry.substring(0, offset);

              const resultStr = result.result;
              if (block === "```") parser.addChar(Parser.wrapTicks(resultStr));
              else parser.addChar(Parser.wrapText(resultStr));
              i += result.cnt;

              const c = str.substring(i, i + 1);
              if (c === "|" || c === ":") {
                i--;
                continue outer;
              }

              const pk = peek(str, i, 1, true);
              if (pk === "|") {
                i = str.indexOf("|", i) - 1;
                continue outer;
              }

              parser.addItem();
              break outer;
            }
          }

          const pk = peek(str, i, 1, true);
          if (pk === "|") {
            i = str.indexOf("|", i) - 1;
            continue outer;
          }
          break outer;
        }
        case ",":
          break outer;
        case Parser.PIPE_CHAR:
          if (parser.mode === MODE_RIGHT) {
            const next = str.substring(i + 1, i + 2);
            if (next === ch) {
              ch += ch;
              i++;
              break;
            }
            if (!parser.hasProperPreFilterSyntax()) throw new UnexpectedError(ch, i);
            parser.hasPreviousProperPreFilterSyntax = true;
          }
          break;
        case Parser.SPACE_CHAR:
          if (parser.mode === MODE_RIGHT) {
            if (parser.entry.startsWith(Parser.EXCLAMATION_CHAR)) {
              const next = str.substring(i + 1, i + 2);
              if (![Parser.SPACE_CHAR, Parser.PIPE_CHAR, Parser.QUOTE_CHAR, Parser.SINGLE_QUOTE_CHAR].includes(next)) {
                if (!parser.entry.includes(Parser.PIPE_CHAR)) {
                  if (rtrim(parser.entry) === "!object" && next === "{") break;
                  throw new UnexpectedError(next, i + 1);
                }
              }
            }
          }
          break;
      }

      parser.addChar(ch);
    }

    parser.addItem();
    return { result: parser.packageAssign(), cnt: i };
  },

  getLabels(left: unknown): string[] {
    switch (left) {
      case "external_simple":
      case "external_classic":
        return ["noexpr"];
    }
    return [];
  },

  isUsingExpressionFilter(filter: unknown): boolean {
    if (phpEmpty(filter)) return false;
    const pipes = Parser.splitPipe(strval(filter));
    const filters = ["map", "some", "every", "find", "findIndex", "filter", "reduce"];
    for (const pipe of pipes) {
      const name = pipe.split(":", 1)[0] ?? "";
      if (filters.includes(name)) {
        if (pipe.includes("$$")) return true;
        if (pipe.includes("return ")) return false;
        return true;
      }
    }
    return false;
  },

  processValue(left: unknown, rightIn: unknown): AssignResult {
    const origRight = rightIn;
    const right = Parser.stripParentheses(rightIn);
    const labels = Assign.getLabels(left);

    const assign = Assign.processAssign(left, right);
    if (assign) {
      if (!Assign.isUsingExpressionFilter(assign.filter ?? "")) return assign;
    }

    const primitives = Assign.processPrimitives(left, right);
    if (primitives) return primitives;

    const object = Assign.processObject(left, right, labels);
    if (object) {
      if (!Assign.isUsingExpressionFilter(object.filter ?? "")) return object;
    }

    const array = Assign.processArray(left, right);
    if (array) {
      if (!Assign.isUsingExpressionFilter(array.filter ?? "")) return array;
    }

    const timestamp = Assign.processTimestamp(left, right);
    if (timestamp) {
      if (!Assign.isUsingExpressionFilter(timestamp.filter ?? "")) return timestamp;
    }

    const expression = Assign.processExpression(left, right);
    if (expression) {
      if (!Assign.isUsingExpressionFilter(expression.filter ?? "")) return expression;
    }

    const variables = Assign.processVariables(left, right);
    if (variables) {
      if (!Assign.isUsingExpressionFilter(variables.filter ?? "")) return variables;
    }

    const filters = Assign.processFilters(left, right);
    if (filters) {
      if (!Assign.isUsingExpressionFilter(filters.filter ?? "")) return filters;
    }

    const rightStr = strval(right);
    if (!Parser.hasQuotesAndIsNotExpression(rightStr)) {
      if (!Assign.mightBeExpression(rightStr) && origRight === right && right !== "") {
        throw new UnexpectedError(rightStr, -1);
      }
      return { kind: "assign:expr", name: left, value: origRight };
    }

    const ret = parseGroup(rightStr);
    if (ret !== rightStr) {
      const check = ltrim(mbSubstr(rightStr, ret.length));
      if (check.startsWith("||") || check.startsWith("&&")) {
        return { kind: "assign:expr", name: left, value: origRight };
      }
      return {
        kind: "assign:text",
        name: left,
        value: Parser.stripQuotes(ret),
        filter: mbSubstr(rightStr, 1 + ret.length),
      };
    }

    return { kind: "static:text", name: left, value: Parser.stripQuotes(rightStr) };
  },

  processRawValue(left: unknown, right: unknown, type: string | null = null): AssignResult | null {
    if (typeof right !== "string") return null;
    const first = right;

    if (first === "null" || type === "null") return { kind: "assign:null", name: left, value: "null" };
    if (first === "true" || first === "false") return { kind: "assign:bool", name: left, value: first };

    if (Parser.hasQuotes(first)) {
      try {
        const group = parseGroup(first);
        if (group === first) {
          return { kind: kindForType(type), name: left, value: Parser.stripQuotes(first) };
        }
      } catch {
        // ignore
      }
    }

    if (Parser.hasTicks(first)) {
      try {
        const group = parseGroup(first);
        if (group === first) return { kind: "assign:expr", name: left, value: Parser.stripTicks(first) };
      } catch {
        // ignore
      }
    }

    if (ValueHelper.isInt(first)) return { kind: "assign:int", name: left, value: first };
    if (ValueHelper.isDecimal(first)) return { kind: "assign:decimal", name: left, value: first };
    if (ValueHelper.isTimestamp(first)) return { kind: "assign:timestamp", name: left, value: first };

    return { kind: kindForType(type), name: left, value: Parser.stripQuotes(first) };
  },

  processFilters(left: unknown, right: unknown, required = true, type: string | null = null): AssignResult | null {
    if (typeof right !== "string") return null;

    let pos = Parser.getPipePositionFromRawValue(right);
    if (pos === false) {
      if (required) return null;
      pos = right.length;
    }

    const first = rtrim(right.substring(0, pos));
    const rest = () => ltrim(right.substring((pos as number) + 1));

    if (!first.startsWith(Parser.TICK_CHAR) && Assign.mightBeExpression(first) && !ValueHelper.isTimestamp(first)) {
      return null;
    }

    if (first === "null" || type === "null") return { kind: "assign:null", name: left, value: "null", filter: rest() };
    if (first === "true" || first === "false") return { kind: "assign:bool", name: left, value: first, filter: rest() };

    if (!type) {
      if (Parser.hasQuotes(first)) {
        try {
          const group = parseGroup(first);
          if (group === first) {
            return { kind: kindForType(type, false), name: left, value: Parser.stripQuotes(first), filter: rest() };
          }
        } catch {
          // ignore
        }
      }
      if (Parser.hasTicks(first)) {
        try {
          const group = parseGroup(first);
          if (group === first) return { kind: "assign:expr", name: left, value: Parser.stripTicks(first), filter: rest() };
        } catch {
          // ignore
        }
      }
    }

    if (ValueHelper.isInt(first)) return { kind: "assign:int", name: left, value: first, filter: rest() };
    if (ValueHelper.isDecimal(first)) return { kind: "assign:decimal", name: left, value: first, filter: rest() };
    if (ValueHelper.isTimestamp(first)) return { kind: "assign:timestamp", name: left, value: first, filter: rest() };
    if (ValueHelper.isArray(first)) return { kind: "assign:array", name: left, value: "[]", filter: rest() };
    if (ValueHelper.isObject(first)) return { kind: "assign:object", name: left, value: "{}", filter: rest() };

    if (!Parser.hasQuotes(first)) return null;

    return { kind: kindForType(type, false), name: left, value: Parser.stripQuotes(first), filter: rest() };
  },

  processPrimitives(left: unknown, right: unknown): AssignResult | false {
    if (typeof right === "boolean" || ValueHelper.isBool(right)) return { kind: "static:bool", name: left, value: right };
    if (isInt(right) || ValueHelper.isInt(right)) return { kind: "static:int", name: left, value: right };
    if (isFloat(right) || ValueHelper.isDecimal(right)) return { kind: "static:decimal", name: left, value: right };
    if (right === null || right === undefined || right === "null") return { kind: "assign:null", name: left, value: "null" };
    return false;
  },

  processAssign(left: unknown, rightIn: unknown): AssignResult | false {
    if (typeof rightIn !== "string") return false;
    if (!rightIn.startsWith("!")) return false;

    for (const key of ["any", "int", "decimal", "text", "auth", "bool", "expr", "timestamp", "null", "input", "var", "env", "object", "array"]) {
      if (rightIn.startsWith("!" + key)) {
        const ret: AssignResult = { kind: `assign:${key}`, name: left, value: undefined };
        let right = ltrim(rightIn.substring(("!" + key).length));
        if (!Parser.hasQuotes(right) && key !== "object") {
          throw new UnexpectedError(right.substring(0, 1), -1);
        }

        let group = parseGroup(right);
        let next = ltrim(right.substring(group.length));
        group = Parser.stripQuotes(group) as string;

        let filter: string | undefined;
        if (!phpEmpty(next)) {
          if (next.startsWith("|")) filter = next.substring(1);
          else throw new UnexpectedError(right, -1);
        }

        right = group;

        switch (key) {
          case "object": {
            const g = parseGroup(right);
            next = ltrim(right.substring(g.length));
            let inner: unknown = mbSubstr(g, 1, -1);
            if (next.startsWith("|")) filter = next.substring(1);
            if (!phpEmpty(inner)) inner = StaticObject.parse(inner as string);
            else inner = new StdClass();
            ret.value = inner;
            break;
          }
          case "array": {
            const g = parseGroup(right);
            next = ltrim(right.substring(g.length));
            const inner = mbSubstr(g, 1, -1);
            if (next.startsWith("|")) filter = next.substring(1);
            if (!phpEmpty(trim(inner))) ret.value = StaticArray.parse(inner);
            else ret.value = [];
            break;
          }
          default:
            ret.value = Assign.processRawValue(left, right, key)?.value;
            break;
        }

        if (filter !== undefined) ret.filter = ltrim(filter);
        return ret;
      }
    }
    return false;
  },

  processTimestamp(left: unknown, right: unknown): AssignResult | false {
    if (!ValueHelper.isTimestamp(right)) return false;
    return { kind: "static:timestamp", name: left, value: right };
  },

  processExpression(left: unknown, right: unknown): AssignResult | false {
    let str = right;
    if (!Parser.isWrapped(str, Parser.TICK_CHAR)) return false;
    const s = str as string;
    const triple = "```";
    let value: string;
    if (Parser.isWrapped(s, triple)) {
      const prepped = prepForParse(s);
      value = parseMultiline(prepped, triple).result;
    } else {
      value = Parser.stripTicks(s) as string;
    }
    return { kind: "assign:expr", name: left, value };
  },

  processVariables(left: unknown, right: unknown): AssignResult | false {
    if (typeof right !== "string") return false;
    const str = right;
    if (!str.startsWith("$")) return false;
    if (str.startsWith("$$")) return false;

    const preParts = Parser.splitPipe(str);
    let parts: string[];
    try {
      const tmp = preParts.shift() ?? "";
      parts = Parser.splitVar(tmp, true, true);
    } catch {
      return false;
    }

    const filter = Parser.joinPipe(preParts);
    const node = parts.shift() ?? "";
    let value: string;
    if (parts.length === 1 && node === "$var") value = parts[0]!;
    else value = Parser.joinVar(parts, false);

    switch (node) {
      case "$var":
      case "$env":
      case "$auth":
      case "$input":
      case "$output":
      case "$error":
      case "$toolset":
      case "$response": {
        if (node === "$response") {
          return { kind: "assign:" + node.substring(1), name: left, value, filter };
        }
        if (!ValueHelper.isVarName("$" + ltrim(value, "$"))) return false;
        const ret = Parser.splitVar(value);
        if (ret.length === 1) value = ret[0]!;
        return { kind: "assign:" + node.substring(1), name: left, value, filter };
      }
      case "$db": {
        if (!ValueHelper.isTableName("$" + ltrim(value, "$"))) {
          const ret = Parser.splitVar(ltrim(value, "$"));
          if (ret.length === 2) {
            if (ret[1]!.startsWith("$")) value = ret.join(".");
            else return false;
          } else {
            return false;
          }
        }
        return { kind: "assign:" + node.substring(1), name: left, value, filter };
      }
    }

    parts.unshift(node);
    let name = Parser.joinVar(parts, false);
    name = trim(name);
    if (!ValueHelper.isVarName(name)) return false;

    return { kind: "assign:var", name: left, value: Assign.filterVarName(name), filter };
  },

  filterVarName(value: string): string {
    for (const name of ["$this", "$index"]) {
      if (value === name || value.startsWith(name + ".")) return value;
    }
    if (value.startsWith("$")) value = mbSubstr(value, 1);
    if (value.startsWith("[")) {
      const parts = Parser.splitVar(value, true, false);
      if (parts.length === 1) value = parts[0]!;
    }
    return value;
  },

  processObject(left: unknown, right: unknown, _labels: string[] = []): AssignResult | false {
    if (!Parser.isWrappedInCurlyBrackets(right)) return false;
    const s = right as string;
    const inner = mbSubstr(s, 1, -1);
    if (phpEmpty(trim(inner))) return { kind: "static:object", name: left, value: [] };
    const ret = StaticObject.parse(inner);
    return { kind: "static:object", name: left, value: ret, raw: normalizeIndent(s, true) };
  },

  processArray(left: unknown, right: unknown): AssignResult | false {
    if (!Parser.isWrappedInBrackets(right)) return false;
    const s = right as string;
    const inner = mbSubstr(s, 1, -1);
    if (phpEmpty(trim(inner))) return { kind: "static:array", name: left, value: [] };
    const ret = StaticArray.parse(inner);
    const kind = left === "expr" || left === "value" ? "static:array" : ret.kind;
    return { kind, name: left, value: ret.value, raw: normalizeIndent(s, true) };
  },

  mightBeAssign(str: string): boolean {
    return /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*=[^=]/.test(str);
  },

  isNegNumber(str: string): boolean {
    let ret = false;
    if (str.includes("-")) {
      const parts = str.split("|");
      for (const part of parts) {
        const args = part.split(":");
        for (const arg of args) {
          const cnt = substrCount(arg, "-");
          if (cnt === 1) {
            if (ltrim(arg).startsWith("-")) {
              ret = true;
              continue;
            }
          } else if (cnt > 1) {
            return false;
          }
        }
      }
    }
    return ret;
  },

  hasExpressionOps(strIn: string, extra = true): boolean {
    const str = Parser.removeQuotes(strIn);
    for (const op of SYMBOL_OPS) {
      if (str.includes(op)) {
        if (op === "-") {
          if (Assign.isNegNumber(str)) continue;
        }
        return true;
      }
    }
    for (const op of JOIN_OPS) {
      if (str.includes(op)) return true;
    }
    for (const op of WORD_OPS) {
      if (str.includes(" " + op + " ")) return true;
    }
    if (extra) {
      for (const op of ["~", "(", ")", "[", "]"]) {
        if (str.includes(op)) return true;
      }
    }
    return false;
  },

  shouldWrapExpression(str: string): boolean {
    if (Parser.isWrappedInTicks(str)) return false;
    if (Parser.isWrappedInBrackets(str)) return false;
    if (Parser.isWrappedInParentheses(str)) return false;
    if (Parser.isWrappedInCurlyBrackets(str)) return false;
    if (Assign.hasExpressionOps(str, false)) return true;
    return false;
  },

  hasAmbiguousFilters(_str: string, _basics = true): boolean {
    return false;
  },

  needToForceExpression(str: string): boolean {
    if (Assign.hasAmbiguousFilters(str)) return true;
    if (str.startsWith("{")) {
      try {
        parseGroup(str);
      } catch {
        return true;
      }
    }
    if (Assign.isLegacyExpression(str)) return true;
    return false;
  },

  isStandaloneExpression(str: string): boolean {
    try {
      const ret = xtFastParse(str, "node");
      if (Assign.hasOperator(ret.getStack())) return false;
    } catch {
      // ignore
    }
    return true;
  },

  isLegacyExpression(str: unknown, includeEmpty = true): boolean {
    if (typeof str !== "string") return false;
    if (includeEmpty && trim(str) === "") return true;
    if (rtrim(str).endsWith(",")) return true;
    if (Assign.hasAmbiguousFilters(str, false)) return true;

    try {
      const ret = xtFastParse(str, "node");
      const stack = ret.getStack();
      if (ret.isLegacy()) return true;
      if (Assign.hasBareStringNode(stack)) return true;

      const render = Transform.renderStack(stack);
      const origBalance = substrCount(str, "(") - substrCount(str, ")");
      const renderBalance = substrCount(render, "(") - substrCount(render, ")");
      if (origBalance !== 0 && renderBalance === 0) return true;
    } catch {
      return true;
    }
    return false;
  },

  hasOperator(items: XtItem[]): boolean {
    const ops = [...SYMBOL_OPS, ...SEPERATOR_OPS, ...GROUP_OPS];
    for (const item of items) {
      const node = item.node ?? "";
      if (phpEmpty(node)) continue;
      if (!phpEmpty(item.hint)) continue;
      if (ops.includes(node)) return true;
    }
    return false;
  },

  hasBareStringNode(items: XtItem[]): boolean {
    const ops = new Set([...SYMBOL_OPS, ...SEPERATOR_OPS, ...GROUP_OPS, "?:", "??", ".."]);

    let prevWasGroupLike = false;
    let prevWasGroup = false;
    let prevWasOp = false;

    items.forEach((item, idx) => {
      // handled below with early returns via exception-free loop
      void item;
      void idx;
    });

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      let isOp = false;
      if ("node" in item) {
        const value = item.node;
        isOp = typeof value === "string" && (ops.has(value) || (value.endsWith("?") && ops.has(mbSubstr(value, 0, -1))));

        if (value === "" && item.hint === "text" && idx > 0 && !prevWasOp) return true;

        if (prevWasGroupLike && !isOp) {
          if (!prevWasGroup) return true;
        }

        if (
          typeof value === "string" &&
          (item.hint ?? "any") !== "text" &&
          !value.startsWith("$") &&
          !Parser.isWrappedInTicks(value) &&
          !Parser.isWrappedInMultilineSyntax(value) &&
          !isOp &&
          !prevWasGroup &&
          value !== "now"
        ) {
          return true;
        }
      }

      prevWasOp = "node" in item && isOp;
      prevWasGroupLike = "group" in item || "array" in item || "object" in item;
      prevWasGroup = "group" in item;

      if (Array.isArray(item.group)) {
        if (Assign.hasBareStringNode(item.group)) return true;
      }
      if (item.tenary && typeof item.tenary === "object") {
        if (Array.isArray(item.tenary.left) && Assign.hasBareStringNode(item.tenary.left)) return true;
        if (Array.isArray(item.tenary.right) && Assign.hasBareStringNode(item.tenary.right)) return true;
      }
      if (Array.isArray(item.array)) {
        if (Assign.hasBareStringNode(item.array)) return true;
      }
      if (Array.isArray(item["array:entry"])) {
        if (Assign.hasBareStringNode(item["array:entry"])) return true;
      }
      if (Array.isArray(item.object)) {
        if (Assign.hasBareStringNode(item.object)) return true;
      }
      if (item["object:entry"] && typeof item["object:entry"] === "object") {
        const oe = item["object:entry"];
        if (Array.isArray(oe.right) && Assign.hasBareStringNode(oe.right)) return true;
      }
      if (Array.isArray(item["arg:entry"])) {
        if (Assign.hasBareStringNode(item["arg:entry"])) return true;
      }
      if (Array.isArray(item.pipes)) {
        for (const pipe of item.pipes) {
          if (Array.isArray(pipe.args)) {
            for (const pipeArg of pipe.args) {
              if (Array.isArray(pipeArg["arg:entry"])) {
                if (Assign.hasBareStringNode(pipeArg["arg:entry"])) return true;
              }
            }
          }
        }
      }
    }
    return false;
  },

  mightBeExpression(str: string): boolean {
    if (Parser.isWrappedInQuotes(str)) return false;
    if (str === "[]" || str === "{}") return false;

    if (Assign.hasExpressionOps(str)) {
      const placeholder = "$__x8n0__";
      let stripped = Parser.removeQuotes(str);

      if (substrCount(stripped, "(") !== substrCount(stripped, ")")) return true;

      stripped = replaceBalancedParens(stripped, placeholder);
      stripped = stripped.split("-" + placeholder).join("-(" + placeholder + ")");
      if (Assign.hasExpressionOps(stripped) || stripped.startsWith(placeholder)) return true;
    }

    for (const op of ["[", "{", "("]) {
      if (str.startsWith(op)) {
        try {
          const ret = parseGroup(str);
          if (ret.length !== 2) return true;
        } catch {
          return true;
        }
      }
    }

    if (str.includes("$$")) return true;
    return false;
  },
};

/** PHP `preg_replace('/\((?:[^()]*|(?R))*\)/', $placeholder, $s)`: replace every balanced paren group. */
function replaceBalancedParens(s: string, placeholder: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "(") {
      let depth = 0;
      let j = i;
      let closed = -1;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") {
          depth--;
          if (depth === 0) {
            closed = j;
            break;
          }
        }
      }
      if (closed !== -1) {
        out += placeholder;
        i = closed + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
