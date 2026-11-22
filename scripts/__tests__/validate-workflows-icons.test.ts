/**
 * Tests for the workflow template iconName rule. GitHub accepts an Octicon
 * ("octicon <name>") or the name of an SVG file in workflow-templates/,
 * without the .svg extension. Any other value shows a broken image in
 * Actions > New workflow.
 *
 * Run with: `npm test`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { validateWorkflowsDir } from "../validate-workflows";

const WORKFLOW = "name: Example\non: push\njobs: {}\n";

function templatesDir(iconName: string, extraFiles: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-icons-"));
  fs.writeFileSync(path.join(dir, "example.yml"), WORKFLOW);
  fs.writeFileSync(
    path.join(dir, "example.properties.json"),
    JSON.stringify({
      name: "example",
      description: "Example starter.",
      iconName,
      categories: ["Continuous integration"],
    }),
  );
  for (const file of extraFiles) {
    fs.writeFileSync(path.join(dir, file), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  }
  return dir;
}

test("accepts an Octicon icon", () => {
  const result = validateWorkflowsDir(templatesDir("octicon rocket"));
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("accepts an SVG file in the templates directory", () => {
  const result = validateWorkflowsDir(templatesDir("example-icon", ["example-icon.svg"]));
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("rejects a bare name without a matching SVG file", () => {
  const result = validateWorkflowsDir(templatesDir("rocket"));
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /iconName "rocket" is not an Octicon/);
});

test("rejects an SVG reference that includes the extension", () => {
  const result = validateWorkflowsDir(templatesDir("example-icon.svg", ["example-icon.svg"]));
  assert.equal(result.valid, false);
});
