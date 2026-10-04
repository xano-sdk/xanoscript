/**
 * Ports of the engine's two indentation helpers (`indent` and `normalizeIndent`).
 */
import { ltrim, rtrim, strlen, strRepeat } from "./php.js";

/**
 * Indent every row by `cols` spaces. A string (or list of strings) for `cols`
 * means "outdent to the row that starts with one of these markers"; a
 * negative number outdents. `skipFirst` leaves the first row unindented.
 */
export function indent(str: string, cols: number | string | string[], skipFirst = false): string {
  let rows = str.split("\n");
  let n: number;

  if (typeof cols === "string") cols = [cols];

  if (Array.isArray(cols)) {
    let max: number | null = null;
    for (const row of rows) {
      const val = ltrim(row);
      for (const col of cols) {
        if (val.startsWith(col)) {
          const len = strlen(row) - strlen(val);
          max = max === null ? len : Math.min(max, len);
        }
      }
    }
    if (max === 0) return str;
    n = -(max ?? 0);
    // PHP: `if ($max === 0) return $str; $cols = -$max;` — a null max yields 0.
    if (max === null) n = 0;
  } else {
    n = cols;
  }

  if (n < 0) {
    rows = rows.map((x) => {
      for (let i = 0; i < -n; i++) {
        if (x.substring(0, 1) !== " ") break;
        x = x.substring(1);
      }
      return x;
    });
  } else {
    rows = rows.map((x) => strRepeat(" ", n) + x);
  }

  if (skipFirst && rows.length > 0) {
    rows[0] = ltrim(rows[0]!);
  }

  return rtrim(rows.join("\n"));
}

/** Remove the common leading indentation from every row (optionally ignoring the first). */
export function normalizeIndent(str: string, skipFirst = false, ignoreEmpty = false): string {
  let rows = str.split("\n");
  let first: string | undefined;

  let min: number | null = null;
  if (skipFirst) {
    first = rows.shift();
  }

  for (const row of rows) {
    const val = ltrim(row);
    const delta = strlen(row) - strlen(val);
    if (row === "" && ignoreEmpty) continue;
    min = min === null ? delta : Math.min(min, delta);
  }

  if (min !== null && min > 0) {
    const m = min;
    rows = rows.map((x) => x.substring(m));
  }

  if (skipFirst) {
    rows.unshift(first ?? "");
  }

  return rows.join("\n");
}
