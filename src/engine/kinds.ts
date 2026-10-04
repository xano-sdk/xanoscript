/**
 * The kind classes: ports of redacted (+ redacted),
 * redacted (+ redacted),
 * redacted (+ redacted) and the validation helpers
 * in redacted. A kind knows how to turn one kind-tree node
 * (`{kind, name, value}` or `{kind, args, blocks}`) into a renderable value.
 */
import { script } from "./context.js";
import { AssignValue, SchemaValue, StaticValue, type KindValue } from "./kind-value.js";
import { StdClass, isPhpArray, isScalar, looseEquals, mapperEmpty, values as phpValues } from "./php.js";
import { TaggedValue } from "./values.js";
import { xsGetElementValue, xsIsList } from "./xs-helper.js";
import { parseAssignment, type ParsedParam } from "./xs-param.js";
import { xsParse, type XsSchema } from "./xs-coerce.js";

import { NOT_FOUND } from "./symbols.js";
export { NOT_FOUND };

export interface Kind {
  getKind(): string;
  getLabels(): string[];
  getType(): string;
  getSchemaType(): unknown;
  isNullable(): boolean;
  parse(data: unknown): KindValue;
}

/** Parse a `script_block` value: dispatch on its `kind` to the registered kind. */
function parseBlock(value: unknown): KindValue {
  if (!isPhpArray(value) || Array.isArray(value)) {
    if (Array.isArray(value)) throw new Error("Missing kind, but noticed a numerical array is being used.");
    throw new Error("Missing kind.");
  }
  const kindName = (value as Record<string, unknown>).kind;
  if (!kindName) throw new Error("Missing kind.");
  const kind = script().getKind(String(kindName));
  return kind.parse(value);
}

function enumSchema(kind: string): string {
  return `enum|values(${JSON.stringify([kind])})`;
}

/** `xano\script\kind\Assign` + `assign\Import`. */
export class AssignKind implements Kind {
  constructor(
    private readonly type: string,
    private readonly schema: unknown,
    private readonly nullable: boolean,
    private readonly filter: string,
    private readonly labels: string[],
  ) {}

  getKind(): string {
    return "assign:" + this.type;
  }
  getType(): string {
    return this.type;
  }
  getSchemaType(): unknown {
    return this.schema;
  }
  getFilter(): string {
    return this.filter;
  }
  getLabels(): string[] {
    return this.labels;
  }
  isNullable(): boolean {
    return this.nullable;
  }

  parse(data: unknown): KindValue {
    let schemaKey = "value";
    let schemaType = this.getSchemaType();

    if (isScalar(schemaType) && typeof schemaType === "string" && schemaType.endsWith("[]")) {
      schemaType = schemaType.substring(0, schemaType.length - 2);
      schemaKey += "[]";
    } else if (this.getKind().endsWith("[]")) {
      schemaKey += "[]";
    }

    if (this.isNullable()) schemaKey = "?" + schemaKey;

    const schema: XsSchema = {
      kind: enumSchema(this.getKind()),
      name: "text",
      [schemaKey + "?"]: schemaType,
      "?filter?=null": "text",
    };

    const ret = xsParse(schema, data, { block: parseBlock });
    const d = data as Record<string, unknown>;

    switch (this.getKind()) {
      case "assign:timestamp":
        if (d.value === "now") ret.value = "now";
        break;
      case "assign:object":
      case "static:object":
        if (Array.isArray(ret.value) && ret.value.length === 0) ret.value = new StdClass();
        break;
    }

    return new AssignValue(ret.kind as string, this.getType(), (ret.name as string) ?? null, ret.value, (ret.filter as string | null) ?? null);
  }
}

/** `xano\script\kind\StaticAssign` + `static\Import`. */
export class StaticKind implements Kind {
  constructor(
    protected readonly type: string,
    protected readonly schema: unknown,
    protected readonly labels: string[],
  ) {}

  getKind(): string {
    return "static:" + this.type;
  }
  getType(): string {
    return this.type;
  }
  getSchemaType(): unknown {
    return this.schema;
  }
  getLabels(): string[] {
    return this.labels;
  }
  isNullable(): boolean {
    return false;
  }
  getBlocks(): unknown {
    return [];
  }

  parse(data: unknown): KindValue {
    const d = data as Record<string, unknown>;
    switch (this.getKind()) {
      case "static:object": {
        let input = d;
        if (d.name === "response") {
          if (Array.isArray(d.value) && d.value.length > 1) {
            const kept = d.value.filter((v) => !((v as Record<string, unknown>)?.kind === "assign:var" && !((v as Record<string, unknown>).name)));
            if (kept.length !== d.value.length) input = { ...d, value: kept };
          }
        }
        const ret = xsParse({ kind: enumSchema(this.getKind()), name: "text", "value[]?=[]": "script_block" }, input, { block: parseBlock });
        const vals: Record<string, unknown> = {};
        for (const value of ret.value as KindValue[]) {
          const v = value as AssignValue | StaticValue;
          if (value.getKind() === "assign:expr") vals[String(value.getName())] = new RawFragment(String(v.getValue()));
          else vals[String(value.getName())] = v.getValue();
        }
        const result = new StaticValue(ret.kind as string, this.getType(), ret.name as string, vals, ret.value);
        result.setOriginalBlocks({ name: ret.name, kind: ret.kind, value: d.value });
        return result;
      }
      case "static:object[]": {
        const ret = xsParse({ kind: enumSchema(this.getKind()), name: "text", "value[][]?=[]": "script_block" }, d, { block: parseBlock });
        const vals: Array<Record<string, unknown>> = [];
        for (const value1 of ret.value as KindValue[][]) {
          const values1: Record<string, unknown> = {};
          for (const value2 of value1) values1[String(value2.getName())] = (value2 as AssignValue | StaticValue).getValue();
          vals.push(values1);
        }
        const result = new StaticValue(ret.kind as string, this.getType(), ret.name as string, vals, ret.value);
        result.setOriginalBlocks({ name: ret.name, kind: ret.kind, value: d.value });
        return result;
      }
      default: {
        let schemaType = this.getSchemaType();
        let schemaKey = "value";
        const origSchemaKey = schemaKey;
        if (isScalar(schemaType) && typeof schemaType === "string" && schemaType.endsWith("[]")) {
          schemaType = schemaType.substring(0, schemaType.length - 2);
          schemaKey += "[]";
        } else if (this.getKind().endsWith("[]")) {
          schemaKey += "[]";
        }
        const ret = xsParse({ kind: enumSchema(this.getKind()), name: "text", [schemaKey + "?"]: schemaType, "filter?": "text" }, d, { block: parseBlock });
        return new StaticValue(ret.kind as string, this.getType(), ret.name as string, ret[origSchemaKey] ?? "", null, (ret.filter as string) ?? "");
      }
    }
  }
}

/** A marker for an `assign:expr` child of a static object (PHP wraps it in RawValue). */
import { RawValue as RawFragment } from "./values.js";

/** `static\ImportObject`: validate a `static:object` block's children against a block schema. */
export class StaticObjectKind extends StaticKind {
  constructor(type: string, schema: unknown, labels: string[], private readonly blocks: Record<string, unknown>) {
    super(type, schema, labels);
  }

  override getBlocks(): Record<string, unknown> {
    return this.blocks;
  }

  override parse(data: unknown): KindValue {
    const d = data as Record<string, unknown>;
    const ret = xsParse({ kind: enumSchema(this.getKind()), name: "text", "value[]?=[]": "script_block" }, d, { block: parseBlock });
    const blocks = this.getBlocks();
    const listHash: Record<string, boolean> = {};
    const parsed = ret.value as KindValue[];

    for (const [rBlockName, rBlockValues] of Object.entries(blocks)) {
      if (/^\d+$/.test(rBlockName)) {
        KindHelper.enforceBlockSchema(rBlockValues, parsed);
      } else {
        const param = parseAssignment(rBlockName);
        if (xsIsList(param.wrap)) listHash[param.name] = true;
        KindHelper.enforceBlockAssign(param, rBlockValues, parsed, listHash[param.name] ?? false, (d.blocks as unknown[]) ?? null);
      }
    }

    const hash2: Record<string, boolean> = {};
    for (const block of parsed) {
      const name = block.getName();
      if (name !== null) {
        const elValue = xsGetElementValue(name, blocks, NOT_FOUND);
        if (elValue === NOT_FOUND) throw new Error("Invalid block: " + name);
        KindHelper.enforceKind(name, elValue, block);
      }
      const key = name ?? block.getType();
      if (hash2[key]) {
        if (!listHash[key]) throw new Error("Duplicate entry: " + key);
      } else {
        hash2[key] = true;
      }
    }

    return new StaticValue(ret.kind as string, this.getType(), ret.name as string, null);
  }
}

/** `static\ImportObjectList`: validate every entry of a `static:object[]` block. */
export class StaticObjectListKind extends StaticKind {
  constructor(type: string, schema: unknown, labels: string[], private readonly blocks: Record<string, unknown>) {
    super(type, schema, labels);
  }

  override getBlocks(): Record<string, unknown> {
    return this.blocks;
  }

  override parse(data: unknown): KindValue {
    const d = data as Record<string, unknown>;
    const ret = xsParse({ kind: enumSchema(this.getKind()), name: "text", "value[][]?=[]": "script_block" }, d, { block: parseBlock });
    const blocks = this.getBlocks();
    const listHash: Record<string, boolean> = {};

    (ret.value as KindValue[][]).forEach((parseValues, k) => {
      for (const [rBlockName, rBlockValues] of Object.entries(blocks)) {
        if (/^\d+$/.test(rBlockName)) {
          KindHelper.enforceBlockSchema(rBlockValues, parseValues);
        } else {
          const param = parseAssignment(rBlockName);
          if (xsIsList(param.wrap)) listHash[param.name] = true;
          const raw = Array.isArray(d.value) ? (d.value[k] as unknown[]) : null;
          KindHelper.enforceBlockAssign(param, rBlockValues, parseValues, listHash[param.name] ?? false, raw ?? null);
        }
      }

      const hash2: Record<string, boolean> = {};
      for (const block of parseValues) {
        const name = block.getName();
        if (name !== null) {
          const elValue = xsGetElementValue(name, blocks, NOT_FOUND);
          if (elValue === NOT_FOUND) throw new Error("Invalid block: " + name);
          KindHelper.enforceKind(name, elValue, block);
        }
        const key = name ?? block.getType();
        if (hash2[key]) {
          if (!listHash[key]) throw new Error("Duplicate entry: " + key);
        } else {
          hash2[key] = true;
        }
      }
    });

    return new StaticValue(ret.kind as string, this.getType(), ret.name as string, null);
  }
}

export interface SchemaKindOptions {
  type: string;
  schema: unknown;
  args: unknown;
  blocks: unknown;
  labels: string[];
  repeating: unknown;
  repeating_blocks: unknown[];
  repeating_assignments: Record<string, unknown>;
  transform: unknown;
  alias: string | null;
  ignoreDefaults: unknown;
  force_expanded: boolean;
  ignoreBlacklist: string[];
  argNameIsVar: boolean;
  breadcrumb: unknown;
}

/** `xano\script\kind\Schema` + `schema\Import`. */
export class SchemaKind implements Kind {
  private processedArgs: Record<string, unknown> | null = null;
  private processedBlocks: unknown = null;

  constructor(private readonly o: SchemaKindOptions) {}

  getKind(): string {
    return "schema:" + this.o.type;
  }
  getType(): string {
    return this.o.type;
  }
  getSchemaType(): unknown {
    return this.o.schema;
  }
  getLabels(): string[] {
    return this.o.labels;
  }
  isNullable(): boolean {
    return false;
  }
  getAlias(): string | null {
    return this.o.alias;
  }
  getBreadcrumb(): unknown {
    return this.o.breadcrumb;
  }
  getTransform(): unknown {
    return this.o.transform;
  }
  isRepeating(): boolean {
    return Boolean(this.o.repeating);
  }
  isRepeatingUnique(): boolean {
    return this.o.repeating === "unique";
  }
  getRepeatingBlocks(): unknown[] {
    return this.o.repeating_blocks;
  }
  getRepeatingAssignments(): Record<string, unknown> {
    return this.o.repeating_assignments;
  }
  isForceExpanded(): boolean {
    return Boolean(this.o.force_expanded);
  }
  getIgnoreBlacklist(): string[] {
    return this.o.ignoreBlacklist;
  }
  isArgNameVar(): boolean {
    return this.o.argNameIsVar;
  }
  shouldIgnoreInvalidBlocks(): boolean {
    return false;
  }

  processDefaults(defaults: Record<string, unknown>): Record<string, unknown> | null {
    const ignore = this.o.ignoreDefaults;
    if (!ignore || (Array.isArray(ignore) && ignore.length === 0)) return null;
    if (Array.isArray(ignore)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(defaults)) {
        if (ignore.includes(key)) out[key] = value;
      }
      return out;
    }
    return defaults;
  }

  getArgs(): Record<string, unknown> {
    if (this.processedArgs === null) this.processedArgs = this.processArgs(this.o.args);
    return this.processedArgs;
  }

  getBlocks(): unknown {
    if (this.processedBlocks === null) this.processedBlocks = this.processBlocks(this.o.blocks);
    return this.processedBlocks;
  }

  private processArgs(data: unknown): Record<string, unknown> {
    if (Array.isArray(data)) {
      const out: Record<string, unknown> = {};
      for (const item of data) out[String(item)] = "text";
      return out;
    }
    if (isPhpArray(data)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (v instanceof TaggedValue) {
          if (v.getTag() !== "kinds") throw new Error("Invalid tag.");
          let value = v.getValue();
          if (!Array.isArray(value)) value = [value];
          out[k] = script().getKinds(value as string[]);
        } else {
          out[k] = v;
        }
      }
      return out;
    }
    return {};
  }

  private processBlocks(data: unknown): unknown {
    if (Array.isArray(data)) {
      const out = data.map((v) => this.processBlocks(v));
      return phpValues(out).flatMap((v) => (Array.isArray(v) ? flattenValues(v) : [v]));
    }
    if (isPhpArray(data)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = this.processBlocks(v);
      return out;
    }
    if (data instanceof TaggedValue) {
      switch (data.getTag()) {
        case "static:enum":
          if (!Array.isArray(data.getValue())) throw new Error("Invalid data for static:enum");
          return data;
        case "kinds": {
          let value = data.getValue();
          if (!Array.isArray(value)) value = [value];
          return script().getKinds(value as string[]);
        }
        case "static:map":
        case "static:object":
        case "static:objects":
        case "static:object[]":
          return data;
        default:
          throw new Error("Invalid tag.");
      }
    }
    return data;
  }

  parse(data: unknown): KindValue {
    const ret = xsParse(
      { kind: enumSchema(this.getKind()), "name?": "text", "args[]?=[]": "script_block", "blocks[]?=[]": "script_block" },
      data,
      { block: parseBlock },
    );
    const d = data as Record<string, unknown>;
    const unknownComments: unknown[] = [];

    const args = this.getArgs();
    let listHash: Record<string, boolean> = {};
    const parsedArgs = ret.args as KindValue[];
    for (const [rArgName, rArgValues] of Object.entries(args)) {
      const param = parseAssignment(rArgName);
      if (xsIsList(param.wrap)) listHash[param.name] = true;
      KindHelper.enforceBlockAssign(param, rArgValues, parsedArgs, listHash[param.name] ?? false, (d.args as unknown[]) ?? []);
    }

    for (const arg of parsedArgs) {
      const name = arg.getName();
      if (name !== null && !xsHasElementName(name, args)) throw new Error("Invalid arg: " + name);
    }

    const blocks = this.getBlocks();
    const defaults: Record<string, unknown> = {};
    listHash = {};
    let parsedBlocks = ret.blocks as KindValue[];

    if (this.isRepeating()) {
      if (!mapperEmpty(blocks)) {
        const names: unknown[] = [];
        const kept: KindValue[] = [];
        const blockKinds = Array.isArray(blocks) ? (blocks as string[]) : [];
        outer: for (const block of parsedBlocks) {
          if (!blockKinds.includes(block.getKind())) {
            for (const [assignName, assignKind] of Object.entries(this.getRepeatingAssignments())) {
              if (block.getKind() === assignKind && block.getName() === assignName) {
                kept.push(block);
                continue outer;
              }
            }
            if (block.getKind() === "static:text" && ["unknown:comment", "description"].includes(block.getName() ?? "")) {
              unknownComments.push((block as StaticValue).getValue());
              continue;
            }
            throw new Error("Invalid repeating block2: " + block.getKind());
          }
          if (this.isRepeatingUnique() && block instanceof SchemaValue) {
            let dup = false;
            for (const blockArg of block.getArgs()) {
              if (blockArg.getName() === "name") {
                const v = (blockArg as AssignValue | StaticValue).getValue();
                if (names.includes(v)) {
                  dup = true;
                  break;
                }
                names.push(v);
              }
            }
            if (dup) continue;
          }
          kept.push(block);
        }
        parsedBlocks = kept;
      }
    } else {
      const blockMap = (blocks ?? {}) as Record<string, unknown>;
      for (const [rBlockName, rBlockValues] of Object.entries(blockMap)) {
        if (/^\d+$/.test(rBlockName)) {
          KindHelper.enforceBlockSchema(rBlockValues, parsedBlocks);
        } else {
          const param = parseAssignment(rBlockName);
          defaults[param.name] = param.default ?? null;
          if (xsIsList(param.wrap)) listHash[param.name] = true;
          KindHelper.enforceBlockAssign(param, rBlockValues, parsedBlocks, listHash[param.name] ?? false, (d.blocks as unknown[]) ?? null);
        }
      }

      const hash2: Record<string, boolean> = {};
      const kept: KindValue[] = [];
      for (const block of parsedBlocks) {
        const name = block.getName();
        if (name !== null) {
          const elValue = xsGetElementValue(name, blockMap, NOT_FOUND);
          if (elValue === NOT_FOUND) {
            if (this.shouldIgnoreInvalidBlocks()) continue;
            throw new Error("Invalid block: " + name);
          }
          KindHelper.enforceKind(name, elValue, block);
        }
        const key = name ?? block.getType();
        if (hash2[key]) {
          if (!listHash[key]) {
            const repeatingBlocks = this.getRepeatingBlocks();
            if (!repeatingBlocks.includes(key)) {
              const parts = key.split(".");
              if (!repeatingBlocks.includes(parts[0])) throw new Error("Duplicate entry: " + key);
            }
          }
        } else {
          hash2[key] = true;
        }
        kept.push(block);
      }
      parsedBlocks = kept;
    }

    const name = (ret.name as string | undefined) ?? null;

    return new SchemaValue(
      ret.kind as string,
      name,
      this.getType(),
      parsedArgs,
      parsedBlocks,
      this.getLabels(),
      this.processDefaults(defaults),
      this.isForceExpanded(),
      this.getIgnoreBlacklist(),
      this.isArgNameVar(),
      unknownComments,
    );
  }
}

function flattenValues(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const it of items) {
    if (Array.isArray(it)) out.push(...flattenValues(it));
    else out.push(it);
  }
  return out;
}

function xsHasElementName(name: string, schema: Record<string, unknown>): boolean {
  for (const key of Object.keys(schema)) {
    if (parseAssignment(key).name === name) return true;
  }
  return false;
}

/** redacted. */
export const KindHelper = {
  filterKind(a: unknown): unknown {
    switch (a) {
      case "static:external_classic":
        return "static:object";
      case "static:objects":
        return "static:object[]";
      case "static:external_simple":
        return "static:object";
      case "static:enum":
        return "static:text";
      default:
        return a;
    }
  },

  safeString(v: unknown): string {
    if (v !== null && typeof v === "object") return JSON.stringify(v);
    return String(v);
  },

  enforceKindCompatibility(aIn: unknown, bIn: unknown): void {
    const a = KindHelper.filterKind(aIn);
    const b = KindHelper.filterKind(bIn);
    if (!KindHelper.matchKind(a, [b]) && !KindHelper.matchKind(b, [a])) {
      if (typeof a === "string" && a.endsWith("[]") && b === "static:array") return;
      if (typeof b === "string" && b.endsWith("[]") && a === "static:array") return;
      throw new Error(`Invalid kind. Expecting ${KindHelper.safeString(a)}, got ${KindHelper.safeString(b)}`);
    }
  },

  matchKind(kind: unknown, kinds: unknown[]): boolean {
    if (kind === "static:json") return true;
    if (kinds.includes("static:json")) return true;
    if (kinds.some((k) => looseEquals(k, kind))) return true;
    if (kind === "static:array") {
      for (const k of kinds) {
        if (typeof k === "string" && k.endsWith("[]")) return true;
      }
    }
    if (typeof kind !== "string") return false;
    const parts = kind.split(":");
    if (parts[0] === "static") {
      parts[0] = "assign";
      if (kinds.includes(parts.join(":"))) return true;
    }
    return false;
  },

  enforceBlockAssign(param: ParsedParam, kindsIn: unknown, blocks: KindValue[], list: boolean, rawBlocks: unknown[] | null): void {
    for (let k = 0; k < blocks.length; k++) {
      const block = blocks[k]!;
      if (param.name !== (block.getName() ?? block.getType())) continue;

      let kinds = kindsIn;
      if (kinds === null || kinds === undefined) return;
      if (isScalar(kinds)) {
        if (KindHelper.matchKind(block.getKind(), [kinds])) {
          if (block instanceof StaticValue) {
            if (param.required) {
              if (block.getValue() === "") throw new Error("Missing block1: " + param.name);
            }
          }
          return;
        }
      }

      if (kinds instanceof TaggedValue) {
        const kindTag = kinds.getTag();
        KindHelper.enforceKindCompatibility(kindTag, block.getKind());
        kinds = kinds.getValue();
        switch (kindTag) {
          case "static:enum":
            if ((kinds as unknown[]).includes((block as StaticValue).getValue())) return;
            throw new Error(`Invalid value for ${block.getName()}: ${String((block as StaticValue).getValue())}`);
        }
      }

      if (kinds === "static:json") return;

      let myKinds: unknown = kinds;
      if (kinds === "static:external_simple" || kinds === "static:external_classic") myKinds = ["static:object"];

      if (isPhpArray(myKinds)) {
        const kindList = Array.isArray(myKinds) ? myKinds : Object.values(myKinds as object);
        if (KindHelper.matchKind(block.getKind(), kindList)) return;

        switch (block.getKind()) {
          case "static:array":
            return;
          case "static:object": {
            const importer = new StaticObjectKind(block.getType(), "any", [], myKinds as Record<string, unknown>);
            importer.parse(rawBlocks?.[k] ?? (block as StaticValue).getOriginalBlocks());
            return;
          }
          case "static:objects":
          case "static:object[]": {
            const importer = new StaticObjectListKind(block.getType(), "any", [], myKinds as Record<string, unknown>);
            importer.parse(rawBlocks?.[k] ?? (block as StaticValue).getOriginalBlocks());
            return;
          }
          case "assign:object":
            if (!list) {
              const schema = KindHelper.getSchemaFromObject(myKinds as Record<string, unknown>);
              const value = xsParse(schema, (block as AssignValue).getValue());
              (block as AssignValue).setValue(value);
              if (isPhpArray(value) && !Array.isArray(value)) return;
            }
            break;
          case "assign:object[]":
            if (list) {
              const schema = KindHelper.getSchemaFromObject(myKinds as Record<string, unknown>);
              const raw = (block as AssignValue).getValue();
              const value = Array.isArray(raw) ? raw.map((v) => xsParse(schema, v)) : raw;
              (block as AssignValue).setValue(value);
              if (Array.isArray(value)) return;
            }
            break;
        }
      }

      throw new Error(`Invalid kind for ${param.name} - ${block.getKind()}`);
    }

    if (!param.required) return;
    throw new Error("Missing block: " + param.name);
  },

  getSchemaFromObject(schema: Record<string, unknown>): XsSchema {
    const ret: XsSchema = {};
    for (const [k, v] of Object.entries(schema)) {
      if (isScalar(v)) {
        const kind = script().getKind(String(v));
        ret[k] = kind.getSchemaType();
      } else if (v instanceof TaggedValue) {
        ret[k] = "any";
      } else {
        ret[k] = KindHelper.getSchemaFromObject(v as Record<string, unknown>);
      }
    }
    return ret;
  },

  enforceBlockSchema(kind: unknown, blocks: KindValue[]): void {
    for (const block of blocks) {
      if (block instanceof SchemaValue) {
        if (kind === block.getKind()) return;
      }
    }
    throw new Error("Missing block3: " + String(kind));
  },

  enforceKind(name: string, elValueIn: unknown, block: KindValue): void {
    let elValue = elValueIn;
    if (elValue instanceof TaggedValue) {
      elValue = elValue.getTag();
      if (elValue === "static:objects") elValue = "static:object[]";
    }

    if (isPhpArray(elValue)) {
      if (Array.isArray(elValue)) {
        if (KindHelper.matchKind(block.getKind(), elValue)) return;
        throw new Error("Invalid kind for block: " + name);
      }
      if (["static:object", "static:object[]"].includes(block.getKind())) return;
    }

    KindHelper.enforceKindCompatibility(elValue, block.getKind());
  },
};
