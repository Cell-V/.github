/**
 * Unit tests for the consolidated validation runner.
 *
 * FUNDING.yml is optional. The runner must pass with a warning when the file
 * is absent, and must still validate the file when it is present.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { validateAll } from "../validate-all";

function fundingResult(fundingPath: string) {
  const report = validateAll({ fundingPath });
  const entry = report.results.find((r) => r.name === "Funding configuration");
  assert.ok(entry, "the report contains the funding validator");
  return entry.result;
}

test("a missing FUNDING.yml is skipped with a warning", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-all-"));
  try {
    const result = fundingResult(path.join(dir, "FUNDING.yml"));
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /not present/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a present but invalid FUNDING.yml still fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-all-"));
  try {
    const file = path.join(dir, "FUNDING.yml");
    fs.writeFileSync(file, "custom: [\"http://insecure.example\"]\n");
    const result = fundingResult(file);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
