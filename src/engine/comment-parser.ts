/** Port of redacted: consume leading `//` comment lines. */
import { ltrim, mbStrlen, mbSubstr } from "./php.js";

export const COMMENT_PREFIX = "//";

export function parseComment(str: string): { result: string; cnt: number } {
  const lines = str.split("\n");
  let min: number | null = null;
  let cnt = 0;
  let keepLines: string[] = [];

  for (const line of lines) {
    let filteredLine = ltrim(line);
    if (filteredLine.startsWith(COMMENT_PREFIX)) {
      filteredLine = mbSubstr(filteredLine, mbStrlen(COMMENT_PREFIX));
      const len = mbStrlen(filteredLine) - mbStrlen(ltrim(filteredLine));
      min = min === null ? len : Math.min(min, len);
      keepLines.push(filteredLine);
      cnt += mbStrlen(line) + 1;
      continue;
    }
    break;
  }

  const m = min ?? 0;
  keepLines = keepLines.map((x) => mbSubstr(x, m));

  return { result: keepLines.join("\n"), cnt };
}
