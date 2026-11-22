/**
 * Safety tests for label sync: dry-run default, explicit targets, extra-label
 * preservation, idempotence, rate-limit retries, throttling, and the
 * resumable write budget. All tests use in-memory fakes; no network access.
 *
 * Run with: `npm test`
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  syncLabels,
  syncRepoLabels,
  createLabelsClient,
  rateLimitDelayMs,
  parseTargets,
  parseArgs,
  TargetError,
  LabelsClient,
  RepoRef,
  MAX_TARGETS,
} from "../sync-labels";
import { LabelDefinition, ExistingLabel } from "../types";

const OWNER = "acme";

const DEFS: LabelDefinition[] = [
  { name: "bug", color: "d73a4a", description: "Something is broken", aliases: ["defect"] },
  { name: "docs", color: "0075ca", description: "Documentation" },
];

/** In-memory client. Counts writes; optional hook to fail a write. */
function fakeClient(
  initial: Record<string, ExistingLabel[]>,
  onWrite?: (n: number) => void,
): { client: LabelsClient; store: Record<string, ExistingLabel[]>; writes: () => number } {
  const store: Record<string, ExistingLabel[]> = {};
  for (const [repo, labels] of Object.entries(initial)) {
    store[repo] = labels.map((l) => ({ ...l }));
  }
  let writes = 0;
  const repoOf = (repo: string): ExistingLabel[] => (store[repo] ??= []);
  const client: LabelsClient = {
    async listLabels(_owner, repo) {
      return repoOf(repo).map((l) => ({ ...l }));
    },
    async createLabel(_owner, repo, name, color, description) {
      onWrite?.(writes + 1);
      writes++;
      repoOf(repo).push({ name, color, description });
    },
    async updateLabel(_owner, repo, currentName, newName, color, description) {
      onWrite?.(writes + 1);
      writes++;
      const label = repoOf(repo).find((l) => l.name.toLowerCase() === currentName.toLowerCase());
      if (!label) throw new Error(`label "${currentName}" not found`);
      Object.assign(label, { name: newName, color, description });
    },
  };
  return { client, store, writes: () => writes };
}

/** Client whose writes always throw: proves dry-run never writes. */
function readOnlyClient(labels: ExistingLabel[]): LabelsClient {
  return {
    async listLabels() {
      return labels.map((l) => ({ ...l }));
    },
    async createLabel() {
      throw new Error("write called in dry-run");
    },
    async updateLabel() {
      throw new Error("write called in dry-run");
    },
  };
}

function httpError(status: number, message: string, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(message), { status, response: { headers } });
}

const noSleep = async (): Promise<void> => {};

/* ------------------------------------------------------------------------ */

test("dry-run is the default and performs no writes", async () => {
  const client = readOnlyClient([{ name: "defect", color: "ffffff", description: "" }]);
  const report = await syncLabels(client, [{ owner: OWNER, repo: "app" }], DEFS);

  assert.equal(report.mode, "dry-run");
  assert.equal(report.errorCount, 0);
  assert.deepEqual(report.repos[0].renamed, [{ from: "defect", to: "bug" }]);
  assert.deepEqual(report.repos[0].created, ["docs"]);
  assert.equal(report.writeCount, 2);
});

test("syncRepoLabels without options is a dry run", async () => {
  const client = readOnlyClient([]);
  const result = await syncRepoLabels(client, { owner: OWNER, repo: "app" }, DEFS);
  assert.deepEqual(result.created, ["bug", "docs"]);
  assert.deepEqual(result.errors, []);
});

test("dry-run plan equals apply result, and a second apply is a no-op", async () => {
  const initial = { app: [{ name: "Defect", color: "000000", description: "old" }] };
  const target: RepoRef[] = [{ owner: OWNER, repo: "app" }];

  const { client, writes } = fakeClient(initial);
  const plan = await syncLabels(client, target, DEFS);
  assert.equal(writes(), 0);

  const applied = await syncLabels(client, target, DEFS, { apply: true, writeDelayMs: 0 });
  assert.equal(applied.mode, "apply");
  assert.deepEqual(applied.repos[0].created, plan.repos[0].created);
  assert.deepEqual(applied.repos[0].renamed, plan.repos[0].renamed);
  assert.equal(writes(), plan.writeCount);

  const again = await syncLabels(client, target, DEFS, { apply: true, writeDelayMs: 0 });
  assert.equal(again.writeCount, 0);
  assert.equal(writes(), plan.writeCount);
});

test("extra labels are reported and preserved", async () => {
  const { client, store } = fakeClient({
    app: [
      { name: "keep-me", color: "aaaaaa", description: "local" },
      { name: "defect", color: "ffffff", description: "" },
    ],
  });
  const report = await syncLabels(client, [{ owner: OWNER, repo: "app" }], DEFS, {
    apply: true,
    writeDelayMs: 0,
  });

  // "defect" is consumed by the rename, so only "keep-me" is extra.
  assert.deepEqual(report.repos[0].extra, ["keep-me"]);
  assert.equal(report.extraCount, 1);
  assert.ok(store.app.some((l) => l.name === "keep-me"));
});

test("label reads use pagination with 100 items per page", async () => {
  const all = Array.from({ length: 250 }, (_, i) => ({
    name: `l${i}`,
    color: "ffffff",
    description: null,
  }));
  let params: Record<string, unknown> | undefined;
  const octokit = {
    issues: { listLabelsForRepo: {} },
    paginate: async (_endpoint: unknown, p: Record<string, unknown>) => {
      params = p;
      return all;
    },
  };
  const client = createLabelsClient(octokit as never);
  const labels = await client.listLabels(OWNER, "app");
  assert.equal(labels.length, 250);
  assert.equal(params?.per_page, 100);
  assert.equal(labels[0].description, "");
});

test("a secondary rate limit is retried after retry-after", async () => {
  const sleeps: number[] = [];
  let failed = false;
  const { client } = fakeClient({ app: [] }, () => {
    if (!failed) {
      failed = true;
      throw httpError(403, "You have exceeded a secondary rate limit", { "retry-after": "7" });
    }
  });
  const report = await syncLabels(client, [{ owner: OWNER, repo: "app" }], DEFS, {
    apply: true,
    writeDelayMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(report.errorCount, 0);
  assert.deepEqual(report.repos[0].created, ["bug", "docs"]);
  assert.deepEqual(sleeps, [7000]);
});

test("a permission error is not retried and is reported", async () => {
  const sleeps: number[] = [];
  const { client } = fakeClient({ app: [] }, () => {
    throw httpError(403, "Resource not accessible by integration");
  });
  const report = await syncLabels(client, [{ owner: OWNER, repo: "app" }], DEFS, {
    apply: true,
    writeDelayMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(report.errorCount, 2);
  assert.deepEqual(report.repos[0].created, []);
  assert.deepEqual(sleeps, []);
});

test("rate-limit retries stop after maxRetries", async () => {
  let attempts = 0;
  const { client } = fakeClient({ app: [] }, () => {
    attempts++;
    throw httpError(429, "Too many requests");
  });
  const report = await syncLabels(client, [{ owner: OWNER, repo: "app" }], [DEFS[0]], {
    apply: true,
    writeDelayMs: 0,
    maxRetries: 2,
    sleep: noSleep,
  });
  assert.equal(attempts, 3);
  assert.equal(report.errorCount, 1);
});

test("rateLimitDelayMs reads retry-after, reset, and backoff", () => {
  assert.equal(rateLimitDelayMs(httpError(403, "x", { "retry-after": "3" }), 0), 3000);
  assert.equal(
    rateLimitDelayMs(
      httpError(403, "API rate limit exceeded", {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "110",
      }),
      0,
      100_000,
    ),
    11_000,
  );
  assert.equal(rateLimitDelayMs(httpError(429, "slow down"), 0), 60_000);
  assert.equal(rateLimitDelayMs(httpError(429, "slow down"), 2), 240_000);
  assert.equal(rateLimitDelayMs(httpError(403, "forbidden"), 0), undefined);
  assert.equal(rateLimitDelayMs(httpError(404, "not found"), 0), undefined);
  assert.equal(rateLimitDelayMs(new Error("boom"), 0), undefined);
});

test("writes are throttled across the whole run", async () => {
  const sleeps: number[] = [];
  const { client } = fakeClient({ a: [], b: [] });
  await syncLabels(
    client,
    [
      { owner: OWNER, repo: "a" },
      { owner: OWNER, repo: "b" },
    ],
    DEFS,
    { apply: true, writeDelayMs: 1000, sleep: async (ms) => void sleeps.push(ms) },
  );
  // 4 writes in total: a pause before each write except the first.
  assert.deepEqual(sleeps, [1000, 1000, 1000]);
});

test("the write budget stops the run and a re-run continues", async () => {
  const { client, writes } = fakeClient({ a: [], b: [], c: [] });
  const targets: RepoRef[] = ["a", "b", "c"].map((repo) => ({ owner: OWNER, repo }));
  const options = { apply: true, writeDelayMs: 0, maxWrites: 3 };

  const first = await syncLabels(client, targets, DEFS, options);
  assert.deepEqual(first.repos.map((r) => r.repo), [`${OWNER}/a`]);
  assert.deepEqual(first.remaining, [`${OWNER}/b`, `${OWNER}/c`]);
  assert.equal(writes(), 2);

  const second = await syncLabels(client, targets, DEFS, options);
  assert.deepEqual(second.remaining, [`${OWNER}/c`]);
  assert.equal(writes(), 4);

  const third = await syncLabels(client, targets, DEFS, options);
  assert.deepEqual(third.remaining, []);
  assert.equal(writes(), 6);
});

test("the dry-run budget never stops a run", async () => {
  const { client } = fakeClient({ a: [], b: [] });
  const report = await syncLabels(
    client,
    [
      { owner: OWNER, repo: "a" },
      { owner: OWNER, repo: "b" },
    ],
    DEFS,
    { maxWrites: 1 },
  );
  assert.equal(report.repoCount, 2);
  assert.equal(report.writeCount, 4);
  assert.deepEqual(report.remaining, []);
});

/* ------------------------------------------------------------------------ */

test("parseTargets accepts explicit targets and removes duplicates", () => {
  assert.deepEqual(parseTargets("acme/a, acme/b\nACME/a"), [
    { owner: "acme", repo: "a" },
    { owner: "acme", repo: "b" },
  ]);
  assert.deepEqual(parseTargets("a b", "acme"), [
    { owner: "acme", repo: "a" },
    { owner: "acme", repo: "b" },
  ]);
});

test("parseTargets rejects empty, malformed, foreign, and oversized lists", () => {
  assert.throws(() => parseTargets("  "), TargetError);
  assert.throws(() => parseTargets("just-a-name"), TargetError);
  assert.throws(() => parseTargets("a/b/c"), TargetError);
  assert.throws(() => parseTargets("acme/bad name!"), TargetError);
  assert.throws(() => parseTargets("other/a", "acme"), TargetError);
  const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => `acme/r${i}`).join(",");
  assert.throws(() => parseTargets(many), TargetError);
});

test("parseArgs defaults to dry-run and validates values", () => {
  assert.equal(parseArgs([]).apply, false);
  const args = parseArgs(["--repos", "acme/a", "--apply", "--max-writes", "10", "--json", "r.json"]);
  assert.deepEqual(args, { apply: true, repos: "acme/a", maxWrites: 10, jsonPath: "r.json" });
  assert.throws(() => parseArgs(["--max-writes", "0"]));
  assert.throws(() => parseArgs(["--repos"]));
  assert.throws(() => parseArgs(["--delete"]));
});
