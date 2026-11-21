/**
 * Tests for the GitHub API length limits in the label validator:
 * name at most 50 characters, description at most 100 characters.
 *
 * Run with: `npm test`
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateLabels,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "../validate-labels";

function labelYaml(name: string, description: string): string {
  return `- name: ${JSON.stringify(name)}\n  color: "d73a4a"\n  description: ${JSON.stringify(description)}\n`;
}

test("accepts a name and description at the maximum length", () => {
  const result = validateLabels(
    labelYaml("n".repeat(MAX_NAME_LENGTH), "d".repeat(MAX_DESCRIPTION_LENGTH)),
  );
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("rejects a name longer than the maximum", () => {
  const result = validateLabels(
    labelYaml("n".repeat(MAX_NAME_LENGTH + 1), "Short description."),
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /name has 51 characters \(maximum 50\)/);
});

test("rejects a description longer than the maximum", () => {
  const result = validateLabels(
    labelYaml("bug", "d".repeat(MAX_DESCRIPTION_LENGTH + 1)),
  );
  assert.equal(result.valid, false);
  assert.match(
    result.errors.join("\n"),
    /description has 101 characters \(maximum 100\)/,
  );
});

test("counts an emoji as one character", () => {
  const name = "🐛".repeat(MAX_NAME_LENGTH);
  const result = validateLabels(labelYaml(name, "Emoji name."));
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("reports every over-length entry and keeps checking the others", () => {
  const source =
    labelYaml("a".repeat(MAX_NAME_LENGTH + 1), "First.") +
    labelYaml("b".repeat(MAX_NAME_LENGTH + 2), "Second.") +
    labelYaml("ok", "Valid entry.");
  const result = validateLabels(source);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});
