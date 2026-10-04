/**
 * Port of redacted — the ENCODE half plus the few
 * decode-side helpers the encoder itself calls (`renderStack` for the legacy
 * expression check, `convertFromAssignmentValue`/`parseFilters`/
 * `renderStaticObject` for canonical object-literal re-rendering).
 *
 * Every function keeps its PHP name so the drift map can point at it.
 */
import { Assign, SEPERATOR_OPS, GROUP_OPS } from "../engine/assign-parser.js";
import { script } from "../engine/context.js";
import { MalformedError, NotSupportedError } from "../engine/errors.js";
import { parseGroup } from "../engine/group-parser.js";
import { filterBoolean } from "../engine/input-filters.js";
import { SchemaKind, type Kind } from "../engine/kinds.js";
import { NOT_FOUND } from "../engine/symbols.js";
import { Parser } from "../engine/parser.js";
import {
  StdClass,
  arrayUnique,
  count,
  ctypeDigit,
  entries,
  floatval,
  intval,
  isAssoc,
  isPhpArray,
  isPhpObject,
  isScalar,
  looseEquals,
  mapperEmpty,
  phpEmpty,
  strval,
  ucfirst,
} from "../engine/php.js";
import { ScriptHelper } from "../engine/script-helper.js";
import { renderState, type PipeMode } from "../engine/state.js";
import { indent } from "../engine/system.js";
import { ValueHelper } from "../engine/value-helper.js";
import { MultiLineValue, RawValue, TaggedValue } from "../engine/values.js";
import { xsGetElement, xsGetElementValue } from "../engine/xs-helper.js";
import { parseAssignment } from "../engine/xs-param.js";
import { xtFastParse, type XtItem } from "../engine/xt-parser.js";
import { DB } from "./db.js";
import { encodeWithClass } from "./registry.js";

/** A kind-tree node: `{kind, name?, value?, filter?}` for leaves, `{kind, name?, args, blocks}` for schema kinds. */
export type KindNode = Record<string, unknown> & { kind: string };

const TYPE_MAP: Record<string, string> = {
  obj: "object",
  epochms: "timestamp",
  blob_img: "image",
  blob_video: "video",
  blob_audio: "audio",
  blob: "attachment",
};

/** the engine's `get` for dotted paths (no wildcards). */
export function mapperGet(path: string, obj: unknown, fallback: unknown = null): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur instanceof StdClass) return fallback;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(part)) return fallback;
      const idx = parseInt(part, 10);
      if (idx >= cur.length) return fallback;
      cur = cur[idx];
      continue;
    }
    if (cur === null || typeof cur !== "object") return fallback;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return fallback;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** the engine's `set` for dotted paths. */
export function mapperSet(path: string, value: unknown, out: Record<string, unknown>): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (!isAssoc(cur[p])) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function get(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key];
}

export const Transform = {
  NOT_FOUND,
  PIPE_MODE_PIPES: "pipes" as PipeMode,
  PIPE_MODE_FILTERS: "filters" as PipeMode,
  PIPE_MODE_AGGREGATES: "aggregates" as PipeMode,

  pushContext(data: unknown): void {
    renderState.contextStack.push(data);
  },

  popContext(): unknown {
    return renderState.contextStack.pop();
  },

  getContext(): unknown {
    return renderState.contextStack[renderState.contextStack.length - 1] ?? null;
  },

  getPipeMode(): PipeMode {
    return renderState.pipeMode;
  },

  setPipeMode(mode: PipeMode): void {
    renderState.pipeMode = mode;
  },

  createInlineComparison(compare: unknown, ignoreEmpty = false, minimize = true): string {
    const parts: string[] = [];
    const oldMultiline = Parser.setMultilineTicks(true);
    try {
      const expressions = (get(compare, "expression") as unknown[]) ?? [];
      let sep: boolean | string = false;
      for (const expr of expressions as Array<Record<string, any>>) {
        if (phpEmpty(sep)) {
          sep = true;
        } else {
          sep = expr.or ? "||" : "&&";
          parts.push(sep);
        }
        switch (expr.type) {
          case "statement": {
            const statement = { ...(expr.statement as Record<string, any>) };
            switch (statement.op) {
              case "is null":
                statement.op = "=";
                statement.right = { operand: "null", tag: "const:null", filters: [] };
                break;
              case "is not null":
                statement.op = "!=";
                statement.right = { operand: "null", tag: "const:null", filters: [] };
                break;
            }

            let part: string;
            if (
              minimize &&
              statement.op === "=" &&
              statement.right?.tag === "const:bool" &&
              looseEquals(statement.right?.operand, "true") &&
              phpEmpty(statement.right?.filters)
            ) {
              part = Transform.createInlineValue(statement.left, { name: "operand", wrapIfFilters: expressions.length > 1, wrapIfMultiline: true });
            } else {
              part = `${Transform.createInlineValue(statement.left, { name: "operand", wrapIfFilters: true, wrapIfExpression: true, wrapIfMultiline: true, comparison: true })} ${Transform.createInlineOp(statement.op, Boolean(statement.right?.ignore_empty) && ignoreEmpty)} ${Transform.createInlineValue(statement.right, { name: "operand", wrapIfFilters: true, wrapIfExpression: true, wrapIfMultiline: true, comparison: true })}`;
            }
            parts.push(part);
            sep = expr.or ? "||" : "&&";
            break;
          }
          case "group":
            parts.push("(" + Transform.createInlineComparison(expr.group, ignoreEmpty) + ")");
            break;
        }
      }
    } finally {
      Parser.setMultilineTicks(oldMultiline);
    }
    return parts.join(" ");
  },

  createInlineOp(op: string, ignoreEmpty = false): string {
    let ret = op === "=" ? "==" : op;
    if (ignoreEmpty) ret += "?";
    return ret;
  },

  createFromInlineOp(op: string): string {
    return op === "==" ? "=" : op;
  },

  createInlineObject(item: unknown, wrapKeys = true): string {
    if (mapperEmpty(item) || item === "{}") return "{}";
    const ret: Record<string, unknown> = {};
    for (const v of Object.values(item as object) as Array<Record<string, unknown>>) {
      ret[String(v.name)] = new RawValue(Transform.createInlineValue(v, { name: "value", tag: ScriptHelper.isVerbose(), raw: false }));
    }
    return String(ScriptHelper.wrap(ret, true, null, "scalar", 1, wrapKeys));
  },

  createInlineExpression(itemIn: unknown, indentCols: number | null = null, includeEmpty = true): string | MultiLineValue {
    let item: unknown = itemIn;
    if (!isScalar(item)) item = ScriptHelper.wrap(item);

    if (Parser.isMultilineTicks(item)) {
      if (indentCols === null) indentCols = 4;
      return new MultiLineValue(item as string, "const:expr", indentCols);
    }

    if (typeof item === "string") {
      item = item.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, "");
      if (Assign.isLegacyExpression(item, includeEmpty)) {
        item = Parser.wrapExpressionText(item);
      }
    }
    return item as string;
  },

  shouldWrapExpression(item: Record<string, unknown>, value: unknown): boolean {
    if (!["const:expr", "const:expr2"].includes(String(item.tag ?? ""))) return false;
    if (value instanceof MultiLineValue) return false;
    if (typeof value === "string" && Parser.isWrappedInTicks(value)) return false;
    if (Parser.mightByBadSyntax(value)) return true;
    if (!phpEmpty(item.filters)) return true;
    if (value === "") return false;
    if (!Assign.mightBeExpression(strval(value))) return true;
    return false;
  },

  wrapTimestamp(value: unknown): string {
    if (typeof value === "string") {
      if (ValueHelper.isTimestamp(value)) return value;
    }
    return String(ScriptHelper.wrap(value));
  },

  wrapCol(value: unknown): string {
    const v = "$db." + strval(value);
    try {
      return Parser.joinVar(Parser.splitVar(v));
    } catch {
      return v;
    }
  },

  wrapPrefix(value: unknown, prefix: string): string {
    const v = Parser.wrapVarName(value);
    if (!v.startsWith("[")) prefix += ".";
    return prefix + v;
  },

  createInlineValue(
    item: unknown,
    o: {
      name?: string;
      tag?: boolean;
      raw?: boolean;
      wrapIfFilters?: boolean;
      wrapIfExpression?: boolean;
      wrapIfExpressionWithPipes?: boolean;
      wrapIfMultiline?: boolean;
      skipMultiline?: boolean;
      comparison?: boolean;
      includeEmpty?: boolean;
    } = {},
  ): string {
    const name = o.name ?? "value";
    const it = (item ?? {}) as Record<string, unknown>;
    const val = it[name] ?? null;
    const itemTag = (it.tag ?? null) as string | null;

    let value: unknown;
    if (o.tag) {
      value = Parser.wrapText(val);
    } else {
      switch (itemTag) {
        case "auth": value = Transform.wrapPrefix(val, "$auth"); break;
        case "response": value = Transform.wrapPrefix(val, "$response"); break;
        case "toolset": value = Transform.wrapPrefix(val, "$toolset"); break;
        case "input": value = Transform.wrapPrefix(val, "$input"); break;
        case "col": value = Transform.wrapCol(val); break;
        case "output": value = "$output." + strval(val); break;
        case "trycatch": value = "$error." + strval(val); break;
        case "var": value = o.raw ? val : ScriptHelper.renderVarName(Parser.wrapVarName(val)); break;
        case "setting": value = Transform.wrapPrefix(val, "$env"); break;
        case "const:int": value = ScriptHelper.wrap(intval(val)); break;
        case "const:decimal": value = ScriptHelper.wrap(floatval(val)); break;
        case "const:bool": value = ScriptHelper.wrap(Transform.safeBoolean(val)); break;
        case "const:null": value = "null"; break;
        case "const:epochms": value = Transform.wrapTimestamp(val); break;
        case "const:expr":
        case "const:expr2":
          value = Transform.createInlineExpression(val, o.wrapIfExpression ? 0 : null, o.includeEmpty ?? true);
          break;
        case "const:array": value = "[]"; break;
        case "const:obj": value = Transform.createInlineObject(val); break;
        case "reg": value = "$reg." + strval(val); break;
        default: value = ScriptHelper.wrap(val);
      }
    }

    const filters = (it.filters as unknown[]) ?? [];
    let forceWrap = false;
    let parts: string[];

    if (o.tag) {
      const kindName = Transform.convertAssignmentType(String(it.tag));
      const kind = script().getKind(kindName);
      parts = [`!${kind.getType()} ${strval(value)}`];
    } else {
      if (Transform.shouldWrapExpression(it, value)) {
        value = Parser.wrapExpressionText(value);
      } else if (o.comparison) {
        try {
          const methods = Parser.splitPipe(strval(value));
          if (methods.length > 1) forceWrap = true;
        } catch {
          // fall through
        }
      }

      if (o.skipMultiline && value instanceof MultiLineValue) value = value.getValue();
      parts = [strval(value)];
    }

    for (const filter of filters) {
      parts.push(Transform.createInlineFilter(filter as Record<string, unknown>));
    }
    let ret = parts.join("|");

    if (forceWrap || (o.wrapIfFilters && (!phpEmpty(filters) || Transform.isExpressionTenary(ret)))) {
      ret = `(${ret})`;
    } else if (o.wrapIfExpressionWithPipes && ["const:expr", "const:expr2"].includes(itemTag ?? "") && Parser.hasPipes(ret)) {
      ret = `(${ret})`;
    } else if (o.wrapIfExpression && ["const:expr", "const:expr2"].includes(itemTag ?? "") && Assign.shouldWrapExpression(ret)) {
      ret = `(${ret})`;
    } else if (o.wrapIfMultiline && Parser.isWrappedInMultilineSyntax(ret)) {
      ret = `(${ret})`;
    }
    return ret;
  },

  isExpressionTenary(value: string): boolean {
    if (value.includes("?")) {
      try {
        const ret = xtFastParse(value, "node");
        for (const item of ret.getStack()) {
          if ("tenary" in item) return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  },

  parseConstEncoded(encodedIn: unknown): unknown {
    let encoded = encodedIn;
    if (typeof encoded === "string" && Parser.isWrappedInParentheses(encoded)) encoded = encoded.substring(1, encoded.length - 1);
    try {
      return JSON.parse(strval(encoded));
    } catch {
      return "";
    }
  },

  parseInlineValue(item: Record<string, unknown>, name = "value"): { value: unknown; filter?: string } {
    const val = item[name] ?? null;
    let value: unknown;
    switch (item.tag ?? null) {
      case "input":
      case "auth":
      case "toolset":
      case "var":
      case "setting":
        value = Parser.wrapVarName(val);
        break;
      case "response":
        value = Parser.wrapResponseName(val);
        break;
      case "const:int":
        value = ScriptHelper.wrapScalar(intval(val));
        break;
      case "const:decimal":
        value = ScriptHelper.wrapScalar(floatval(val));
        break;
      case "const:bool":
        value = ScriptHelper.wrapScalar(typeof val === "string" ? val === "true" : Boolean(val));
        break;
      case "const:null":
        value = "null";
        break;
      case "const:encoded":
        value = Transform.parseConstEncoded(val);
        break;
      default:
        value = val ?? "";
    }

    const result: { value: unknown; filter?: string } = { value };
    if (phpEmpty(result.value)) {
      switch (item.tag ?? null) {
        case "const:obj":
          result.value = "{}";
          break;
        case "const:array":
          result.value = "[]";
          break;
      }
    }

    if (!phpEmpty(item.filters)) {
      const filters: string[] = [];
      for (const filter of item.filters as Array<Record<string, unknown>>) {
        filters.push(Transform.createInlineFilter(filter, ScriptHelper.isVerbose()));
      }
      result.filter = filters.join("|");
    }
    return result;
  },

  getPipeName(name: string): string {
    const n = name.replace(/^!+/, "");
    const display = script().getPipeDisplay(renderState.pipeMode, n);
    return display ?? n;
  },

  isDisabled(name: unknown): boolean {
    return typeof name === "string" && name.startsWith("!");
  },

  fromPipeName(name: string): string {
    const n = name.replace(/^!+/, "");
    // Reverse lookup: display → internal name in the active registry.
    const mode = renderState.pipeMode;
    const ctx = script();
    for (const internal of ctx.getPipeInternalNames(mode)) {
      if (ctx.getPipeDisplay(mode, internal) === n) return internal;
    }
    return n;
  },

  createInlineFilter(filter: Record<string, unknown>, tag = false): string {
    let filterName = Transform.getPipeName(String(filter.name ?? filter.pipe ?? ""));
    if (filter.disabled) filterName = "!" + filterName;
    const parts = [filterName];
    for (const arg of ((filter.arg ?? filter.args ?? []) as unknown[])) {
      parts.push(Transform.createInlineValue(arg, { tag, wrapIfExpressionWithPipes: true, wrapIfFilters: true }));
    }
    return parts.join(":");
  },

  getStatementFromKind(kindIn: string | Kind): string {
    const kind = typeof kindIn === "string" ? script().getKind(kindIn) : kindIn;
    const alias = kind instanceof SchemaKind ? kind.getAlias() : null;
    if (!phpEmpty(alias)) return alias as string;
    const parts = kind.getKind().split(":");
    return "mvp:" + parts[1];
  },

  getKindFromStatement(statement: string): string {
    const alias = script().getAlias(statement);
    if (alias) {
      const aliasParts = alias.split(":");
      return "schema:" + aliasParts.pop();
    }
    const parts = statement.split(":");
    return "schema:" + parts[1];
  },

  migrateInput(input: unknown): unknown {
    if (!phpEmpty(input) && isPhpArray(input)) {
      const ret: Record<string, unknown> = {};
      for (const value of Object.values(input as object) as Array<Record<string, unknown>>) {
        if (value.ignore) continue;
        const name = String(value.name);
        if (!phpEmpty(value.children)) {
          ret[name] = { name: value.name, tag: "const:obj", value: Transform.migrateInput(value.children), filters: value.filters ?? [] };
        } else {
          ret[name] = { name: value.name, tag: value.tag, value: value.value ?? "", filters: value.filters ?? [] };
        }
      }
      return ret;
    }
    return input;
  },

  convertFunction(name: string, item: unknown, prefix = "on"): KindNode {
    const parts = name.split(":");
    let funcName = prefix;
    for (const part of parts) funcName += ucfirst(part);
    const fn = (Transform as unknown as Record<string, unknown>)[funcName];
    if (typeof fn !== "function") throw new Error("Missing Transform: " + funcName);
    return (fn as (item: unknown) => KindNode)(item);
  },

  convertToKind(kindIn: string | Kind, item: unknown): KindNode {
    const kind = (typeof kindIn === "string" ? script().getKind(kindIn) : kindIn) as SchemaKind;

    if (kind.getLabels().includes("statement")) {
      return Transform.convertStackItem(kind, (item ?? {}) as Record<string, unknown>);
    }

    const kindBlocks = kind.getBlocks();
    const transform = kind.getTransform();

    if (transform instanceof TaggedValue) {
      const tag = transform.getTag();
      const v = transform.getValue();
      switch (tag) {
        case "function":
          return Transform.convertFunction(String(v), item);
        case "class":
          return encodeWithClass(String(v), item);
        default:
          throw new Error("Invalid tag: " + tag);
      }
    }

    const ret: KindNode = { kind: kind.getKind(), args: [], blocks: [] };
    if (mapperEmpty(transform)) throw new Error("Missing transform for kind: " + kind.getKind());

    const blocks = (transform as Record<string, unknown>).blocks ?? [];
    if (!phpEmpty(blocks)) {
      if (Array.isArray(blocks)) throw new Error("Invalid block transform.");
      for (const [k, vIn] of Object.entries(blocks as Record<string, unknown>)) {
        const kindName = xsGetElementValue(k, kindBlocks);
        if (kindName === null || kindName === undefined) throw new Error("Unable to locate: " + k);

        let v = vIn;
        let tag: string | null = null;
        if (v instanceof TaggedValue) {
          tag = v.getTag();
          v = v.getValue();
        }

        const value = mapperGet(String(v), item, NOT_FOUND);
        if (value === NOT_FOUND) throw new Error("Block not found: " + String(v));

        if (tag === "assign:repeating") {
          (ret.blocks as KindNode[]).push(...Transform.convertRepeatingAssignmentValue(value, k));
          continue;
        }
        if (tag === "assign:inline") {
          (ret.blocks as KindNode[]).push(Transform.inlineAssign(k, value, String(kindName)));
          continue;
        }
        throw new Error("Unhandled block transform tag: " + String(tag));
      }
    }
    return ret;
  },

  convertStackItem(kindIn: string | Kind, item: Record<string, unknown>): KindNode {
    const kind = (typeof kindIn === "string" ? script().getKind(kindIn) : kindIn) as SchemaKind;
    const ret = Transform.convertStackItemImpl(kind, item);
    const blocks = ret.blocks as KindNode[];

    if (!phpEmpty(item.disabled) && !blocks.some((b) => (b.name ?? "") === "disabled")) {
      blocks.unshift(Transform.inlineAssign("disabled", item.disabled, "static:bool"));
    }
    if (!phpEmpty(item.description) && !blocks.some((b) => (b.name ?? "") === "description")) {
      blocks.unshift(Transform.inlineAssign("description", item.description));
    }

    const args = kind.getArgs();
    if (args.as !== undefined || args["as?"] !== undefined) {
      if (!phpEmpty(item.as) && !(ret.args as KindNode[]).some((a) => (a.name ?? "") === "as")) {
        Transform.onAs(item, ret.args as KindNode[]);
      }
    }

    Transform.onSchemaMocks(item, ret);
    return ret;
  },

  /** the engine's `onAs`. */
  onAs(data: Record<string, unknown>, blocks: KindNode[]): void {
    const as = data.as ?? "";
    if (phpEmpty(as)) return;
    const block = Transform.inlineAssign("as", as);
    const filters: string[] = [];
    for (const filter of ((get(data.output, "filters") as unknown[]) ?? []) as Array<Record<string, unknown>>) {
      filters.push(Transform.createInlineFilter(filter, ScriptHelper.isVerbose()));
    }
    if (filters.length) block.filter = filters.join("|");
    blocks.push(block);
  },

  convertStackItemImpl(kind: SchemaKind, itemIn: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: kind.getKind(), args: [], blocks: [] };
    const item: Record<string, unknown> = { ...itemIn };
    item.input = Transform.migrateInput(item.input ?? []);

    const transform = kind.getTransform();

    if (item.context instanceof StdClass && transform instanceof TaggedValue) {
      item.context = {};
    }

    if (mapperEmpty(transform)) throw new Error("Missing transform for kind: " + kind.getKind());

    if (transform instanceof TaggedValue) {
      const tag = transform.getTag();
      const v = transform.getValue();
      switch (tag) {
        case "function":
          return Transform.convertFunction(String(v), item);
        case "class":
          return encodeWithClass(String(v), item);
        default:
          throw new Error("Invalid tag: " + tag);
      }
    }

    const t = transform as Record<string, unknown>;
    for (const [k, vIn] of Object.entries((t.args ?? {}) as Record<string, unknown>)) {
      let v = vIn;
      let tag: string | null = null;
      if (v instanceof TaggedValue) {
        tag = v.getTag();
        v = v.getValue();
      }

      const parsedArg = { ...parseAssignment(k) };
      let value = mapperGet(String(v), item, NOT_FOUND);
      if (value === NOT_FOUND) {
        if (parsedArg.hasDefault) {
          value = parsedArg.default;
        } else {
          parsedArg.required = false;
          parsedArg.hasDefault = true;
          value = parsedArg.default = "";
        }
      }

      const args = ret.args as KindNode[];
      switch (tag) {
        case "inline":
          if (phpEmpty(value)) {
            args.push({ name: parsedArg.name, kind: "assign:text", value: "" });
          } else {
            args.push({ name: parsedArg.name, kind: Transform.convertAssignmentType(String((value as Record<string, unknown>).tag)), ...Transform.parseInlineValue(value as Record<string, unknown>) });
          }
          break;
        case "inline:array":
          if (phpEmpty(value)) {
            args.push({ name: parsedArg.name, kind: "assign:text[]", value: [] });
          } else {
            args.push({ name: parsedArg.name, kind: Transform.convertAssignmentType(String((value as Record<string, unknown>).tag)), ...Transform.parseInlineValue(value as Record<string, unknown>) });
          }
          break;
        case "compare":
          args.push({ name: parsedArg.name, kind: "assign:expr", value: Transform.createInlineComparison(value) });
          break;
        case "map:dbo": {
          let dboName: string;
          try {
            dboName = script().mapIdToDboName(value);
          } catch {
            dboName = "";
          }
          args.push({ name: parsedArg.name, kind: "static:text", value: dboName });
          break;
        }
        case "assign":
          args.push(Transform.convertAssignmentValue(value, parsedArg.name));
          break;
        case "var":
        default: {
          const arg: KindNode = { name: parsedArg.name, kind: "static:text", value };
          if (arg.name === "as") {
            const filters: string[] = [];
            for (const filter of ((get(item.output, "filters") as unknown[]) ?? []) as Array<Record<string, unknown>>) {
              filters.push(Transform.createInlineFilter(filter, ScriptHelper.isVerbose()));
            }
            if (filters.length) arg.filter = filters.join("|");
          }
          args.push(arg);
        }
      }
    }

    const blocks = t.blocks ?? [];
    if (!phpEmpty(blocks)) {
      if (Array.isArray(blocks)) throw new Error("Invalid block transform.");
      for (const [k, vIn] of Object.entries(blocks as Record<string, unknown>)) {
        let v = vIn;
        let tag: string | null = null;
        if (v instanceof TaggedValue) {
          tag = v.getTag();
          v = v.getValue();
        }

        const parsedArg = { ...parseAssignment(k, false) };
        let value = mapperGet(String(v), item, NOT_FOUND);

        if (value === NOT_FOUND) {
          if (parsedArg.hasDefault) {
            value = parsedArg.default;
          } else {
            const el = xsGetElement(parsedArg.name, kind.getBlocks());
            if (!el.schema.required) continue;
            if (parsedArg.required) {
              parsedArg.required = false;
              parsedArg.hasDefault = true;
              value = parsedArg.default = "";
            }
          }
        }

        const outBlocks = ret.blocks as KindNode[];
        if (tag === "assign:repeating") {
          outBlocks.push(...Transform.convertRepeatingAssignmentValue(value, parsedArg.name));
          continue;
        }

        let matchedBlock: KindNode | null;
        switch (tag) {
          case "stack":
            matchedBlock = Transform.convertStack(value, parsedArg.name);
            break;
          case "assign":
            matchedBlock = Transform.convertAssignmentValue(value, parsedArg.name);
            break;
          case "assign:dynamic":
            matchedBlock = Transform.convertDynamicAssignmentValue(value, parsedArg.name);
            break;
          case "assign:dynamic:dbo":
            matchedBlock = Transform.convertDynamicDboAssignmentValue(value, parsedArg.name);
            break;
          case "assign:compare":
            matchedBlock = Transform.convertAssignmentValue({ tag: "const:expr2", value: Transform.createInlineComparison(value) }, parsedArg.name);
            break;
          case "db:output":
            matchedBlock = Transform.onDbOutput(value);
            break;
          case "db:addon":
            matchedBlock = Transform.onDbAddon(value);
            break;
          case "map:dbo":
            matchedBlock = Transform.onMapDbo(value, parsedArg.name);
            break;
          case "map:dbo:constant":
            matchedBlock = Transform.onMapDboConstant(value, parsedArg.name);
            break;
          default:
            matchedBlock = { kind: "static:text", name: parsedArg.name, value };
        }

        if (matchedBlock && !phpEmpty(matchedBlock)) outBlocks.push(matchedBlock);
      }
    }

    return ret;
  },

  onSchemaMocks(item: Record<string, unknown>, ret: KindNode): void {
    if (!phpEmpty(item.mocks)) {
      const ctx = Transform.getContext() as Record<string, unknown> | null;
      const data = item.mocks;
      if (isPhpArray(data) && !phpEmpty(data)) {
        const obj: KindNode = { kind: "assign:object", name: "mock", value: {} };
        const value = obj.value as Record<string, unknown>;
        for (const test of ((ctx?.test as unknown[]) ?? []) as Array<Record<string, unknown>>) {
          let mockName: string | false = false;
          let mock: Record<string, unknown> | null = null;
          // PHP compares `$test["id"] === $testId` where a numeric-string key has
          // already become an int; JS keys stay strings, so compare their text.
          for (const [testId, v] of Object.entries(data as Record<string, unknown>)) {
            if (String(test.id) === testId) {
              mockName = String(test.name);
              mock = v as Record<string, unknown>;
              break;
            }
          }
          if (mockName === false || !mock) continue;

          const raw = Transform.createInlineValue(mock, { name: "value", tag: ScriptHelper.isVerbose(), raw: false, wrapIfExpression: false });
          let name = mockName;
          if (!(mock.enabled ?? true)) name = "!" + Parser.wrapText(name);
          value[name] = new RawValue(raw);
        }
        (ret.blocks as KindNode[]).push(obj);
      }
    }
  },

  onDbOutput(value: unknown): KindNode | null {
    const items: KindNode[] = [];
    DB.onOutput(value, items);
    return items[0] ?? null;
  },

  onDbAddon(value: unknown): KindNode | null {
    const items: KindNode[] = [];
    DB.onAddonAssign(value, items);
    return items[0] ?? null;
  },

  onMapDbo(valueIn: unknown, name: string): KindNode {
    const value = Transform.convertAssignmentValue(valueIn, name);
    switch (value.kind) {
      case "static:text":
      case "assign:text": {
        let dboName: string;
        try {
          dboName = script().mapIdToDboName(value.value);
        } catch {
          dboName = "";
        }
        value.value = dboName;
        break;
      }
    }
    return value;
  },

  onMapDboConstant(valueIn: unknown, name: string): KindNode {
    let value = valueIn;
    if (!phpEmpty(value)) {
      try {
        value = script().mapIdToDboName(value);
      } catch {
        value = "";
      }
    }
    return Transform.inlineAssign(name, value);
  },

  compare(a: unknown, b: unknown): boolean {
    return deepEqual(prep(a), prep(b));
  },

  onSchemaResponse(data: Record<string, unknown>): KindNode {
    let list = (data.result ?? []) as unknown;
    if (isPhpArray(list)) {
      list = (Object.values(list as object) as unknown[]).filter((v) => isPhpArray(v) && !Array.isArray(v) && !phpEmpty((v as Record<string, unknown>).tag));
    }

    let obj: KindNode;
    if (Array.isArray(list) && list.length > 0) {
      obj = { kind: "assign:object", name: "response", value: {} };
      const value = obj.value as Record<string, unknown>;
      let last: Record<string, unknown> = {};
      for (const v of list as Array<Record<string, unknown>>) {
        last = v;
        const raw = Transform.createInlineValue(v, { name: "value", tag: ScriptHelper.isVerbose(), raw: false, wrapIfExpression: false });
        let name = String(v.name ?? "");
        if (v.disabled) name = "!" + Parser.wrapText(name);
        value[name] = new RawValue(raw);
      }
      if (Object.keys(value).length === 1 && phpEmpty(last.name)) {
        obj = Transform.convertAssignmentValue(list[0] ?? null, "response");
      }
    } else {
      obj = { kind: "assign:null", name: "response", value: "null" };
    }
    return obj;
  },

  onSchemaRequestHistory(item: Record<string, unknown>, schema: KindNode, enabledField = "enabled", limitField = "limit", disableIsZero = false): void {
    const history = (item.history ?? {}) as Record<string, unknown>;
    if (history.inherit ?? true) return;
    const blocks = schema.blocks as KindNode[];

    if (!(history[enabledField] ?? false)) {
      if (disableIsZero) blocks.push(Transform.inlineAssign("history", 0, "static:int"));
      else blocks.push(Transform.inlineAssign("history", false, "static:bool"));
      return;
    }

    if (looseEquals(history[limitField] ?? 100, -1)) {
      blocks.push(Transform.inlineAssign("history", "all", "static:text"));
      return;
    }

    blocks.push(Transform.inlineAssign("history", history[limitField] ?? 100, "static:int"));
  },

  onSchemaCors(item: Record<string, unknown>, schema: KindNode): void {
    const cors = (item.cors ?? {}) as Record<string, unknown>;
    if ((cors.mode ?? "default") === "default") return;

    const out: KindNode[] = [Transform.inlineAssign("mode", cors.mode, "static:text")];
    if ("allowOrigins" in cors) out.push(Transform.inlineAssign("origins", cors.allowOrigins, "static:text[]"));
    if ("allowMethods" in cors) {
      const methods: string[] = [];
      for (const [key, val] of Object.entries((cors.allowMethods ?? {}) as Record<string, unknown>)) {
        if (val) methods.push(key.toUpperCase());
      }
      out.push(Transform.inlineAssign("methods", methods, "static:text[]"));
    }
    if ("allowHeaders" in cors) out.push(Transform.inlineAssign("headers", cors.allowHeaders, "static:text[]"));
    if ("allowCredentials" in cors) out.push(Transform.inlineAssign("credentials", cors.allowCredentials, "static:bool"));
    if ("maxAge" in cors) out.push(Transform.inlineAssign("max_age", cors.maxAge, "static:int"));

    (schema.blocks as KindNode[]).push(Transform.inlineAssign("cors", out, "static:object"));
  },

  onSchemaCache(item: Record<string, unknown>, schema: KindNode): void {
    const cache = (item.cache ?? {}) as Record<string, unknown>;
    if (!(cache.active ?? false)) return;
    const out: KindNode[] = [
      Transform.inlineAssign("ttl", cache.ttl, "static:int"),
      Transform.inlineAssign("input", cache.input, "static:bool"),
      Transform.inlineAssign("auth", cache.auth, "static:bool"),
      Transform.inlineAssign("datasource", cache.datasource, "static:bool"),
      Transform.inlineAssign("ip", cache.ip, "static:bool"),
      Transform.inlineAssign("headers", cache.headers, "static:text[]"),
      Transform.inlineAssign("env", cache.env, "static:text[]"),
    ];
    (schema.blocks as KindNode[]).push(Transform.inlineAssign("cache", out, "static:object"));
  },

  onSchemaTesting(item: Record<string, unknown>, schema: KindNode): void {
    if (phpEmpty(item.test ?? [])) return;
    for (const test of Object.values((item.test ?? []) as object) as Array<Record<string, unknown>>) {
      (schema.blocks as KindNode[]).push(Transform.onSchemaTest(test as Record<string, unknown>));
    }
  },

  onSchemaMiddlewareMapping(item: Record<string, unknown>, schema: KindNode): void {
    const mw = (item.middleware ?? {}) as Record<string, unknown>;
    if (!(mw.pre_customize ?? false) && !(mw.post_customize ?? false)) return;

    const middleware: KindNode[] = [];
    if (mw.pre_customize ?? false) {
      const blocks: KindNode[][] = [];
      for (const node of Object.values((mw.pre ?? []) as object) as Array<Record<string, unknown>>) {
        blocks.push(Transform.createSchemaMiddlewareAssignment(node));
      }
      middleware.push(Transform.createStaticObject("pre", blocks, true));
    }
    if (mw.post_customize ?? false) {
      const blocks: KindNode[][] = [];
      for (const node of Object.values((mw.post ?? []) as object) as Array<Record<string, unknown>>) {
        blocks.push(Transform.createSchemaMiddlewareAssignment(node));
      }
      middleware.push(Transform.createStaticObject("post", blocks, true));
    }
    (schema.blocks as KindNode[]).push(Transform.createStaticObject("middleware", middleware));
  },

  onSchemaToolMapping(item: Record<string, unknown>, schema: KindNode): void {
    const blocks: KindNode[][] = [];
    if (item.tool) {
      for (const node of Object.values(item.tool as object) as Array<Record<string, unknown>>) {
        try {
          blocks.push(Transform.createSchemaToolAssignment(node));
        } catch {
          // ignore
        }
      }
    }
    (schema.blocks as KindNode[]).push(Transform.createStaticObject("tools", blocks, true));
  },

  createSchemaMiddlewareAssignment(item: Record<string, unknown>): KindNode[] {
    const blocks: KindNode[] = [];
    let middlewareName: string;
    try {
      middlewareName = script().mapIdToMiddlewareName(mapperGet("context.middleware.id", item, 0));
    } catch {
      middlewareName = "";
    }
    blocks.push(Transform.inlineAssign("name", middlewareName));
    if (item.disabled ?? false) blocks.push(Transform.inlineAssign("active", false, "static:bool"));
    return blocks;
  },

  createSchemaToolAssignment(item: Record<string, unknown>): KindNode[] {
    const blocks: KindNode[] = [];
    blocks.push(Transform.inlineAssign("name", script().mapIdToToolName(item.id ?? 0)));

    const active = item.enabled ?? true;
    if (!active) blocks.push(Transform.inlineAssign("active", active, "static:bool"));

    if (!phpEmpty(item.auth)) {
      let authName: string;
      try {
        authName = script().mapIdToDboName(item.auth);
      } catch {
        authName = "";
      }
      if (authName !== "") blocks.push(Transform.inlineAssign("auth", authName));
    }

    let type = String(item.type ?? "");
    if (type === "") type = "tool";
    if (type !== "tool") blocks.push(Transform.inlineAssign("type", type));
    if (type === "resource" && !phpEmpty(item.resource_uri)) blocks.push(Transform.inlineAssign("resource_uri", item.resource_uri));
    if (type === "tool" && !phpEmpty(item.tool_meta)) blocks.push(Transform.inlineAssign("tool_meta", item.tool_meta));
    return blocks;
  },

  onSchemaTest(item: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:test", args: [Transform.inlineAssign("name", item.name)], blocks: [] };
    const blocks = ret.blocks as KindNode[];
    if (!phpEmpty(item.description)) blocks.push(Transform.inlineAssign("description", item.description));
    if (!phpEmpty(item.datasource)) blocks.push(Transform.inlineAssign("datasource", item.datasource));
    if (!phpEmpty(item.input)) {
      const input: Record<string, unknown> = {};
      for (const inputItem of Object.values(item.input as object) as Array<Record<string, unknown>>) {
        input[String(inputItem.name)] = Transform.createInlineValue(inputItem);
      }
      blocks.push(Transform.inlineAssign("input", input, "assign:object"));
    }
    for (const expectItem of Object.values((item.expect ?? []) as object) as Array<Record<string, unknown>>) {
      blocks.push(Transform.onSchemaExpect(expectItem));
    }
    return ret;
  },

  filterExpectVar(v: Record<string, unknown>): Record<string, unknown> {
    const out = { ...v };
    if (out.tag === "const") {
      if (typeof out.value === "string" && ctypeDigit(out.value)) {
        out.value = intval(out.value);
        out.tag = "const:int";
      }
    }
    return out;
  },

  onSchemaExpect(item: Record<string, unknown>): KindNode {
    const kind = script().getKind("schema:test|expect." + String(item.type)) as SchemaKind;
    const ret: KindNode = { kind: kind.getKind(), args: [], blocks: [] };
    const vars = (item.vars ?? []) as Array<Record<string, unknown>>;

    if (vars[0] !== undefined && !mapperEmpty(kind.getArgs())) {
      const args = kind.getArgs();
      const arg = Transform.convertAssignmentValue(vars[0], Object.keys(args)[0]!);
      if (arg.kind === "assign:response") {
        const v = strval(arg.value);
        if (v.startsWith("response")) arg.value = v.substring("response".length).replace(/^\.+/, "");
      }
      (ret.args as KindNode[]).push(arg);
    }

    const blockKeys = Object.keys((kind.getBlocks() ?? {}) as Record<string, unknown>);
    if (vars[1] !== undefined) {
      const keyParam = parseAssignment(blockKeys[0]!);
      (ret.blocks as KindNode[]).push(Transform.convertAssignmentValue(Transform.filterExpectVar(vars[1]), keyParam.name));
    }
    if (vars[2] !== undefined) {
      const keyParam = parseAssignment(blockKeys[1]!);
      (ret.blocks as KindNode[]).push(Transform.convertAssignmentValue(Transform.filterExpectVar(vars[2]), keyParam.name));
    }
    return ret;
  },

  setPrefix(prefix: string, value: string): string {
    if (phpEmpty(value)) return prefix;
    if (value.startsWith("[")) return prefix + value;
    return prefix + "." + value;
  },

  createStaticObject(name: string, blocks: unknown, list = false): KindNode {
    return { kind: list ? "static:object[]" : "static:object", name, value: blocks };
  },

  onSchemaWhile(data: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:while", args: [], blocks: [] };
    const expr = mapperGet("context.expr", data, null);
    if (expr === null) {
      (ret.args as KindNode[]).push({ name: "expr", kind: "assign:bool", value: "false" });
    } else {
      (ret.args as KindNode[]).push({ name: "expr", kind: "assign:expr", value: Transform.createInlineComparison(expr) });
    }
    (ret.blocks as KindNode[]).push(Transform.onSchemaStack(mapperGet("context.run", data, []), "each"));
    return ret;
  },

  onSchemaForeach(data: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:foreach", args: [], blocks: [] };
    const list = mapperGet("context.list", data, []);
    if (mapperEmpty(list)) {
      (ret.args as KindNode[]).push({ name: "expr", kind: "assign:expr", value: "[]" });
    } else {
      const l = list as Record<string, unknown>;
      (ret.args as KindNode[]).push({ kind: Transform.convertAssignmentType(String(l.tag ?? "const:null")), name: "expr", ...Transform.parseInlineValue(l) });
    }
    (ret.blocks as KindNode[]).push(
      Transform.onSchemaEachStack({ asvar: mapperGet("context.as", data, ""), stack: mapperGet("context.run", data, []) }, "each"),
    );
    return ret;
  },

  onSchemaSwitch(data: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:switch", args: [], blocks: [] };
    (ret.args as KindNode[]).push(Transform.convertAssignmentValue(mapperGet("context.value", data), "expr"));
    const elseIfs = (mapperGet("context.elif.run", data, []) as unknown[]) ?? [];
    for (const elseIf of elseIfs as Array<Record<string, unknown>>) {
      if ((elseIf.name ?? "") !== "mvp:switch_case") continue;
      (ret.blocks as KindNode[]).push(Transform.onSchemaCaseStack(elseIf));
    }
    const elseRun = mapperGet("context.else.run", data, []);
    if (!phpEmpty(elseRun)) (ret.blocks as KindNode[]).push(Transform.onSchemaStack(elseRun, "default"));
    return ret;
  },

  onSchemaTrycatch(data: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:try_catch", blocks: [] };
    const map: Record<string, string> = { "context.if.run": "try", "context.else.run": "catch", "context.then.run": "finally" };
    for (const [key, name] of Object.entries(map)) {
      const run = mapperGet(key, data, []);
      if (["try", "catch"].includes(name) || !phpEmpty(run)) {
        (ret.blocks as KindNode[]).push(Transform.onSchemaStack(run, name));
      }
    }
    return ret;
  },

  onSchemaPostprocess(data: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:util.post_process", args: [], blocks: [] };
    (ret.blocks as KindNode[]).push(Transform.onSchemaStack(mapperGet("context.run", data, [])));
    return ret;
  },

  onSchemaQueryAll(data: Record<string, unknown>): KindNode {
    return DB.onSchemaQueryAll(data);
  },

  onSchemaCaseStack(data: Record<string, unknown>): KindNode {
    const ret: KindNode = { kind: "schema:casestack", args: [], name: "case", blocks: [] };
    const blocks = ret.blocks as KindNode[];
    if (!phpEmpty(data.disabled)) blocks.push(Transform.inlineAssign("disabled", data.disabled, "static:bool"));
    if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));
    (ret.args as KindNode[]).push(Transform.convertAssignmentValue(mapperGet("context.value", data), "expr"));
    (ret.args as KindNode[]).push(Transform.inlineAssign("break", mapperGet("context.break", data, false), "static:bool"));
    blocks.push(...Transform.onSchemaStackBlocks(mapperGet("context.if.run", data, [])));
    return ret;
  },

  onSchemaStackBlocks(stack: unknown): KindNode[] {
    const blocks: KindNode[] = [];
    if (!phpEmpty(stack)) {
      for (const stackItem of Object.values(stack as object) as Array<Record<string, unknown>>) {
        if (phpEmpty(stackItem.name)) continue;
        try {
          const kindName = Transform.getKindFromStatement(String(stackItem.name));
          blocks.push(Transform.convertStackItem(kindName, stackItem));
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Invalid kind1")) {
            blocks.push(Transform.createErrorBlock(stackItem));
          } else {
            throw e;
          }
        }
      }
    }
    return blocks;
  },

  onSchemaEachStack(item: Record<string, unknown>, name = ""): KindNode {
    const ret: KindNode = {
      kind: "schema:eachstack",
      args: [{ name: "asvar", kind: "static:text", value: item.asvar }],
      blocks: Transform.onSchemaStackBlocks(item.stack),
    };
    if (!phpEmpty(name)) ret.name = name;
    return ret;
  },

  onSchemaStack(stack: unknown, name = ""): KindNode {
    const ret: KindNode = { kind: "schema:stack", blocks: Transform.onSchemaStackBlocks(stack) };
    if (!phpEmpty(name)) ret.name = name;
    return ret;
  },

  onSchemaInput(data: unknown): KindNode {
    const ret: KindNode = { kind: "schema:input", blocks: [] };
    if (!phpEmpty(data)) {
      for (const inputItem of Object.values(data as object) as Array<Record<string, unknown>>) {
        if (phpEmpty(inputItem.name)) continue;
        (ret.blocks as KindNode[]).push(Transform.convertFromInputItem(inputItem));
      }
    }
    return ret;
  },

  onSchemaOutput(data: unknown): KindNode {
    const ret: KindNode = { kind: "schema:output", blocks: [] };
    if (!phpEmpty(data)) {
      for (const inputItem of Object.values(data as object) as Array<Record<string, unknown>>) {
        (ret.blocks as KindNode[]).push(Transform.convertFromInputItem(inputItem));
      }
    }
    return ret;
  },

  convertTypeToSchema(typeIn: string): string {
    let type = typeIn;
    if (type.endsWith("_mvpschema") || type.endsWith("_mvpschema[]")) return "schema:dblink";
    if (type === "" || type === "[]") return type === "[]" ? "schema:text[]" : "schema:text";
    const isList = type.endsWith("[]");
    if (isList) type = type.substring(0, type.length - 2);
    type = TYPE_MAP[type] ?? type;
    if (isList) type += "[]";
    return "schema:" + type;
  },

  safeBoolean(value: unknown): boolean {
    try {
      return filterBoolean(value);
    } catch {
      return false;
    }
  },

  convertFromInputItem(item: Record<string, unknown>): KindNode {
    let ignoreProperties = false;
    const style = item.style ?? null;
    const isList = (isPhpArray(style) ? (style as Record<string, unknown>).type ?? null : style) === "list";
    const itemType = String(item.type ?? "");

    const ret: KindNode = { kind: Transform.convertTypeToSchema(itemType + (isList ? "[]" : "")), args: [], blocks: [] };
    const args = ret.args as KindNode[];
    const blocks = ret.blocks as KindNode[];

    if (itemType !== "dblink") {
      args.push({ name: "name", kind: "static:text", value: item.name });
    }

    let filters: string[] = [];
    if (isList) {
      const min = intval(mapperGet("list.min", item, 0));
      const max = intval(mapperGet("list.max", item, 0));
      if (min > 0) filters.push(`minlist:${min}`);
      if (max > 0) filters.push(`maxlist:${max}`);
    }

    for (const method of Object.values((item.methods ?? []) as object) as Array<Record<string, unknown>>) {
      if (method.name === "values" && itemType === "enum") {
        blocks.push({ kind: "static:text[]", name: method.name, value: method.arg });
        continue;
      }
      const argParts = (Object.values((method.arg ?? []) as object) as unknown[]).map((x) => {
        if (ValueHelper.isInt(x)) return strval(x);
        if (ValueHelper.isDecimal(x)) return strval(x);
        if (ValueHelper.isBool(x)) return strval(x);
        if (ValueHelper.isArray(x)) return Array.isArray(x) ? "" : strval(x);
        if (ValueHelper.isObject(x)) return isPhpObject(x) ? "" : strval(x);
        return strval(ScriptHelper.wrapScalar(x));
      });
      filters.push([(method.disabled ? "!" : "") + String(method.name), ...argParts].join(":"));
    }

    if (itemType === "vector") blocks.push(Transform.inlineAssign("size", mapperGet("vector.size", item, 3), "static:int"));

    if (!phpEmpty(item.values) && itemType === "enum") {
      const enumValues: string[] = [];
      for (const v of Object.values(item.values as object)) {
        if (isPhpArray(v)) {
          for (const v2 of Object.values(v as object)) if (isScalar(v2)) enumValues.push(strval(v2));
        } else if (isScalar(v)) {
          enumValues.push(strval(v));
        }
      }
      blocks.push({ kind: "static:text[]", name: "values", value: arrayUnique(enumValues) });
    }

    if (ret.kind === "schema:dblink") {
      const parts = itemType.split("_");
      ret.args = [];
      blocks.push({ name: "table", kind: "static:text", value: script().mapIdToDboName(parts[0], false) });

      if (!phpEmpty(item.customize)) {
        const override: KindNode[] = [];
        for (const [k, v] of Object.entries(item.customize as Record<string, Record<string, unknown>>)) {
          const partsOut: KindNode[] = [];
          for (const field of ["hidden"]) partsOut.push(Transform.inlineAssign(field, !phpEmpty(v[field]), "static:bool"));
          for (const field of ["filters"]) {
            if (!phpEmpty(v[field])) partsOut.push(Transform.inlineAssign(field, true, "static:bool"));
          }
          for (const field of ["required"]) {
            if (!phpEmpty(v[field])) partsOut.push(Transform.inlineAssign(field, true, "static:bool"));
          }
          if (partsOut.length) override.push(Transform.inlineAssign(k, partsOut, "static:object"));
        }
        if (override.length) blocks.push(Transform.inlineAssign("override", override, "static:object"));
      }
      ignoreProperties = true;
    }

    if (filters.length && !ignoreProperties) {
      if (["schema:int", "schema:int[]", "schema:uuid", "schema:uuid[]"].includes(ret.kind)) {
        const findMe = '@:"dbo=';
        for (let k = 0; k < filters.length; k++) {
          const v = filters[k]!;
          if (v.startsWith(findMe)) {
            blocks.push({ name: "table", kind: "static:text", value: script().mapIdToDboName(v.substring(findMe.length, v.length - 1), false) });
            filters.splice(k, 1);
            break;
          }
        }
      }
      if (filters.length) {
        (ret.args as KindNode[]).push({ name: "filters", kind: "static:text", value: filters.join("|") });
      }
    }

    if (item.nullable && !ignoreProperties) (ret.args as KindNode[]).push({ name: "nullable", kind: "static:bool", value: true });
    if (!item.required && !ignoreProperties) (ret.args as KindNode[]).push({ name: "optional", kind: "static:bool", value: true });

    const hasDefault = item.default !== undefined && item.default !== null;
    const isNumericZero = ["int", "decimal"].includes(itemType) && hasDefault && (item.default === "0" || item.default === 0);
    let defaultIsZero: boolean;
    if (itemType === "bool") defaultIsZero = hasDefault && !Transform.safeBoolean(item.default);
    else defaultIsZero = isNumericZero;
    const isEmpty = hasDefault && item.default === "";

    if (hasDefault && !isEmpty && !ignoreProperties && (!defaultIsZero || !phpEmpty(item.nullable))) {
      if (itemType === "bool") {
        (ret.args as KindNode[]).push({ name: "default", kind: "static:text", value: Transform.safeBoolean(item.default) ? "true" : "false" });
      } else {
        (ret.args as KindNode[]).push({ name: "default", kind: "static:text", value: item.default });
      }
    }

    if (!phpEmpty(item.description)) blocks.push(Transform.inlineAssign("description", item.description));
    if (!phpEmpty(item.sensitive)) blocks.push(Transform.inlineAssign("sensitive", item.sensitive, "static:bool"));
    if (!phpEmpty(item.access) && item.access !== "public") blocks.push(Transform.inlineAssign("visibility", item.access));

    switch (ret.kind) {
      case "schema:object":
      case "schema:object[]":
        blocks.push(Transform.convertToKind("schema:schema", item.children ?? []));
        break;
    }
    return ret;
  },

  createToSchemaTableTags(schema: KindNode, items: unknown): void {
    if (isPhpArray(items) && !phpEmpty(items)) {
      const tags: unknown[] = [];
      for (const item of Object.values(items as object) as Array<Record<string, unknown>>) tags.push(item.tag);
      (schema.blocks as KindNode[]).push(Transform.inlineAssign("tags", tags, "static:text[]"));
    }
  },

  onSchemaSchema(input: unknown): KindNode {
    const ret: KindNode = { kind: "schema:schema", blocks: [] };
    if (!phpEmpty(input)) {
      const hash: Record<string, boolean> = {};
      for (const inputItem of Object.values(input as object) as Array<Record<string, unknown>>) {
        const name = String(inputItem.name ?? "");
        if (phpEmpty(name)) continue;
        if (hash[name]) continue;
        (ret.blocks as KindNode[]).push(Transform.convertFromInputItem(inputItem));
        hash[name] = true;
      }
    }
    return ret;
  },

  createErrorBlock(item: Record<string, unknown>): KindNode {
    return { kind: "schema:placeholder", args: [{ name: "name", kind: "static:text", value: item.name ?? "NA" }], blocks: [] };
  },

  inlineAssign(key: string, value: unknown, kind = "static:text"): KindNode {
    return { kind, name: key, value };
  },

  convertFromAssignmentType(type: string): string {
    switch (type) {
      case "assign:text":
      case "static:text":
        return "const";
      case "assign:int":
      case "static:int":
        return "const:int";
      case "assign:decimal":
      case "static:decimal":
        return "const:decimal";
      case "assign:bool":
      case "static:bool":
        return "const:bool";
      case "assign:expr":
      case "assign:expr[]":
        return "const:expr2";
      case "assign:input":
        return "input";
      case "assign:response":
        return "response";
      case "assign:var":
        return "var";
      case "assign:output":
        return "output";
      case "assign:error":
        return "trycatch";
      case "assign:toolset":
        return "toolset";
      case "assign:db":
        return "col";
      case "assign:env":
        return "setting";
      case "assign:reg":
        return "reg";
      case "static:object":
      case "assign:object":
        return "const:obj";
      case "assign:array":
      case "static:array":
        return "const:array";
      case "assign:any":
        return "const:any";
      case "assign:null":
      case "static:null":
        return "const:null";
      case "assign:timestamp":
      case "static:timestamp":
        return "const:epochms";
      case "assign:auth":
        return "auth";
      case "static:bool[]":
      case "static:json":
      case "static:int[]":
      case "static:text[]":
      case "static:object[]":
        return "const:expr2";
    }
    throw new Error("TODO - convertFromAssignmentType - " + type);
  },

  convertAssignmentType(type: string): string {
    switch (type) {
      case "const":
      case "const:text":
        return "assign:text";
      case "const:bool":
        return "assign:bool";
      case "const:int":
        return "assign:int";
      case "const:decimal":
        return "assign:decimal";
      case "const:expr":
      case "const:expr2":
        return "assign:expr";
      case "setting":
        return "assign:env";
      case "reg":
        return "assign:reg";
      case "const:array":
        return "assign:array";
      case "const:obj":
        return "assign:object";
      case "var":
        return "assign:var";
      case "output":
        return "assign:output";
      case "trycatch":
        return "assign:error";
      case "col":
        return "assign:db";
      case "input":
        return "assign:input";
      case "response":
        return "assign:response";
      case "toolset":
        return "assign:toolset";
      case "const:null":
        return "assign:null";
      case "const:encoded":
        return "assign:text";
      case "auth":
        return "assign:auth";
      case "const:any":
        return "assign:any";
      case "const:epochms":
        return "assign:timestamp";
    }
    throw new Error("Unsupported assignment type: " + type);
  },

  convertAssignmentValue(itemIn: unknown, name = "value"): KindNode {
    let item = itemIn;
    if (Array.isArray(item) && item.length === 0) return Transform.inlineAssign(name, [], "assign:array");
    if (item instanceof StdClass) item = {};
    if (typeof item === "number" && Number.isInteger(item)) return { kind: "assign:int", name, value: item };
    if (typeof item === "boolean") return { kind: "assign:bool", name, value: item };
    if (phpEmpty(item)) return Transform.inlineAssign(name, "", "assign:text");
    if (isScalar(item)) return { kind: "assign:text", name, value: item };

    let it = item as Record<string, unknown>;
    if (it.tag === "const:epochms" && typeof it.value === "string" && !ValueHelper.isTimestamp(it.value)) {
      it = { tag: "const", value: it.value, filters: it.filters ?? [] };
    }
    let tag = (it.tag ?? null) as string | null;
    if (!tag) {
      const val = it.value ?? null;
      tag = val === null || val === "null" ? "const:null" : "const:text";
      it = { ...it, tag };
    }
    return { kind: Transform.convertAssignmentType(tag), name, ...Transform.parseInlineValue(it) };
  },

  convertFromAssignmentValue(kind: string, valueIn: unknown, filterIn: unknown, name = "value", raw: unknown = null, forceRaw = false): Record<string, unknown> {
    let tag = Transform.convertFromAssignmentType(kind);
    let value = valueIn;
    let filter = filterIn;
    const isEmptyish = (v: unknown) => v === "{}" || v === "[]" || (Array.isArray(v) && v.length === 0) || v instanceof StdClass;
    switch (tag) {
      case "const:expr2":
        if (!phpEmpty(raw) && !isEmptyish(value)) {
          const r = Parser.unescapeExpression(raw as string);
          if (forceRaw || kind.endsWith("[]")) value = r;
        }
        break;
      case "const:obj":
        if (!phpEmpty(raw) && !isEmptyish(value)) {
          tag = "const:expr2";
          value = raw;
          filter = null;
        } else {
          value = "{}";
        }
        break;
      case "const:array":
        if (!phpEmpty(raw) && !isEmptyish(value)) {
          tag = "const:expr2";
          value = raw;
          filter = null;
        } else {
          value = "[]";
        }
        break;
      case "const:bool":
        if (typeof value === "boolean") value = value ? "true" : "false";
        break;
    }

    const filters = Transform.parseFilters(filter as string | null);
    if (filters.length) {
      if (typeof value === "string" && value.startsWith('"')) {
        value = parseGroup(value);
        value = (value as string).substring(1, (value as string).length - 1);
      }
    }
    return { tag, [name]: value, filters };
  },

  parseFilters(filter: string | null | undefined): Array<Record<string, unknown>> {
    const filters: Array<Record<string, unknown>> = [];
    if (!phpEmpty(filter)) {
      const methods = Parser.splitPipe(filter as string);
      for (const methodIn of methods) {
        const method = Parser.stripParentheses(methodIn) as string;
        const parts = Parser.splitColon(method);
        const filterName = (parts.shift() ?? "").replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, "");
        const newFilter: Record<string, unknown> = { name: Transform.fromPipeName(filterName), arg: [] };
        if (Transform.isDisabled(filterName)) newFilter.disabled = true;

        for (const part of parts) {
          const arg = Assign.parse(part, Assign.MODE_RIGHT, true, "=", false, true);
          const filterArg: Record<string, unknown> = {
            tag: Transform.convertFromAssignmentType(arg.result.kind),
            value: Parser.stripParentheses(arg.result.value as string),
            filters: Transform.parseFilters((arg.result.filter as string) ?? ""),
          };
          switch (filterArg.tag) {
            case "const:expr2": {
              const test = arg.result.raw ?? "";
              if (!mapperEmpty(test)) filterArg.value = test;
              break;
            }
            case "const:obj": {
              const test = arg.result.raw ?? "";
              if (!mapperEmpty(test) && test !== "{}") {
                filterArg.tag = "const:expr2";
                filterArg.value = test;
              } else {
                filterArg.value = "{}";
              }
              break;
            }
            case "const:array": {
              const test = arg.result.raw ?? "";
              if (!mapperEmpty(test) && test !== "[]") {
                filterArg.tag = "const:expr2";
                filterArg.value = test;
              } else {
                filterArg.value = "[]";
              }
              break;
            }
          }
          (newFilter.arg as unknown[]).push(filterArg);
        }
        filters.push(newFilter);
      }
    }
    return filters;
  },

  convertDynamicAssignmentValue(items: unknown, name = "value"): KindNode {
    const out: Record<string, unknown> = {};
    for (const [k, item] of entries(items)) {
      let ret: unknown = Transform.createInlineValue(item, { name: "value", tag: ScriptHelper.isVerbose() });
      if (ScriptHelper.isVerbose() && typeof ret === "string" && ret.startsWith("!")) {
        const parts = ret.split(" ");
        const first = parts.shift()!;
        ret = new TaggedValue(first.substring(1), parts.join(" "));
      }
      out[String(k)] = ret;
    }
    return { kind: "assign:object", name, value: Array.isArray(items) ? Object.values(out) : out };
  },

  dropRegistryDefaults(registry: unknown[]): unknown[] {
    return registry.filter((v) => ((v as Record<string, unknown>)?.tag ?? "") !== "use_default");
  },

  inputsToObjectBlock(items: unknown, name = "input"): KindNode {
    const obj: KindNode = { kind: "assign:object", name, value: {} };
    for (const v of Object.values((items ?? {}) as object) as Array<Record<string, unknown>>) {
      const raw = Transform.createInlineValue(v, { name: "value", tag: ScriptHelper.isVerbose(), raw: false });
      (obj.value as Record<string, unknown>)[String(v.name)] = new RawValue(raw);
    }
    return obj;
  },

  convertFlexInputToBlock(items: unknown, name = "input"): KindNode {
    return Transform.convertDynamicDboAssignmentValue(items, name);
  },

  convertDynamicDboAssignmentValue(items: unknown, name = "value"): KindNode {
    const out: Record<string, unknown> = {};
    for (const [k, itemRaw] of entries(items)) {
      const item = itemRaw as Record<string, unknown>;
      if (["field_name", "field_value", "@meta"].includes(String(item.name))) continue;

      let ret: unknown;
      const tag = String(item.tag ?? "");
      if (["const", "const:expr", "const:expr2"].includes(tag) && Parser.isMultilineTicks(item.value) && phpEmpty(item.filters)) {
        ret = new MultiLineValue(item.value as string, tag, 2);
      } else if (["const:expr", "const:expr2"].includes(tag)) {
        ret = Transform.createInlineValue(item, { name: "value", tag: ScriptHelper.isVerbose(), raw: false });
        if (typeof ret === "string" && ret.startsWith("{")) {
          ret = new RawValue(Parser.wrapExpressionText(ret));
        }
      } else {
        ret = Transform.createInlineValue(item, { name: "value", tag: ScriptHelper.isVerbose() });
        if (ScriptHelper.isVerbose() && typeof ret === "string" && ret.startsWith("!")) {
          const parts = ret.split(" ");
          const first = parts.shift()!;
          ret = new TaggedValue(first.substring(1), parts.join(" "));
        }
      }
      out[String(k)] = ret;
    }
    return { kind: "assign:object", name, value: Array.isArray(items) ? Object.values(out) : out };
  },

  renderStaticObject(items: Array<Record<string, unknown>>): string {
    const obj: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const ret: Record<string, unknown> = { name: item.name, ...Transform.convertFromAssignmentValue(String(item.kind), item.value, item.filter ?? null, "value", item.raw ?? null) };
      if (ret.tag === "const:expr2") {
        if (typeof ret.value === "string" && ret.value.includes("\n")) ret.value = indent(ret.value, 2, true);
      }
      obj.push(ret);
    }
    return Transform.createInlineObject(obj, false);
  },

  convertRepeatingAssignmentValue(items: unknown, name = "value"): KindNode[] {
    if (!isPhpArray(items)) return [];
    return (Object.values(items as object) as unknown[]).map((v) => Transform.convertAssignmentValue(v, name));
  },

  convertRepeatingTransformValue(items: unknown): KindNode[] {
    if (!isPhpArray(items)) return [];
    return (Object.values(items as object) as Array<Record<string, unknown>>).map((v) => Transform.convertTransformValue(v));
  },

  convertTransformValue(data: Record<string, unknown>): KindNode {
    const kindValue = Transform.getKindFromStatement(String(data.name));
    const kind = script().getKind(kindValue);
    return Transform.convertStackItem(kind, data);
  },

  convertStack(data: unknown, _name = "value"): KindNode {
    return { kind: "schema:stack", blocks: Transform.convertRepeatingTransformValue(data) };
  },

  // --- decode-side helpers the encoder relies on -----------------------------

  getCompareNode(value: XtItem, allowSubPipes = true): XtItem {
    if ("group" in value && phpEmpty(value.pipes)) {
      const group = value.group as XtItem[];
      if (count(group) === 1) {
        if (phpEmpty(group[0]!.pipes) || allowSubPipes) return Transform.getCompareNode(group[0]!);
      }
    }
    return value;
  },

  renderStack(stack: XtItem[], isQuery = false): string {
    const items: string[] = [];
    let sep = "";
    for (const itemIn of stack) {
      const item = Transform.getCompareNode(itemIn);
      let render = Transform.renderCompareOperand(item, isQuery);
      if (phpEmpty(sep) && !phpEmpty(item.pipes)) render = `(${render})`;
      if (render.endsWith(")") && render.startsWith("[")) sep = "";
      items.push(sep + render);
      sep = render === "-" || render === "!" ? "" : " ";
    }
    return items.join("");
  },

  renderCompareOperandValue(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    return strval(value);
  },

  filterCompareParts(parts: string[]): string[] {
    if (["!", "-", "~"].includes(parts[0] ?? "")) {
      if (parts[1] !== undefined) {
        parts[0] += parts[1];
        parts.splice(1, 1);
      }
    }
    return parts;
  },

  renderCompareOperand(value: XtItem, isQuery = false, wrapPipes = false, _wrapMultiline = false): string {
    let parts: string[];
    if ("array" in value) {
      parts = [];
      for (const entry of value.array as XtItem[]) {
        const items: string[] = [];
        for (const arrayEntry of (entry["array:entry"] as XtItem[]) ?? []) {
          items.push(Transform.renderCompareOperand(arrayEntry, isQuery, wrapPipes));
        }
        parts.push(items.join(" "));
      }
      parts = Transform.filterCompareParts(parts);
      parts = ["[" + parts.join(", ") + "]"];
    } else if ("tenary" in value) {
      let left: string[] = [];
      for (const entry of (value.tenary.left as XtItem[]) ?? []) left.push(Transform.renderCompareOperand(entry, isQuery, wrapPipes));
      left = Transform.filterCompareParts(left);
      let right: string[] = [];
      for (const entry of (value.tenary.right as XtItem[]) ?? []) right.push(Transform.renderCompareOperand(entry, isQuery, wrapPipes));
      right = Transform.filterCompareParts(right);
      parts = ["? " + left.join(" ") + " : " + right.join(" ")];
      if (isQuery) throw new NotSupportedError("Tenary syntax is not supported in this context: " + parts.join(""));
    } else if ("group" in value) {
      parts = [];
      let last: string | null = null;
      let i = 0;
      const len = count(value.group);
      for (const entry of value.group as XtItem[]) {
        let ret = Transform.renderCompareOperand(entry, isQuery, true);
        if (parts.length) {
          if (!(last === "!" || last === "-")) parts.push(" ");
        }
        if (i !== len - 1) {
          if (!phpEmpty(entry.pipes)) ret = `(${ret})`;
        }
        parts.push(ret);
        if (ret === "-" && !(last === "&&" || last === "||")) last = null;
        else last = ret;
        i++;
      }
      parts = Transform.filterCompareParts(parts);
      parts = ["(" + parts.join("") + ")"];
    } else if ("object" in value) {
      parts = [];
      for (const entry of value.object as XtItem[]) {
        let left: string[] = [];
        for (const objEntry of (entry["object:entry"]?.left as XtItem[]) ?? []) left.push(Transform.renderCompareOperand(objEntry, isQuery, wrapPipes));
        left = Transform.filterCompareParts(left);
        let right: string[] = [];
        for (const objEntry of (entry["object:entry"]?.right as XtItem[]) ?? []) right.push(Transform.renderCompareOperand(objEntry, isQuery, wrapPipes));
        right = Transform.filterCompareParts(right);
        parts.push(left.join(" ") + ": " + right.join(" "));
      }
      parts = ["{" + parts.join(", ") + "}"];
    } else {
      parts = [(value.hint ?? "") === "text" ? Parser.wrapText(value.node) : Transform.renderCompareOperandValue(value.node)];
    }

    for (const pipe of (value.pipes as XtItem[]) ?? []) {
      parts.push(Transform.renderCompareOperandPipe(pipe, isQuery));
    }
    return parts.join("|");
  },

  renderCompareOperandPipe(value: XtItem, isQuery = false): string {
    const parts = [strval(value.pipe)];
    for (const arg of (value.args as XtItem[]) ?? []) parts.push(Transform.renderCompareOperandArg(arg, isQuery));
    return parts.join(":");
  },

  shouldCombineNodes(value: string): boolean {
    if (value === "") return true;
    for (const op of SEPERATOR_OPS) {
      if (value === op || value === op + "?") return true;
    }
    if (GROUP_OPS.includes(value)) return true;
    return false;
  },

  renderCompareOperandArg(value: XtItem, isQuery = false): string {
    const parts: string[] = [];
    let last = "";
    for (const entry of (value["arg:entry"] as XtItem[]) ?? []) {
      let next = Transform.renderCompareOperand(entry, isQuery);
      switch (last) {
        case "!":
        case "-":
        case "~":
          if (Transform.shouldCombineNodes(parts[parts.length - 2] ?? "")) {
            parts.pop();
            next = last + next;
          }
          break;
      }
      parts.push(next);
      last = next;
    }
    return parts.join(" ");
  },
};

/** the engine's `prep`: the value normalization behind `compare`. */
function prep(v: unknown): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return "";
  if (v === null || v === undefined) return "";
  if (v === "[]") return [];
  if (v === "{}") return [];
  if (v instanceof StdClass) return [];
  if (isPhpObject(v)) return [];
  return v;
}

/** PHP `===` on the shapes `compare` sees (scalars, lists, maps). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isAssoc(a) && isAssoc(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k, i) => k === kb[i] && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  if (Array.isArray(a) && isAssoc(b)) return a.length === 0 && Object.keys(b).length === 0;
  if (isAssoc(a) && Array.isArray(b)) return b.length === 0 && Object.keys(a).length === 0;
  return false;
}

export { MalformedError };
