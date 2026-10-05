/**
 * Port of redacted — the expression-engine tokenizer the encoder uses
 * to classify a `const:expr` string (legacy? ternary? bare string node?) when
 * deciding whether to wrap it in backticks. Only `parse`/`fastParse` in
 * `node`/`tenary`/`array`/`object`/`pipes` modes and `peek` are needed.
 *
 * The stack it produces is the engine's own shape: items like
 * `{ node: value, pipes: [] }`, `{ group: [...], pipes: [] }`,
 * `{ array: [...], pipes: [] }`, `{ object: [...], pipes: [] }`,
 * `{ tenary: {left, right}, pipes: [] }`, `{ pipe: name, args: [] }`,
 * `{ "arg:entry": [...], args: [] }`, optionally with `hint`/`spread`.
 */
import { ctypeAlpha, ctypeDigit, ctypeSpace, isNumeric, isScalar, mbStrlen, mbSubstr, trim } from "./php.js";
import { Parser as ScriptParser } from "./parser.js";

const BACKSLASH = "\\";
const QUOTE = '"';
const SINGLE = "'";
const TICK = "`";

export type XtItem = Record<string, any>;

export class ParsedResult {
  constructor(private readonly result: { charCnt: number; select: unknown; stack: XtItem[] }, private readonly legacy = false) {}
  isLegacy(): boolean {
    return this.legacy;
  }
  getSelect(): unknown {
    return this.result.select;
  }
  getStack(): XtItem[] {
    return this.result.stack;
  }
  getCharCnt(): number {
    return this.result.charCnt;
  }
}

const PIPE_TYPES = new Set(["node", "array", "array:entry", "object", "object:entry", "group", "tenary"]);

function create(type: string, value: unknown, args: XtItem[] = [], hint = "any", spread = false): XtItem {
  const ret: XtItem = { [type]: value, [PIPE_TYPES.has(type) ? "pipes" : "args"]: args };
  if (hint !== "any") ret.hint = hint;
  if (spread) ret.spread = true;
  return ret;
}

class XtParser {
  select: unknown = "";
  entry = "";
  mode = "select";
  stack: XtItem[] = [];
  arrayTempStack: XtItem[] = [];
  argTempStack: XtItem[] = [];
  objectDirection: "left" | "right" = "left";
  objectLeftTempStack: XtItem[] = [];
  objectRightTempStack: XtItem[] = [];
  tenaryDirection: "left" | "right" = "left";
  tenaryLeftTempStack: XtItem[] = [];
  tenaryRightTempStack: XtItem[] = [];
  autoGroup = false;
  hint = "any";
  spread = false;
  lastMode = "";
  breadcrumb: (number | string)[] = [];

  private pushBreadcrumb(v: number | string): void {
    this.breadcrumb.push(v);
  }

  private popBreadcrumb(): void {
    this.breadcrumb.pop();
  }

  addChar(ch: string): void {
    this.entry += ch;
  }

  rewindChar(): void {
    this.entry = mbSubstr(this.entry, 0, -1);
  }

  /** Resolve the breadcrumb path to the live array it points at. */
  getActiveStack(): XtItem[] {
    let stack: any = this.stack;
    for (const crumb of this.breadcrumb) {
      if (stack[crumb] === undefined) stack[crumb] = [];
      stack = stack[crumb];
    }
    return stack as XtItem[];
  }

  private consumeEntry(): { entry: unknown; raw: string; hint: string; spread: boolean } {
    const raw = this.entry;
    let entry: unknown = trim(this.entry);

    if (this.hint === "any") {
      if (entry === "true") entry = true;
      else if (entry === "false") entry = false;
      else if (entry === "null") entry = null;
      else if (typeof entry === "string" && ctypeDigit(entry)) entry = parseInt(entry, 10);
      else if (typeof entry === "string" && isNumeric(entry)) entry = Number(entry);
    }

    const hint = this.hint;
    const spread = this.spread;
    this.hint = "any";
    this.entry = "";
    this.spread = false;

    return { entry, raw, hint, spread };
  }

  private processAutoGroup(): void {
    if (this.autoGroup) {
      this.autoGroup = false;
      const stack = this.isArgsMode() ? this.argTempStack : this.getActiveStack();
      const group = stack.splice(-3);
      stack.push(create("group", group));
    }
  }

  addItem(emptyOk = false, pushTemp = false): void {
    const { entry: rawEntry, raw, hint, spread } = this.consumeEntry();
    let entry = rawEntry;

    let force = false;
    if (hint === "text") {
      entry = raw;
      force = true;
    } else if (typeof raw === "string" && entry === null) {
      force = true;
    } else if (typeof entry === "boolean") {
      force = true;
    }

    if (entry === "" && !emptyOk && !force) return;

    this.lastMode = this.mode;

    const nonEmptyScalar = (isScalar(entry) && mbStrlen(String(entry)) > 0) || force;

    switch (this.mode) {
      case "select":
        this.select = entry;
        break;
      case "node": {
        const stack = this.getActiveStack();
        if (nonEmptyScalar) {
          stack.push(create("node", entry, [], hint, spread));
          this.processAutoGroup();
        }
        break;
      }
      case "array":
        if (nonEmptyScalar) {
          this.addArrayItem(create("node", entry, [], hint), pushTemp, spread);
        }
        break;
      case "object":
        if (nonEmptyScalar) {
          this.addObjectItem(create("node", entry, [], hint), pushTemp, spread);
        }
        break;
      case "tenary":
        if (nonEmptyScalar) {
          this.addTenaryItem(create("node", entry, [], hint), pushTemp);
        }
        break;
      case "pipes": {
        const stack = this.getActiveStack();
        stack.push(create("pipe", entry));
        break;
      }
      case "args":
        this.argTempStack.push(create("node", entry, [], hint));
        if (pushTemp) this.cleanupArgs();
        break;
      default:
        throw new Error("Invalid mode.");
    }
  }

  private addTenaryItem(entry: XtItem, pushTemp = false): void {
    switch (this.tenaryDirection) {
      case "left":
        this.tenaryLeftTempStack.push(entry);
        break;
      case "right":
        this.tenaryRightTempStack.push(entry);
        if (pushTemp) this.cleanupTenary();
        break;
    }
  }

  private addObjectItem(entry: XtItem, pushTemp = false, spread = false): void {
    switch (this.objectDirection) {
      case "left":
        this.objectLeftTempStack.push(entry);
        break;
      case "right":
        this.objectRightTempStack.push(entry);
        if (pushTemp) this.cleanupObject(true, spread);
        break;
    }
  }

  private addArrayItem(entry: XtItem, pushTemp = false, spread = false): void {
    this.arrayTempStack.push(entry);
    if (pushTemp) this.cleanupArray(true, spread);
  }

  addOperator(op: string, changeMode = true): void {
    if (changeMode) this.setNodeMode();
    this.addItem();
    this.entry = op;
    this.addItem();
    if (op === "*" || op === "/") this.autoGroup = true;
  }

  addGroup(stackItems: XtItem[]): void {
    if (this.isPipesMode()) throw new Error("Invalid syntax. Please use filter:arg1:argN");

    if (this.isArgsMode()) {
      this.argTempStack.push(create("group", stackItems));
    } else if (this.isTenaryMode()) {
      this.addTenaryItem(create("group", stackItems));
    } else if (this.isObjectMode()) {
      this.addObjectItem(create("group", stackItems), this.spread, this.spread);
      this.spread = false;
    } else if (this.isArrayMode()) {
      this.addArrayItem(create("group", stackItems), true, this.spread);
      this.spread = false;
    } else {
      this.getActiveStack().push(create("group", stackItems));
    }
    this.processAutoGroup();
  }

  addArray(stackItems: XtItem[]): void {
    if (this.isArgsMode()) {
      this.argTempStack.push(create("array", stackItems));
    } else {
      const stack = this.getActiveStack();
      if (this.isTenaryMode()) {
        this.addTenaryItem(create("array", stackItems, [], "any", this.spread), true);
        this.spread = false;
      } else if (this.isObjectMode()) {
        this.addObjectItem(create("array", stackItems), this.spread, this.spread);
        this.spread = false;
      } else if (this.isArrayMode()) {
        this.addArrayItem(create("array", stackItems), true, this.spread);
        this.spread = false;
      } else {
        stack.push(create("array", stackItems));
      }
    }
    this.processAutoGroup();
  }

  addObject(stackItems: XtItem[]): void {
    const item = create("object", stackItems);
    if (this.isArgsMode()) {
      this.argTempStack.push(item);
    } else {
      if (this.isTenaryMode()) {
        this.addTenaryItem(item);
      } else if (this.isArrayMode()) {
        this.addArrayItem(item, true, this.spread);
        this.spread = false;
      } else if (this.isObjectMode()) {
        this.addObjectItem(item, true, this.spread);
        this.spread = false;
      } else {
        this.getActiveStack().push(item);
      }
    }
    this.processAutoGroup();
  }

  addTenary(tenary: XtItem): void {
    if (this.isArgsMode()) {
      this.argTempStack.push(tenary);
    } else if (this.isObjectMode()) {
      this.addObjectItem(tenary, true, this.spread);
      this.spread = false;
    } else {
      if (this.isPipesMode()) {
        throw new Error("Invalid syntax. Please wrap your filter with parentheses.");
      }
      this.getActiveStack().push(tenary);
    }
    this.processAutoGroup();
  }

  addPipes(pipes: XtItem[]): void {
    for (const pipe of pipes) {
      if (!("pipe" in pipe)) throw new Error("Invalid syntax. Please wrap your filter with parentheses.");
    }

    let stack: XtItem[];
    switch (this.mode) {
      case "array":
        stack = this.arrayTempStack;
        break;
      case "node":
        stack = this.getActiveStack();
        break;
      case "object":
        stack = this.objectDirection === "left" ? this.objectLeftTempStack : this.objectRightTempStack;
        break;
      case "tenary":
        throw new Error("Invalid syntax. When using tenary expressions with filters, make sure to wrap them with parentheses.");
      default:
        throw new Error("TODO: Implement addPipes. " + this.mode);
    }

    if (stack.length === 0) {
      stack.push(create("node", null));
    }

    const last = stack[stack.length - 1]!;
    last.pipes = [...(last.pipes ?? []), ...pipes];
  }

  isEmpty(): boolean {
    return trim(this.entry) === "" || trim(this.entry) === "0";
  }

  cleanupArgs(force = true): void {
    if (this.argTempStack.length > 0 || force) {
      this.getActiveStack().push(create("arg:entry", this.argTempStack));
      this.argTempStack = [];
    }
  }

  cleanupObject(force = true, spread = false): void {
    if (this.objectLeftTempStack.length > 0 || force) {
      this.getActiveStack().push(
        create("object:entry", { left: this.objectLeftTempStack, right: this.objectRightTempStack }, [], "any", spread),
      );
      this.objectRightTempStack = [];
      this.objectLeftTempStack = [];
      this.objectDirection = "left";
    }
  }

  cleanupTenary(force = true): void {
    if (this.tenaryLeftTempStack.length > 0 || force) {
      this.getActiveStack().push(create("tenary", { left: this.tenaryLeftTempStack, right: this.tenaryRightTempStack }));
      this.tenaryRightTempStack = [];
      this.tenaryLeftTempStack = [];
      this.tenaryDirection = "left";
    }
  }

  cleanupArray(force = true, spread = false): void {
    if (this.arrayTempStack.length > 0 || force) {
      this.getActiveStack().push(create("array:entry", this.arrayTempStack, [], "any", spread));
      this.arrayTempStack = [];
    }
  }

  isSelectMode(): boolean {
    return this.mode === "select";
  }
  isNodeMode(): boolean {
    return this.mode === "node";
  }
  isArrayMode(): boolean {
    return this.mode === "array";
  }
  isObjectMode(): boolean {
    return this.mode === "object";
  }
  isArgsMode(): boolean {
    return this.mode === "args";
  }
  isPipesMode(): boolean {
    return this.mode === "pipes";
  }
  isTenaryMode(): boolean {
    return this.mode === "tenary";
  }

  setArgsMode(): void {
    if (this.mode !== "args") {
      const stack = this.getActiveStack();
      this.pushBreadcrumb(stack.length - 1);
      this.pushBreadcrumb("args");
    }
    this.mode = "args";
  }

  setNodeMode(): void {
    this.mode = "node";
    this.cleanupArgs(false);
  }

  setTenaryMode(): void {
    this.mode = "tenary";
    this.cleanupArgs(false);
  }

  setArrayMode(): void {
    this.mode = "array";
    this.cleanupArgs(false);
  }

  setObjectMode(): void {
    this.mode = "object";
    this.cleanupArgs(false);
  }

  setPipesMode(breadcrumb = true): void {
    this.cleanupArgs(false);
    this.cleanupArray(false);
    this.cleanupObject(false);

    if (this.mode === "args" || this.mode === "node") {
      this.popBreadcrumb();
      this.popBreadcrumb();
      this.popBreadcrumb();
      this.popBreadcrumb();
    }

    if (this.mode !== "pipes") {
      if (breadcrumb) {
        const stack = this.getActiveStack();
        if (stack.length === 0) {
          stack.push(create("node", null));
        }
        this.pushBreadcrumb(stack.length - 1);
        this.pushBreadcrumb("pipes");
      }
    }
    this.mode = "pipes";
  }

  finalize(): void {
    this.addItem(false, true);
    this.cleanupArgs(false);
    this.cleanupArray(false);
    this.cleanupObject(false);
    this.cleanupTenary(false);
  }

  getStack(): XtItem[] {
    return this.stack;
  }
}

function isNotEscapeSequence(lastCh: string | false, last2Ch: string | false): boolean {
  return lastCh !== "\\" || (lastCh === "\\" && last2Ch === "\\");
}

const COMPARE_OPS = [
  "@>", ">=", "<=", ">", "<", "~", "!~", "!==", "!=", "===", "==", "?:", "??", "%",
  "includes", "not includes", "contains", "not contains", "in", "not in", "overlaps", "not overlaps",
  "ilike", "not ilike", "between", "not between", "search",
];

const parseCache = new Map<string, ParsedResult>();

export function xtFastParse(str: string, type = ""): ParsedResult {
  const key = type + "\u0000" + str;
  const cached = parseCache.get(key);
  if (cached) return cached;
  const ret = xtParse(str, type);
  if (parseCache.size > 5000) parseCache.clear();
  parseCache.set(key, ret);
  return ret;
}

export function xtParse(str: string, type = ""): ParsedResult {
  const len = str.length;
  let quoteMode: string | false = false;
  let legacy = false;

  const parser = new XtParser();
  switch (type) {
    case "node": parser.setNodeMode(); break;
    case "tenary": parser.setTenaryMode(); break;
    case "array": parser.setArrayMode(); break;
    case "object": parser.setObjectMode(); break;
    case "pipes": parser.setPipesMode(false); break;
  }

  let skipEmpty = true;
  let ch: string | false = false;
  let lastCh: string | false = false;
  let lastCh2: string | false = false;
  let i = 0;

  outer: for (i = 0; i < len; i++) {
    if (quoteMode && ch === BACKSLASH && lastCh === BACKSLASH && lastCh2 === BACKSLASH) {
      lastCh = false;
    }
    lastCh2 = lastCh;
    lastCh = ch;
    ch = str[i]!;

    if (skipEmpty) {
      if (ctypeSpace(ch) || ch.length > 1) continue;
      skipEmpty = false;
    }

    switch (ch) {
      case "\\":
        break;
      case QUOTE:
      case SINGLE:
      case TICK:
        if (!parser.isSelectMode()) {
          if (!quoteMode) {
            const nextCnt = 2;
            let find = ch.repeat(nextCnt);
            if (str.substring(i + 1, i + 1 + nextCnt) === find) {
              find += ch;
              parser.addChar(find);
              const advance = nextCnt + 1;
              i += advance;

              const ret = str.indexOf(find, i);
              const next = str.substring(i, ret + advance);
              parser.addChar(next);
              i += next.length - 1;
              parser.addItem();
              continue outer;
            }

            quoteMode = ch;
            if (ch !== TICK) parser.hint = "text";
            parser.entry = "";
          } else {
            if (quoteMode === ch) {
              if (isNotEscapeSequence(lastCh, lastCh2)) {
                parser.entry = ScriptParser.stripQuotes(quoteMode + parser.entry + quoteMode, quoteMode as any);
                quoteMode = false;
                parser.addItem(true);
              } else {
                if (!(lastCh === BACKSLASH && !lastCh2)) {
                  parser.rewindChar();
                }
                break;
              }
            } else {
              break;
            }
          }
          continue outer;
        }
        break;
      case ".":
        if (!quoteMode) {
          for (const op of ["..."]) {
            if (peek(str, i, op.length) === op) {
              i += op.length - 1;
              ch = op[op.length - 1]!;
              if (parser.isObjectMode()) {
                parser.addChar(op);
                parser.addItem();
                parser.spread = true;
                parser.objectDirection = "right";
              } else if (parser.isArrayMode()) {
                parser.spread = true;
              }
              continue outer;
            }
          }

          if (!parser.isSelectMode()) {
            for (const op of [".."]) {
              if (peek(str, i, op.length) === op) {
                i += op.length - 1;
                ch = op[op.length - 1]!;
                parser.addOperator(op);
                continue outer;
              }
            }
          }

          if (parser.entry === "" && parser.mode === "node" && parser.hint === "any") {
            continue outer;
          }
        }
        break;
      case "=":
      case "~":
      case "!":
      case "<":
      case ">":
      case "+":
      case "-":
      case "*":
      case "?":
      case "/":
      case "%":
      case "@":
      case "c":
      case "n":
      case "o":
      case "s":
      case "i":
        if (!quoteMode) {
          const isBeginningOfPipe =
            ctypeAlpha(ch) ||
            (ch === "!" &&
              ctypeAlpha(peek(str, i + 1) ?? "") &&
              "true" !== peek(str, i + 1, 4) &&
              "false" !== peek(str, i + 1, 5) &&
              "null" !== peek(str, i + 1, 4));
          if (!isBeginningOfPipe && parser.isPipesMode()) {
            throw new Error("Invalid syntax. Please wrap your filter with parentheses.");
          }

          for (const baseOp of COMPARE_OPS) {
            for (const op of [baseOp + "?", baseOp]) {
              const doTrim = !ctypeAlpha(op[0]!);
              const filteredOp = !doTrim ? op + " " : op;
              if (
                peek(str, i, filteredOp.length, doTrim) === filteredOp &&
                (!isBeginningOfPipe || (isBeginningOfPipe && parser.entry !== parser.entry.replace(/[ \t\n\r\0\v]+$/, "")))
              ) {
                i += op.length - 1;
                ch = op[op.length - 1]!;
                if (parser.isSelectMode()) {
                  parser.addChar(op);
                } else {
                  parser.addOperator(op, !parser.isArrayMode() && !parser.isObjectMode() && !parser.isArgsMode() && !parser.isTenaryMode());
                }
                continue outer;
              }
            }
          }

          if (isBeginningOfPipe) break;

          if (ch === "=") {
            parser.addItem();
            parser.setNodeMode();
            continue outer;
          }

          if (ch === "?") {
            parser.addItem();
            const newStr = str.substring(i + 1);
            const groupParser = xtParse(newStr, "tenary");
            i += groupParser.getCharCnt();
            if (groupParser.getStack().length > 0) {
              parser.addTenary(groupParser.getStack()[0]!);
            }
            continue outer;
          }

          if (!parser.isSelectMode()) {
            parser.addOperator(ch, !parser.isArrayMode() && !parser.isObjectMode() && !parser.isArgsMode() && !parser.isTenaryMode());
            continue outer;
          }
        }
        break;
      case "&":
        if (!quoteMode) {
          if (!parser.isSelectMode()) {
            for (const op of ["&&"]) {
              if (peek(str, i, op.length) === op) {
                parser.addOperator(op, !parser.isArgsMode() && !parser.isArrayMode() && !parser.isObjectMode());
                i += op.length - 1;
                ch = op[op.length - 1]!;
                continue outer;
              }
            }
            parser.addOperator(ch, !parser.isArrayMode() && !parser.isObjectMode() && !parser.isArgsMode() && !parser.isTenaryMode());
            continue outer;
          }
        }
        break;
      case "|":
        if (!quoteMode) {
          if (!parser.isSelectMode()) {
            for (const op of ["||"]) {
              if (peek(str, i, op.length) === op) {
                parser.addOperator(op, !parser.isArgsMode() && !parser.isArrayMode() && !parser.isObjectMode());
                i += op.length - 1;
                ch = op[op.length - 1]!;
                continue outer;
              }
            }
          }
        }

        if (!quoteMode && !parser.isSelectMode()) {
          const pk = peek(str, i + 1, 1);
          if (pk === "(" || pk === "$" || (typeof pk === "string" && ctypeDigit(pk))) {
            parser.addOperator(ch, !parser.isArrayMode() && !parser.isObjectMode() && !parser.isArgsMode() && !parser.isTenaryMode());
            continue outer;
          }

          parser.addItem();

          if (parser.isPipesMode() || parser.isArgsMode()) {
            break outer;
          }

          const newStr = str.substring(i + 1);
          const groupParser = xtParse(newStr, "pipes");
          i += groupParser.getCharCnt();
          parser.addPipes(groupParser.getStack());
          continue outer;
        }
        break;
      case ":":
        if (!quoteMode && !parser.isSelectMode()) {
          parser.addItem(false, parser.isArgsMode());
          if (parser.isArgsMode()) {
            parser.cleanupArgs(false);
          } else if (parser.isObjectMode()) {
            parser.objectDirection = "right";
          } else if (parser.isTenaryMode()) {
            parser.tenaryDirection = "right";
          } else if (!parser.isArrayMode()) {
            parser.setArgsMode();
          }
          continue outer;
        }
        break;
      case "(":
        if (!quoteMode && !parser.isSelectMode()) {
          const newStr = str.substring(i + 1);
          const groupParser = xtParse(newStr, "node");
          i += groupParser.getCharCnt();
          parser.addGroup(groupParser.getStack());
          continue outer;
        }
        break;
      case ")":
        if (!quoteMode && !parser.isSelectMode()) {
          if (parser.isNodeMode()) i++;
          break outer;
        }
        break;
      case "[":
        if (!quoteMode && !parser.isSelectMode()) {
          const newStr = str.substring(i + 1);
          const groupParser = xtParse(newStr, "array");
          i += groupParser.getCharCnt();

          if (parser.isEmpty()) {
            const stack = parser.getActiveStack();
            const lastEntry = stack[stack.length - 1];
            if (lastEntry && ("array" in lastEntry || "group" in lastEntry || "object" in lastEntry) && groupParser.getStack().length === 1) {
              parser.addChar("[" + newStr.substring(0, groupParser.getCharCnt()));
            } else {
              parser.addArray(groupParser.getStack());
            }
          } else {
            parser.addChar("[" + newStr.substring(0, groupParser.getCharCnt()));
          }
          continue outer;
        }
        break;
      case "]":
        if (!quoteMode && !parser.isSelectMode()) {
          if (parser.isArrayMode()) i++;
          else legacy = true;
          break outer;
        }
        break;
      case "{":
        if (!quoteMode && !parser.isSelectMode()) {
          const newStr = str.substring(i + 1);
          const groupParser = xtParse(newStr, "object");
          i += groupParser.getCharCnt();
          parser.addObject(groupParser.getStack());
          continue outer;
        }
        break;
      case "}":
        if (!quoteMode && !parser.isSelectMode()) {
          if (parser.isObjectMode()) i++;
          break outer;
        }
        break;
      case "\n":
      case ",": {
        if (ch === "\n") {
          if (quoteMode || parser.isSelectMode() || parser.isTenaryMode()) break;
          if (parser.isObjectMode() && trim(parser.entry) === "") {
            if (parser.objectDirection === "right" && parser.objectRightTempStack.length === 0) break;
          }
          if (parser.isPipesMode() || parser.isTenaryMode()) {
            const nextStr = str.substring(i).replace(/^[ \t\n\r\0\v]+/, "");
            let stop = false;
            for (const findMe of [":"]) {
              if (nextStr.startsWith(findMe)) {
                stop = true;
                break;
              }
            }
            if (stop) break outer;
          }
        }
        // fall through to the comma handling
        if (!quoteMode && !parser.isSelectMode()) {
          if (parser.isPipesMode()) break outer;
          if (parser.isTenaryMode()) break outer;
          if (parser.isArgsMode()) {
            if (!parser.isEmpty()) break outer;
          }
          if (!parser.isArgsMode()) {
            parser.addItem(false, true);
            if (parser.isObjectMode()) parser.cleanupObject(false);
            if (parser.isArrayMode()) parser.cleanupArray(false);
            continue outer;
          }
        }
        break;
      }
    }

    parser.addChar(ch);
  }

  parser.finalize();

  if (quoteMode) legacy = true;

  return new ParsedResult({ charCnt: i, select: parser.select, stack: parser.getStack() }, legacy);
}

/** Look ahead `len` characters from `i`, skipping whitespace when `trim` (keeping "\n" when `newline` is false). */
export function peek(str: string, i: number, len = 1, doTrim = true, newline = true): string | null {
  const max = 20;
  if (len > max) throw new Error("Invalid max.");
  let matches = "";
  let idx = i;
  while (true) {
    if (idx >= str.length) break;
    let ch: string = str[idx++]!;
    if (doTrim) {
      if (ch !== "\n" || newline) ch = trim(ch);
    }
    if (ch === "") continue;
    matches += ch;
    if (matches.length === max) break;
  }
  if (matches.length < len) return null;
  return matches.substring(0, len);
}
