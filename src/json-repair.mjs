/**
 * json-repair.mjs — Robust JSON repair utilities.
 * Pure ESM, zero external dependencies.
 */

/**
 * String-aware balanced-bracket extraction.
 * Starting from `fromIdx`, find the first `{` or `[`, then scan forward
 * with string awareness (handling `"`, `'`, `\` escapes) to find the
 * matching closing bracket.
 *
 * @param {string} text
 * @param {number} [fromIdx=0]
 * @returns {{ jsonLike: string, unterminated: boolean } | null}
 */
export function extractJsonLikeArgs(text, fromIdx = 0) {
  let start = -1;
  let openChar = "";
  for (let i = fromIdx; i < text.length; i++) {
    if (text[i] === "{" || text[i] === "[") {
      start = i;
      openChar = text[i];
      break;
    }
  }
  if (start === -1) return null;

  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      if (inString) {
        escaped = true;
      }
      continue;
    }

    if (inString) {
      if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    // Not in string
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        return { jsonLike: text.slice(start, i + 1), unterminated: false };
      }
    }
  }

  // Reached end without closing
  return { jsonLike: text.slice(start), unterminated: true };
}

/**
 * Remove trailing commas (`,}` → `}`, `,]` → `]`) in non-string context.
 * @param {string} s
 * @returns {string}
 */
function removeTrailingCommas(s) {
  let result = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escaped) {
      escaped = false;
      result += ch;
      continue;
    }

    if (ch === "\\") {
      if (inString) escaped = true;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === quote) inString = false;
      result += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }

    if (ch === ",") {
      // Look ahead for the next non-whitespace character
      let j = i + 1;
      while (j < s.length && (s[j] === " " || s[j] === "\t" || s[j] === "\n" || s[j] === "\r")) {
        j++;
      }
      if (j < s.length && (s[j] === "}" || s[j] === "]")) {
        // Skip the comma (don't append it)
        continue;
      }
    }

    result += ch;
  }

  return result;
}

/**
 * Fix key quoting in JSON-like strings.
 * Handles two cases (only in object-key positions):
 *   - `key":` → `"key":`   (key has trailing quote but missing leading quote)
 *   - `key:`  → `"key":`   (key has no quotes at all)
 *
 * "Object key position" means the preceding significant token is `{` or `,`.
 *
 * @param {string} s
 * @returns {string}
 */
function fixKeyQuotes(s) {
  let result = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  let i = 0;

  // Track what the last significant (non-whitespace) character was outside strings
  let lastSignificant = "";

  while (i < s.length) {
    const ch = s[i];

    if (escaped) {
      escaped = false;
      result += ch;
      i++;
      continue;
    }

    if (ch === "\\") {
      if (inString) escaped = true;
      result += ch;
      i++;
      continue;
    }

    if (inString) {
      if (ch === quote) inString = false;
      result += ch;
      i++;
      continue;
    }

    // Not in string context
    if (ch === '"') {
      // Check if we're at a key position and the string might be a value
      // or a properly quoted key — just pass through
      inString = true;
      quote = ch;
      result += ch;
      lastSignificant = ch;
      i++;
      continue;
    }

    if (ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      lastSignificant = ch;
      i++;
      continue;
    }

    // Whitespace — pass through without updating lastSignificant
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      result += ch;
      i++;
      continue;
    }

    // Structural characters
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === ":" || ch === ",") {
      result += ch;
      lastSignificant = ch;
      i++;
      continue;
    }

    // We have a non-quote, non-whitespace, non-structural character outside a string.
    // Check if we're in a key position (after `{` or `,`).
    if (lastSignificant === "{" || lastSignificant === ",") {
      // This looks like an unquoted key. Scan forward to find the end.
      // Case 1: `key":` — has trailing quote before colon
      // Case 2: `key:`  — no quotes at all

      let j = i;
      let keyEnd = -1;
      let hasTrailingQuote = false;

      while (j < s.length) {
        if (s[j] === ":" ) {
          keyEnd = j;
          break;
        }
        if (s[j] === '"' && j + 1 < s.length && s[j + 1] === ":") {
          // Case 1: `key":`
          hasTrailingQuote = true;
          keyEnd = j;
          break;
        }
        if (s[j] === '"' ) {
          // Look ahead past whitespace for `:`
          let k = j + 1;
          while (k < s.length && (s[k] === " " || s[k] === "\t" || s[k] === "\n" || s[k] === "\r")) {
            k++;
          }
          if (k < s.length && s[k] === ":") {
            hasTrailingQuote = true;
            keyEnd = j;
            break;
          }
          // Not a key trailing quote — bail out
          break;
        }
        j++;
      }

      if (keyEnd !== -1) {
        const rawKey = s.slice(i, keyEnd).trim();
        result += '"' + rawKey + '"';
        if (hasTrailingQuote) {
          // Skip past the trailing quote
          i = keyEnd + 1;
        } else {
          i = keyEnd;
        }
        lastSignificant = '"'; // We just "closed" a quoted key
        continue;
      }
    }

    // Default: pass through
    result += ch;
    lastSignificant = ch;
    i++;
  }

  return result;
}

/**
 * Replace single quotes with double quotes when used as string delimiters,
 * handling nested quotes properly.
 * @param {string} s
 * @returns {string}
 */
function singleToDoubleQuotes(s) {
  let result = "";
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escaped) {
      escaped = false;
      result += ch;
      continue;
    }

    if (ch === "\\") {
      if (inString) escaped = true;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === quote) {
        inString = false;
        result += quote === "'" ? '"' : ch;
      } else if (ch === '"' && quote === "'") {
        // Escape double quotes inside a single-quoted string being converted
        result += '\\"';
      } else {
        result += ch;
      }
      continue;
    }

    // Not in string
    if (ch === "'") {
      inString = true;
      quote = ch;
      result += '"';
      continue;
    }
    if (ch === '"') {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Close unclosed brackets/braces by appending the needed closers.
 * @param {string} s
 * @returns {string}
 */
function closeUnclosedBrackets(s) {
  const stack = [];
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // If we ended inside a string, close the string first
  let suffix = "";
  if (inString) suffix += quote;
  while (stack.length > 0) suffix += stack.pop();
  return s + suffix;
}

/**
 * Multi-pass JSON repair.
 * Applies fixes from low-risk to high-risk, trying JSON.parse after each step.
 *
 * @param {string} jsonLike
 * @returns {{ ok: true, value: any, step: string } | { ok: false, error: string }}
 */
export function repairJson(jsonLike) {
  // Step 1: raw parse
  try {
    return { ok: true, value: JSON.parse(jsonLike), step: "raw" };
  } catch { /* continue */ }

  let s = jsonLike;

  // Step 2: strip tail garbage (</s>, control chars, trailing whitespace)
  s = s.replace(/<\/s>/g, "");
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+$/g, "");
  s = s.trim();
  try {
    return { ok: true, value: JSON.parse(s), step: "strip_tail" };
  } catch { /* continue */ }

  // Step 3: remove trailing commas
  let s3 = removeTrailingCommas(s);
  try {
    return { ok: true, value: JSON.parse(s3), step: "trailing_commas" };
  } catch { /* continue */ }

  // Step 4: fix key quotes
  let s4 = fixKeyQuotes(s3);
  try {
    return { ok: true, value: JSON.parse(s4), step: "fix_key_quotes" };
  } catch { /* continue */ }

  // Step 5: single quotes → double quotes
  let s5 = singleToDoubleQuotes(s4);
  try {
    return { ok: true, value: JSON.parse(s5), step: "single_to_double_quotes" };
  } catch { /* continue */ }

  // Step 6: close unclosed brackets
  let s6 = closeUnclosedBrackets(s5);
  try {
    return { ok: true, value: JSON.parse(s6), step: "close_brackets" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Robust tool-call parser — replacement for core.mjs `_parseToolCall`.
 *
 * Flow:
 *   1. Strip `</s>` markers
 *   2. Regex match `[TOOL_CALLS](\w+)[ARGS]`
 *   3. extractJsonLikeArgs to pull the JSON substring
 *   4. repairJson to parse it
 *   5. Return `[thinking, name, args]` or `null`
 *
 * @param {string} text
 * @returns {[string, string, Object] | null}
 */
export function parseToolCallRobust(text) {
  text = text.replace(/<\/s>/g, "");
  const m = text.match(/\[TOOL_CALLS\](\w+)\[ARGS\]/);
  if (!m) return null;

  const name = m[1];
  const argsStart = m.index + m[0].length;

  const extracted = extractJsonLikeArgs(text, argsStart);
  if (!extracted) return null;

  const result = repairJson(extracted.jsonLike);
  if (!result.ok) return null;

  const thinking = text.slice(0, m.index).trim();
  return [thinking, name, result.value];
}
