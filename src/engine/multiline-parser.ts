/** Port of redacted: read a `"""`/`'''`/```` ``` ```` block body. */
import { ctypeCntrl, ctypeSpace, ltrim, mbChars, mbStrlen, phpEmpty, strlen, substr, trim } from "./php.js";

function isBlockMatch(val: string, block: string): boolean {
  if (phpEmpty(block)) return false;
  if (val === block) return true;
  for (const ch of ["|", ":", "}", "]", ")"]) {
    if (val.startsWith(block + ch)) return true;
  }
  return false;
}

function getIndent(str: string, block: string): number {
  const parts = str.split("\n");
  for (const part of parts) {
    const val = trim(part);
    if (isBlockMatch(val, block)) {
      // mb_strpos on code points
      return mbChars(part).join("").indexOf(block) === -1 ? 0 : Array.from(part.slice(0, part.indexOf(block))).length;
    }
  }
  throw new Error(`Invalid syntax - missing closing ${block}`);
}

/** Strip a leading ```` ``` ```` plus the whitespace/newline that follows it. */
export function prepForParse(str: string): string {
  const triple = "```";
  if (str.startsWith(triple)) {
    str = substr(str, 3);
    while (str.length > 0) {
      const ch = substr(str, 0, 1);
      if (ch === "\n") {
        str = substr(str, 1);
        break;
      }
      if (ctypeSpace(ch) || ctypeCntrl(ch)) {
        str = substr(str, 1);
        continue;
      }
      break;
    }
  }
  return str;
}

export function parseMultiline(str: string, block = "", _keepLastLine = true): { result: string; cnt: number } {
  const chars = mbChars(str);
  const len = chars.length;

  let indentCols: number;
  if (phpEmpty(block)) {
    indentCols = 0;
    const ch = len > 0 ? chars[0]! : "";
    if (ch === " ") {
      for (let i = 1; i < len; i++) {
        if (chars[i] !== " ") {
          indentCols = i;
          break;
        }
      }
    }
  } else {
    indentCols = getIndent(str, block);
  }

  const lines: string[] = [];
  // PHP keeps `$line = FALSE` between lines; null plays that role here.
  let line: string | null = null;
  let i = 0;

  for (i = 0; i < len; i++) {
    const ch = chars[i]!;

    if (line === null) {
      line = "";

      if (indentCols > 0) {
        let whitespace = "";
        for (let j = i, end = Math.min(i + indentCols, len); j < end; j++) {
          whitespace += chars[j]!;
        }
        if (!phpEmpty(trim(whitespace, " "))) {
          lines.push("");
          line = null;

          const right = ltrim(whitespace, " ");
          const delta = strlen(whitespace) - strlen(right);

          const rch = substr(right, 0, 1);
          if (rch !== "\n") {
            line = "";
            i--;
            lines.pop();
          }

          i += delta;
          continue;
        }

        i += indentCols - 1;
        continue;
      }
    }

    const cur: string = line;
    let breakLoop = false;
    switch (ch) {
      case "\n":
        if (isBlockMatch(cur, block)) {
          i++;
          i -= mbStrlen(cur) - mbStrlen(block);
          line = null;
          breakLoop = true;
          break;
        }
        lines.push(cur);
        line = null;
        continue;
    }
    if (breakLoop) break;

    line = cur + ch;
  }

  if (line !== null && !phpEmpty(line)) {
    const cur: string = line;
    if (!isBlockMatch(cur, block)) {
      lines.push(cur);
    } else {
      i -= mbStrlen(cur) - mbStrlen(block) - 1;
    }
  }

  return { result: lines.join("\n"), cnt: i };
}
