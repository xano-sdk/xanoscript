/**
 * The parsed-value node classes the kind parsers produce and the renderer
 * stringifies. Ports of redacted, redacted,
 * redacted and redacted (whose `__toString` is
 * the block/line layout: `first arg… {` + indented blocks + `}` ` as $x`).
 */
import { Assign } from "./assign-parser.js";
import { COMMENT_PREFIX } from "./comment-parser.js";
import { Parser } from "./parser.js";
import { phpEmpty, strval } from "./php.js";
import { ScriptHelper } from "./script-helper.js";
import { indent } from "./system.js";
import { Transform } from "../transform/transform.js";

export interface KindValue {
  getKind(): string;
  getType(): string;
  getName(): string | null;
  toString(): string;
}

export class AssignValue implements KindValue {
  constructor(
    private readonly kind: string,
    private readonly type: string,
    private readonly name: string | null,
    private value: unknown,
    private readonly filter: string | null,
  ) {}

  getName(): string | null {
    return this.name;
  }
  getKind(): string {
    return this.kind;
  }
  getType(): string {
    return this.type;
  }
  getValue(): unknown {
    return this.value;
  }
  getFilter(): string | null {
    return this.filter;
  }
  setValue(value: unknown): void {
    this.value = value;
  }

  getValueAsString(): string {
    return ScriptHelper.renderInline(this.kind, this.type, this.value, this.filter, "assign");
  }

  toString(): string {
    return `${this.getName()} = ${this.getValueAsString()}`;
  }
}

export class StaticValue implements KindValue {
  private origBlocks: unknown = null;

  constructor(
    private readonly kind: string,
    private readonly type: string,
    private readonly name: string | null,
    private value: unknown,
    private readonly schema: unknown = null,
    private readonly filter: string = "",
  ) {}

  getName(): string | null {
    return this.name;
  }
  getKind(): string {
    return this.kind;
  }
  getType(): string {
    return this.type;
  }
  getFilter(): string {
    return this.filter;
  }
  getValue(): unknown {
    return this.value;
  }
  setValue(value: unknown): void {
    this.value = value;
  }
  getOriginalBlocks(): unknown {
    return this.origBlocks;
  }
  setOriginalBlocks(blocks: unknown): void {
    this.origBlocks = blocks;
  }

  getValueAsString(): string {
    const type = this.schema ?? this.type;
    let mode = "scalar";
    if (Array.isArray(type) && typeof this.type === "string" && this.type.endsWith("[]")) mode = "list";
    return String(ScriptHelper.wrap(this.getValue(), true, type, mode));
  }

  toString(): string {
    return `${this.getName()} = ${this.getValueAsString()}`;
  }
}

export class SchemaValue implements KindValue {
  static readonly ARG_NAME = "name";
  static readonly ARG_AS = "as";
  static readonly ARG_ASVAR = "asvar";
  static readonly ARG_EXPR = "expr";
  static readonly ARG_IF = "if";
  static readonly ARG_OPTIONAL = "optional";
  static readonly ARG_NULLABLE = "nullable";
  static readonly ARG_DEFAULT = "default";
  static readonly ARG_BREAK = "break";

  private finalType: string | null = null;

  constructor(
    private readonly kind: string,
    private readonly name: string | null,
    private readonly type: string,
    private args: KindValue[],
    private blocks: KindValue[],
    private readonly labels: string[],
    private readonly defaults: Record<string, unknown> | null,
    private readonly forceExpanded: boolean,
    private readonly ignoreBlacklist: string[],
    private readonly argNameIsVar: boolean,
    private readonly unknownComments: unknown[],
  ) {}

  getName(): string | null {
    return this.name;
  }
  getKind(): string {
    return this.kind;
  }
  getUnknownComments(): unknown[] {
    return this.unknownComments;
  }

  getType(): string {
    if (this.finalType === null) {
      let type = this.type;
      if (type.includes("|")) type = type.split("|")[1]!;

      if (type.endsWith("[]")) {
        let min: string | null = null;
        let max: string | null = null;

        for (let k = 0; k < this.args.length; k++) {
          const block = this.args[k]!;
          if (block.getName() === "filters") {
            const value = strval((block as AssignValue | StaticValue).getValue());
            const filters = Parser.splitPipe(value);
            const kept: string[] = [];
            for (const filter of filters) {
              const parts = Parser.splitColon(filter);
              switch (parts[0]) {
                case "minlist":
                  min = parts[1] ?? null;
                  continue;
                case "maxlist":
                  max = parts[1] ?? null;
                  continue;
              }
              kept.push(filter);
            }
            const joined = kept.join("|");
            if (phpEmpty(joined)) {
              this.args.splice(k, 1);
              k--;
            } else {
              (block as AssignValue | StaticValue).setValue(joined);
            }
            if (min !== null || max !== null) {
              type = type.substring(0, type.length - 2);
              type += `[${min ?? ""}:${max ?? ""}]`;
            }
          }
        }
      }
      this.finalType = type;
    }
    return this.finalType;
  }

  getArgs(): KindValue[] {
    return this.args;
  }
  getBlocks(): KindValue[] {
    return this.blocks;
  }
  setBlocks(blocks: KindValue[]): void {
    this.blocks = blocks;
  }

  private isSpecialArgName(name: string | null): boolean {
    return [
      SchemaValue.ARG_NAME,
      SchemaValue.ARG_AS,
      SchemaValue.ARG_EXPR,
      SchemaValue.ARG_ASVAR,
      SchemaValue.ARG_IF,
      SchemaValue.ARG_NULLABLE,
      SchemaValue.ARG_OPTIONAL,
      SchemaValue.ARG_DEFAULT,
    ].includes(name ?? "");
  }

  private isStatementDisabled(): unknown {
    if (this.labels.includes("statement") || ["casestack", "elseifstack"].includes(this.getType())) {
      for (const block of this.blocks) {
        if (block.getName() === "disabled") return (block as AssignValue | StaticValue).getValue();
      }
    }
    return false;
  }

  private renderComment(value: string): string {
    return value.split("\n").map((x) => `${COMMENT_PREFIX} ${x}`).join("\n");
  }

  toString(): string {
    if (this.getType() === "comment") {
      let value = "comment";
      for (const block of this.blocks) {
        if (block.getName() === "description") value = strval((block as AssignValue | StaticValue).getValue());
      }
      return this.renderComment(value);
    }

    const statementDisabled = this.isStatementDisabled();

    let first = this.getName() ?? this.getType();
    if (statementDisabled) first = "!" + first;

    const str: string[] = [first];

    let argName: string | null = null;
    let argAs: unknown = null;
    let argAsVar: unknown = null;
    let argBreak: unknown = null;
    let argExpr: string | null = null;
    let argIf: string | null = null;
    let argRequired = true;
    let argNullable: unknown = null;
    let argDefault: unknown = null;

    for (const arg of this.args) {
      const argValue = (arg as AssignValue | StaticValue).getValue();
      switch (arg.getName()) {
        case SchemaValue.ARG_NAME: {
          let v = strval(argValue);
          if (v === "") v = '""';
          argName = v;
          if (this.argNameIsVar) {
            argName = argName.replace(/^\$+/, "");
            if (argName === '""' || argName === "''") argName = "$";
            else argName = "$" + argName;
          }
          break;
        }
        case SchemaValue.ARG_AS: {
          argAs = argValue;
          const argFilter = (arg as AssignValue | StaticValue).getFilter();
          if (!phpEmpty(argFilter)) argAs = strval(argAs) + "|" + argFilter;
          break;
        }
        case SchemaValue.ARG_ASVAR:
          argAsVar = argValue;
          break;
        case SchemaValue.ARG_NULLABLE:
          argNullable = argValue;
          break;
        case SchemaValue.ARG_DEFAULT:
          argDefault = argValue;
          break;
        case SchemaValue.ARG_BREAK:
          argBreak = argValue;
          break;
        case SchemaValue.ARG_OPTIONAL:
          argRequired = !argValue;
          break;
        case SchemaValue.ARG_EXPR: {
          const oldMultiline = arg.getKind() === "assign:expr" ? Parser.setMultilineTicks(false) : Parser.isMultilineTicksEnabled();
          try {
            let hint: string | null = null;
            if (arg.getKind() === "assign:expr") {
              const v = strval(argValue);
              if (Assign.isStandaloneExpression(v)) {
                if (Assign.isLegacyExpression(v, false)) hint = "assign";
              }
            }
            argExpr = ScriptHelper.renderInline(arg.getKind(), arg.getType(), argValue, (arg as AssignValue | StaticValue).getFilter(), hint);
            if (argExpr.startsWith("(")) argExpr = indent(argExpr, 2, true);
          } finally {
            Parser.setMultilineTicks(oldMultiline);
          }
          break;
        }
        case SchemaValue.ARG_IF:
          argIf = ScriptHelper.renderInline(arg.getKind(), arg.getType(), argValue, (arg as AssignValue | StaticValue).getFilter());
          break;
      }
    }

    if (argNullable) str[0] += "?";

    if (!phpEmpty(argName)) {
      argName = Parser.wrapSchemaName(argName as string, this.getKind(), this.argNameIsVar);
    }

    if (!argRequired || argDefault !== null) {
      argName = (argName ?? "") + "?";
    }

    if (argDefault !== null) {
      argName += "=" + Parser.wrapDefaultValueWithinSchema(argDefault, this.getKind());
      str.push(argName!);
    } else if (!phpEmpty(argName)) {
      str.push(argName as string);
    }

    if (argExpr !== null) {
      if (argExpr.includes("\n")) {
        const r = argExpr.replace(/[ \t\n\r\0\v]+$/, "");
        if (r.endsWith("]") || r.endsWith("}")) str.push(`(${argExpr})`);
        else str.push(`(${argExpr}\n)`);
      } else {
        str.push(`(${argExpr})`);
      }
    } else if (!phpEmpty(argAsVar)) {
      str.push("as");
      str.push("$" + Parser.wrapVarName(argAsVar));
    } else {
      for (const arg of this.args) {
        if (!this.isSpecialArgName(arg.getName())) {
          str.push(`${arg.getName()}=${strval((arg as AssignValue | StaticValue).getValue())}`);
        }
      }
    }

    if (!phpEmpty(argIf)) {
      str.push("if");
      str.push(`(${argIf})`);
    }

    let head = str.join(" ");

    if (this.blocks.length === 0 && !this.forceExpanded) {
      return this.handlePostArgs(head, argAs, argBreak);
    }

    const lines: string[] = [];
    const indentCols = 2;

    let cnt = this.blocks.length - 1;
    if (statementDisabled) cnt--;
    let i = 0;
    let isPrevSchema: boolean | null = null;
    let lastComment = false;
    let hasComment = false;

    for (const block of this.blocks) {
      if (this.shouldIgnore(block)) {
        i++;
        continue;
      }
      if (statementDisabled && block.getName() === "disabled") continue;

      if (block.getKind() === "static:text" && block.getName() === "description") {
        head = this.renderComment(strval((block as StaticValue).getValue())) + "\n" + head;
        i++;
        continue;
      }

      const ret = block.toString();

      if (ret.startsWith("// ")) {
        if (lines.length) this.addNewLine(lines);
        hasComment = true;
      }

      const isSchema = block instanceof SchemaValue;
      const newBlockNewline = hasComment || this.isMultiline(ret) || block.getType() === "comment";
      hasComment = false;

      if (isPrevSchema !== null) {
        if ((isSchema && !isPrevSchema) || (!isSchema && isPrevSchema)) this.addNewLine(lines);
      }
      isPrevSchema = isSchema;

      lines.push(indent(ret, indentCols));

      if (newBlockNewline && cnt !== i) this.addNewLine(lines);

      lastComment = block.getType() === "comment";
      void lastComment;
      i++;
    }

    if (lines.length === 0 && !this.forceExpanded) {
      return this.handlePostArgs(head, argAs, argBreak);
    }

    lines.unshift(head + " {");
    lines.push(this.handlePostArgs("}", argAs, argBreak));
    return lines.join("\n");
  }

  private addNewLine(lines: string[]): void {
    const len = lines.length;
    if (len > 0 && phpEmpty(lines[len - 1])) return;
    lines.push("");
  }

  private isMultiline(str: string): boolean {
    if (str.includes("\n")) {
      const line = str.split("\n")[0]!.replace(/[ \t\n\r\0\v]+$/, "");
      for (const pattern of ["{", "["]) {
        if (line.endsWith(pattern)) return true;
      }
    }
    return false;
  }

  private handlePostArgs(str: string, as: unknown, brk: unknown): string {
    if (!phpEmpty(as)) str += ` as $${strval(as)}`;
    if (!phpEmpty(brk)) str += " break";
    return str;
  }

  shouldIgnore(block: KindValue): boolean {
    if (!(block instanceof AssignValue) && !(block instanceof StaticValue)) return false;
    if (this.defaults === null) return false;
    if (this.ignoreBlacklist.includes(block.getName() ?? "")) return false;
    if (block.getName() === "value") return false;
    if (block instanceof AssignValue) {
      if (!phpEmpty(block.getFilter())) return false;
    }
    return Transform.compare(block.getValue(), this.defaults[block.getName() ?? ""] ?? null);
  }
}
