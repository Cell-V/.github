/**
 * Example-based test for label sync. It runs a dry run over committed
 * fixtures and compares the report with the committed expected output.
 *
 * Fixtures (scripts/__tests__/fixtures/label-sync/):
 *   - labels.yml            example label catalog (input)
 *   - repositories.json     current labels per repository (input)
 *   - expected-report.json  JSON report, as written by --json (output)
 *   - expected-report.txt   text report, as printed by the CLI (output)
 *
 * After an intended change to the report format, regenerate the outputs:
 *   UPDATE_FIXTURES=1 npm test
 * Then review the diff of the expected files before you commit them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

import {
  syncLabels,
  formatReport,
  loadDefinitionsFile,
  LabelsClient,
  RepoRef,
} from "../sync-labels";
import { ExistingLabel } from "../types";

const FIXTURES = path.join(__dirname, "fixtures", "label-sync");

function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

/** Read-only client over the fixture data. Any write fails the test. */
function fixtureClient(labels: Record<string, ExistingLabel[]>): LabelsClient {
  const refuse = async (): Promise<void> => {
    throw new Error("A dry run must not write.");
  };
  return {
    listLabels: async (owner, repo) => {
      const found = labels[`${owner}/${repo}`];
      if (!found) {
        throw new Error(`No fixture for ${owner}/${repo}.`);
      }
      return found.map((label) => ({ ...label }));
    },
    createLabel: refuse,
    updateLabel: refuse,
  };
}

function compareOrUpdate(actual: string, expectedFile: string): void {
  const file = fixture(expectedFile);
  if (process.env.UPDATE_FIXTURES === "1") {
    fs.writeFileSync(file, actual);
    return;
  }
  assert.equal(actual, fs.readFileSync(file, "utf8"), `${expectedFile} differs`);
}

test("dry run over the fixtures matches the expected reports", async () => {
  const definitions = loadDefinitionsFile(fixture("labels.yml"));
  const labels = JSON.parse(
    fs.readFileSync(fixture("repositories.json"), "utf8"),
  ) as Record<string, ExistingLabel[]>;
  const targets: RepoRef[] = Object.keys(labels).map((slug) => {
    const [owner, repo] = slug.split("/");
    return { owner, repo };
  });

  const report = await syncLabels(fixtureClient(labels), targets, definitions);

  compareOrUpdate(`${JSON.stringify(report, null, 2)}\n`, "expected-report.json");
  compareOrUpdate(`${formatReport(report)}\n`, "expected-report.txt");
});
