/**
 * Port of redacted (the byte-indexed `parseFast` path): given a
 * string starting with `(`, `{`, `[`, `"`, `'` or `` ` ``, return the prefix up
 * to and including the matching closer, honouring nested groups, escapes,
 * triple-quoted blocks and `//` comments inside `{`/`(` groups.
 */
import { parseComment } from "./comment-parser.js";
import { ClosingError, NewlineError, ScriptError, UnexpectedError } from "./errors.js";
import { parseMultiline } from "./multiline-parser.js";
import { ctypeSpace, mbSubstr } from "./php.js";

const QUOTE = '"';
const SINGLE = "'";
const TICK = "`";
const BACKSLASH = "\\";
const SLASH = "/";

function getQuoteModeChar(ch: string): string | false {
  switch (ch) {
    case SINGLE:
    case QUOTE:
    case TICK:
      return ch;
  }
  return false;
}

export function isGroupSupported(str: string): boolean {
  const ch = str.substring(0, 1);
  return [SINGLE, QUOTE, TICK, "(", "{", "["].includes(ch);
}

function isNotEscapeSequence(lastCh: string | false, last2Ch: string | false): boolean {
  return lastCh !== BACKSLASH || (lastCh === BACKSLASH && last2Ch === BACKSLASH);
}

const STRUCTURAL = "{}()[]\"'`/";

function strcspn(str: string, mask: string, offset: number): number {
  let n = 0;
  for (let i = offset; i < str.length; i++) {
    if (mask.includes(str[i]!)) break;
    n++;
  }
  return n;
}

export function parseGroup(str: string, multiline = true): string {
  const len = str.length;
  let entry = "";

  const first = str[0] ?? "";
  let next: string;
  switch (first) {
    case "(": next = ")"; break;
    case "{": next = "}"; break;
    case "[": next = "]"; break;
    case QUOTE: next = QUOTE; break;
    case SINGLE: next = SINGLE; break;
    case TICK: next = TICK; break;
    default: throw new ScriptError("Invalid syntax.");
  }

  entry += str[0]!;
  const quoteMode = getQuoteModeChar(str[0]!);

  let ch: string | false = false;
  let lastCh: string | false = false;
  let lastCh2: string | false = false;

  for (let i = 1; i < len; i++) {
    if (ch === BACKSLASH && lastCh === BACKSLASH && lastCh2 === BACKSLASH) {
      lastCh = false;
    }
    lastCh2 = lastCh;
    lastCh = ch;

    if (quoteMode) {
      if (lastCh !== BACKSLASH) {
        const nextQuote = str.indexOf(quoteMode, i);
        const nextBS = str.indexOf(BACKSLASH, i);

        if (nextQuote === -1) {
          entry += str.substring(i);
          break;
        }

        let jumpTo = nextQuote;
        if (nextBS !== -1 && nextBS < nextQuote) jumpTo = nextBS;

        if (!multiline) {
          const nextNL = str.indexOf("\n", i);
          if (nextNL !== -1 && nextNL < jumpTo) jumpTo = nextNL;
        }

        if (jumpTo > i) {
          entry += str.substring(i, jumpTo);
          i = jumpTo;
          lastCh = false;
          lastCh2 = false;
        }
      }
      ch = str[i]!;
    } else {
      const skip = strcspn(str, STRUCTURAL, i);
      if (skip > 0) {
        entry += str.substring(i, i + skip);
        i += skip;
        lastCh = false;
        lastCh2 = false;
        ch = false;
        if (i >= len) break;
      }
      ch = str[i]!;
    }

    if (!quoteMode) {
      if (ch === next) return entry + next;
    } else if (ch === quoteMode) {
      if (isNotEscapeSequence(lastCh, lastCh2)) return entry + next;
    }

    let handled = false;
    switch (ch) {
      case SLASH:
        if (["{", "#", "("].includes(first)) {
          if (i + 1 < len && str[i + 1] === SLASH) {
            const newStr = str.substring(i);
            const commentRet = parseComment(newStr);
            const commentText = mbSubstr(newStr, 0, commentRet.cnt);
            entry += commentText;
            i += commentText.length - 1;
            handled = true;
          }
        }
        break;
      case SINGLE:
      case QUOTE:
      case TICK:
      case "(":
      case "{":
      case "[":
        if (!quoteMode) {
          if (ch === QUOTE || ch === SINGLE || ch === TICK) {
            if (str.substring(i + 1, i + 3) === ch + ch) {
              entry += ch + ch + ch;
              i += 3;

              while (true) {
                if (i >= len) break;
                const str2 = str[i]!;
                if (str2 === "\n") {
                  entry += str2;
                  i++;
                  break;
                }
                if (ctypeSpace(str2)) {
                  entry += str2;
                  i++;
                  continue;
                }
                throw new UnexpectedError(ch, i);
              }

              let str2 = str.substring(i);
              const result = parseMultiline(str2, ch + ch + ch);
              str2 = mbSubstr(str2, 0, result.cnt);
              const ret = str2.indexOf(ch + ch + ch);
              const cnt = ret + 3;
              str2 = str2.substring(0, cnt);
              entry += str2;
              i += str2.length - 1;
              handled = true;
              break;
            }
          }

          const newStr = str.substring(i + 1);
          const result = parseGroup(ch + newStr);
          i += result.length - 1;
          entry += result;
          handled = true;
        }
        break;
      case ")":
      case "}":
      case "]":
        if (!quoteMode) throw new UnexpectedError(ch, i);
        break;
      case "\n":
        if (quoteMode && !multiline) throw new NewlineError(i);
        break;
    }
    if (handled) continue;

    entry += ch;
  }

  throw new ClosingError(str[0]!, next);
}
