/**
 * Tests for _parseToolCall — validates current behavior, documents known bugs,
 * and verifies the fixed implementation.
 *
 * Run: node --test src/core.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonLikeArgs, repairJson, parseToolCallRobust } from "./json-repair.mjs";

// ─── Current implementation (copied from core.mjs) ────────────────────────

function _parseToolCallOriginal(text) {
  text = text.replace(/<\/s>/g, "");
  const m = text.match(/\[TOOL_CALLS\](\w+)\[ARGS\](\{.+)/s);
  if (!m) return null;

  const name = m[1];
  const raw = m[2].trim();

  let depth = 0;
  let end = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === 0) end = raw.length;

  let args;
  try {
    args = JSON.parse(raw.slice(0, end));
  } catch {
    return null;
  }

  const thinking = text.slice(0, m.index).trim();
  return [thinking, name, args];
}

// ─── Test helpers ─────────────────────────────────────────────────────────

function wrap(name, json, { thinking = "", suffix = "" } = {}) {
  return `${thinking}[TOOL_CALLS]${name}[ARGS]${json}${suffix}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 1: Original implementation — confirms known bugs
// ═══════════════════════════════════════════════════════════════════════════

describe("_parseToolCallOriginal (documents known bugs)", () => {
  describe("1. normal valid JSON (PASS)", () => {
    it("parses a simple valid JSON argument", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src"}');
      const result = _parseToolCallOriginal(input);
      assert.deepStrictEqual(result, ["", "rg", { pattern: "hello", path: "/src" }]);
    });

    it("preserves thinking text before [TOOL_CALLS]", () => {
      const input = wrap("rg", '{"pattern":"hello"}', { thinking: "I need to search" });
      const result = _parseToolCallOriginal(input);
      assert.equal(result[0], "I need to search");
    });
  });

  describe("2. key missing leading quote (FAIL)", () => {
    it("returns null for first key missing leading quote", () => {
      const input = wrap("rg", '{pattern":"warp.*request","path":"/codebase"}');
      assert.equal(_parseToolCallOriginal(input), null);
    });

    it("returns null for middle key missing leading quote", () => {
      const input = wrap("rg", '{"pattern":"warp.*request",path":"/codebase"}');
      assert.equal(_parseToolCallOriginal(input), null);
    });
  });

  describe("3. trailing comma (FAIL)", () => {
    it("returns null for trailing comma", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src",}');
      assert.equal(_parseToolCallOriginal(input), null);
    });
  });

  describe("4. unclosed brace (FAIL)", () => {
    it("returns null for missing closing brace", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src"');
      assert.equal(_parseToolCallOriginal(input), null);
    });
  });

  describe("6. </s> (PASS)", () => {
    it("strips </s> at the end", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src"}', { suffix: "</s>" });
      const result = _parseToolCallOriginal(input);
      assert.notEqual(result, null);
      assert.equal(result[1], "rg");
    });
  });

  describe("7. single quotes (FAIL)", () => {
    it("returns null for single quotes", () => {
      const input = wrap("rg", "{'pattern':'hello','path':'/src'}");
      assert.equal(_parseToolCallOriginal(input), null);
    });
  });

  describe("9. real-world failure (FAIL)", () => {
    it("returns null on actual malformed output", () => {
      const input =
        "I need to search.\n" +
        '[TOOL_CALLS]rg[ARGS]{pattern":"warp.*request",path":"/codebase"}';
      assert.equal(_parseToolCallOriginal(input), null);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2: extractJsonLikeArgs unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("extractJsonLikeArgs", () => {
  it("extracts simple object", () => {
    const r = extractJsonLikeArgs('prefix{"a":1}suffix', 0);
    assert.equal(r.jsonLike, '{"a":1}');
    assert.equal(r.unterminated, false);
  });

  it("extracts from offset", () => {
    const r = extractJsonLikeArgs('xxxxxxx{"b":2}', 7);
    assert.equal(r.jsonLike, '{"b":2}');
  });

  it("handles nested objects", () => {
    const r = extractJsonLikeArgs('{"a":{"b":1},"c":2}', 0);
    assert.equal(r.jsonLike, '{"a":{"b":1},"c":2}');
  });

  it("ignores braces inside strings", () => {
    const r = extractJsonLikeArgs('{"pattern":"{hello}"}', 0);
    assert.equal(r.jsonLike, '{"pattern":"{hello}"}');
    assert.equal(r.unterminated, false);
  });

  it("returns unterminated for unclosed brace", () => {
    const r = extractJsonLikeArgs('{"a":1', 0);
    assert.equal(r.unterminated, true);
  });

  it("returns null when no brace found", () => {
    const r = extractJsonLikeArgs("no braces here", 0);
    assert.equal(r, null);
  });

  it("handles escaped quotes in strings", () => {
    const r = extractJsonLikeArgs('{"a":"say \\"hi\\""}', 0);
    assert.equal(r.jsonLike, '{"a":"say \\"hi\\""}');
    assert.equal(r.unterminated, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3: repairJson unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe("repairJson", () => {
  it("passes through valid JSON (step=raw)", () => {
    const r = repairJson('{"a":1}');
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.value, { a: 1 });
    assert.equal(r.step, "raw");
  });

  it("strips </s> (step=strip_tail)", () => {
    const r = repairJson('{"a":1}</s>');
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.value, { a: 1 });
    assert.equal(r.step, "strip_tail");
  });

  it("removes trailing commas (step=trailing_commas)", () => {
    const r = repairJson('{"a":1,"b":2,}');
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.value, { a: 1, b: 2 });
    assert.equal(r.step, "trailing_commas");
  });

  it("fixes key missing leading quote — pattern\": (step=fix_key_quotes)", () => {
    const r = repairJson('{pattern":"warp.*request","path":"/codebase"}');
    assert.equal(r.ok, true);
    assert.equal(r.value.pattern, "warp.*request");
    assert.equal(r.value.path, "/codebase");
    assert.equal(r.step, "fix_key_quotes");
  });

  it("fixes key missing leading quote — mixed valid/invalid", () => {
    const r = repairJson('{"pattern":"test",path":"/src"}');
    assert.equal(r.ok, true);
    assert.equal(r.value.pattern, "test");
    assert.equal(r.value.path, "/src");
    assert.equal(r.step, "fix_key_quotes");
  });

  it("fixes unquoted key — key: (no quotes at all)", () => {
    const r = repairJson('{pattern:"hello",path:"/src"}');
    assert.equal(r.ok, true);
    assert.equal(r.value.pattern, "hello");
    assert.equal(r.value.path, "/src");
  });

  it("handles single quotes (step=single_to_double_quotes)", () => {
    const r = repairJson("{'pattern':'hello','path':'/src'}");
    assert.equal(r.ok, true);
    assert.equal(r.value.pattern, "hello");
    assert.equal(r.value.path, "/src");
  });

  it("closes unclosed brackets (step=close_brackets)", () => {
    const r = repairJson('{"a":1,"b":2');
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.value, { a: 1, b: 2 });
    assert.equal(r.step, "close_brackets");
  });

  it("handles nested unclosed brackets", () => {
    const r = repairJson('{"a":{"b":1},"c":2');
    assert.equal(r.ok, true);
    assert.equal(r.value.a.b, 1);
    assert.equal(r.value.c, 2);
  });

  it("repairs the complex real-world failure case", () => {
    const input =
      '{"command1":{"type":"rg","pattern":"OpenAI.*request.*warp","path":"/codebase/protobuf2openai","exclude":[]},' +
      '"command2":{"type":"rg","pattern":"warp.*request",path":"/codebase",exclude":["test","tests","warp-proxy","warp-gateway"]}}';
    const r = repairJson(input);
    assert.equal(r.ok, true);
    assert.equal(r.value.command1.type, "rg");
    assert.equal(r.value.command2.type, "rg");
    assert.equal(r.value.command2.path, "/codebase");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 4: parseToolCallRobust — the fixed implementation
// ═══════════════════════════════════════════════════════════════════════════

describe("parseToolCallRobust (fixed implementation)", () => {
  describe("1. normal valid JSON", () => {
    it("parses a simple valid JSON argument", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src"}');
      const result = parseToolCallRobust(input);
      assert.deepStrictEqual(result, ["", "rg", { pattern: "hello", path: "/src" }]);
    });

    it("preserves thinking text", () => {
      const input = wrap("rg", '{"pattern":"hello"}', { thinking: "Searching..." });
      const result = parseToolCallRobust(input);
      assert.equal(result[0], "Searching...");
      assert.equal(result[1], "rg");
    });
  });

  describe("2. key missing leading quote — THE critical bug fix", () => {
    it("fixes first key missing leading quote", () => {
      const input = wrap("rg", '{pattern":"warp.*request","path":"/codebase"}');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null, "should NOT be null after fix");
      assert.equal(result[1], "rg");
      assert.equal(result[2].pattern, "warp.*request");
      assert.equal(result[2].path, "/codebase");
    });

    it("fixes middle key missing leading quote", () => {
      const input = wrap("rg", '{"pattern":"warp.*request",path":"/codebase"}');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].pattern, "warp.*request");
      assert.equal(result[2].path, "/codebase");
    });
  });

  describe("3. trailing comma", () => {
    it("fixes trailing comma", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src",}');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.deepStrictEqual(result[2], { pattern: "hello", path: "/src" });
    });
  });

  describe("4. unclosed brace", () => {
    it("fixes missing closing brace", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src"');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].pattern, "hello");
      assert.equal(result[2].path, "/src");
    });
  });

  describe("5. braces inside string values", () => {
    it("handles regex pattern with braces", () => {
      const input = wrap("rg", '{"pattern":"\\\\w{3,5}","path":"/src"}');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].path, "/src");
    });

    it("handles literal braces in command", () => {
      const input = wrap("bash", '{"command":"echo {hello} {world}"}');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].command, "echo {hello} {world}");
    });
  });

  describe("6. </s> token", () => {
    it("handles </s> at end", () => {
      const input = wrap("rg", '{"pattern":"hello"}', { suffix: "</s>" });
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[1], "rg");
    });

    it("handles multiple </s>", () => {
      const input = 'thinking</s>[TOOL_CALLS]rg[ARGS]{"pattern":"hello"}</s></s>';
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[0], "thinking");
    });
  });

  describe("7. single quotes", () => {
    it("fixes single-quoted JSON", () => {
      const input = wrap("rg", "{'pattern':'hello','path':'/src'}");
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].pattern, "hello");
      assert.equal(result[2].path, "/src");
    });
  });

  describe("8. complex nested JSON", () => {
    it("parses deeply nested valid JSON", () => {
      const input = wrap("restricted_exec", JSON.stringify({
        command1: { type: "rg", pattern: "import", path: "/src" },
        command2: { type: "readfile", file: "/src/main.js" },
      }));
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].command1.type, "rg");
      assert.equal(result[2].command2.type, "readfile");
    });

    it("ignores trailing text after JSON", () => {
      const input = wrap("rg", '{"pattern":"hello","path":"/src"}\nExtra text');
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.deepStrictEqual(result[2], { pattern: "hello", path: "/src" });
    });
  });

  describe("9. real-world failure cases — ALL MUST PASS", () => {
    it("parses actual malformed output (missing leading quotes on keys)", () => {
      const input =
        "I need to search.\n" +
        '[TOOL_CALLS]rg[ARGS]{pattern":"warp.*request",path":"/codebase"}';
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null, "MUST not be null after fix");
      assert.equal(result[0], "I need to search.");
      assert.equal(result[1], "rg");
      assert.equal(result[2].pattern, "warp.*request");
      assert.equal(result[2].path, "/codebase");
    });

    it("parses malformed output with mixed valid/invalid quoting", () => {
      const input = '[TOOL_CALLS]rg[ARGS]{"pattern":"test",path":"/src"}';
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].pattern, "test");
      assert.equal(result[2].path, "/src");
    });

    it("parses </s> combined with missing quotes", () => {
      const input = '[TOOL_CALLS]rg[ARGS]{pattern":"config.*yaml",path":"/project"}</s>';
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[2].pattern, "config.*yaml");
      assert.equal(result[2].path, "/project");
    });

    it("parses multi-command restricted_exec with mixed quoting issues", () => {
      const input =
        "Now I need to look deeper.\n" +
        '[TOOL_CALLS]restricted_exec[ARGS]{"command1":{"type":"readfile","file":"/codebase/src/api.py","start_line":1,"end_line":100},' +
        '"command2":{"type":"rg","pattern":"OpenAI.*request.*warp","path":"/codebase/protobuf2openai","exclude":[]},' +
        'command3":{"type":"rg","pattern":"warp.*request",path":"/codebase",exclude":["test","tests"]},' +
        '"command4":{"type":"tree","path":"/codebase/src","levels":2}}';
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null, "MUST parse multi-command with mixed quoting");
      assert.equal(result[0], "Now I need to look deeper.");
      assert.equal(result[1], "restricted_exec");
      assert.equal(result[2].command1.type, "readfile");
      assert.equal(result[2].command2.type, "rg");
      assert.equal(result[2].command3.type, "rg");
      assert.equal(result[2].command4.type, "tree");
    });
  });

  describe("edge cases", () => {
    it("returns null for no [TOOL_CALLS] marker", () => {
      assert.equal(parseToolCallRobust("just some text"), null);
    });

    it("returns null for [TOOL_CALLS] with no JSON", () => {
      assert.equal(parseToolCallRobust("[TOOL_CALLS]rg[ARGS]no json here"), null);
    });

    it("handles answer tool call", () => {
      const xml = '<ANSWER><file path="/codebase/src/main.py"><range>1-50</range></file></ANSWER>';
      const input = wrap("answer", JSON.stringify({ answer: xml }));
      const result = parseToolCallRobust(input);
      assert.notEqual(result, null);
      assert.equal(result[1], "answer");
      assert.ok(result[2].answer.includes("<ANSWER>"));
    });
  });
});
