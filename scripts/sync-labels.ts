/**
 * Label synchronization.
 *
 * Synchronizes the canonical label set in `.github/labels.yml` to an EXPLICIT
 * list of target repositories. Safety rules:
 *
 *   - Dry-run is the default. Writes happen only with `--apply`
 *     (library: `{ apply: true }`).
 *   - Targets come only from an explicit allowlist (`--repos` or
 *     `LABEL_SYNC_REPOS`). The script never lists or syncs every repository of
 *     an organization.
 *   - Labels that no definition manages are preserved and reported as `extra`.
 *     The script never deletes a label.
 *   - Writes are serialized and throttled, rate-limit responses are retried
 *     with `retry-after` / backoff, and a per-run write budget stops the run
 *     before GitHub's secondary limits. Runs are idempotent, so a re-run
 *     continues where a stopped run ended.
 *
 * The PURE planner ({@link planLabelSync}) computes operations from the
 * definitions and a snapshot of existing labels. The I/O layer
 * ({@link syncRepoLabels}, {@link syncLabels}) executes or only reports them.
 *
 * Credentials come only from the `GITHUB_TOKEN` environment variable at run
 * time. The token needs `Issues: write` (or `Pull requests: write`) and
 * `Metadata: read` on the target repositories. See docs/label-sync.md.
 */

import { Octokit } from "@octokit/rest";

import {
  LabelDefinition,
  ExistingLabel,
  LabelOperation,
  LabelSyncMode,
  RepoSyncResult,
  LabelSyncReport,
} from "./types";
import { validateLabels, DEFAULT_LABELS_PATH } from "./validate-labels";
import * as fs from "fs";
import * as yaml from "js-yaml";

/* -------------------------------------------------------------------------- */
/* Limits and defaults                                                        */
/* -------------------------------------------------------------------------- */

/** GitHub's documented secondary limit for content-creating requests per hour. */
export const GITHUB_HOURLY_WRITE_LIMIT = 500;

/** Default write budget per run. Stays below the hourly secondary limit. */
export const DEFAULT_MAX_WRITES = 400;

/** Default pause between writes: 1 s keeps a run below 80 writes per minute. */
export const DEFAULT_WRITE_DELAY_MS = 1000;

/** Default number of retries after a rate-limit response. */
export const DEFAULT_MAX_RETRIES = 3;

/** Maximum number of targets in one run. Split larger rollouts. */
export const MAX_TARGETS = 50;

/* -------------------------------------------------------------------------- */
/* Pure planning (no I/O)                                                     */
/* -------------------------------------------------------------------------- */

/** Case-insensitive key for comparing label names/aliases. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Determine whether an existing label already matches a definition exactly.
 * Color comparison is case-insensitive (hex); description comparison is exact
 * after normalizing null/undefined.
 */
function matchesDefinition(
  existing: ExistingLabel,
  definition: LabelDefinition,
): boolean {
  return (
    key(existing.color) === key(definition.color) &&
    (existing.description ?? "") === (definition.description ?? "")
  );
}

/**
 * Compute the list of synchronization operations for a single repository.
 *
 * This function is pure. For each definition, in order:
 *   1. If a label with the canonical name exists (case-insensitive): `noop` if
 *      color and description match, otherwise `update`.
 *   2. Else, take the FIRST existing label that matches an alias
 *      (case-insensitive) and plan a `rename`.
 *   3. Else plan a `create`.
 *
 * @param definitions Validated, de-duplicated label definitions.
 * @param existing    Labels currently present on the target repository.
 * @returns Ordered list of operations, including `noop` entries.
 */
export function planLabelSync(
  definitions: LabelDefinition[],
  existing: ExistingLabel[],
): LabelOperation[] {
  const byName = new Map<string, ExistingLabel>();
  for (const label of existing) {
    byName.set(key(label.name), label);
  }

  const operations: LabelOperation[] = [];

  for (const definition of definitions) {
    const canonical = byName.get(key(definition.name));

    if (canonical) {
      operations.push({
        type: matchesDefinition(canonical, definition) ? "noop" : "update",
        name: definition.name,
        color: definition.color,
        description: definition.description,
      });
      continue;
    }

    const aliasMatch = findFirstAliasMatch(definition, byName);
    if (aliasMatch) {
      operations.push({
        type: "rename",
        name: definition.name,
        color: definition.color,
        description: definition.description,
        from: aliasMatch.name,
      });
      continue;
    }

    operations.push({
      type: "create",
      name: definition.name,
      color: definition.color,
      description: definition.description,
    });
  }

  return operations;
}

/**
 * Find the first existing label matching any of a definition's aliases,
 * scanning aliases in declaration order (first match wins).
 */
function findFirstAliasMatch(
  definition: LabelDefinition,
  byName: Map<string, ExistingLabel>,
): ExistingLabel | undefined {
  for (const alias of definition.aliases ?? []) {
    const match = byName.get(key(alias));
    if (match) {
      return match;
    }
  }
  return undefined;
}

/**
 * Return existing labels that no definition manages: not a canonical name and
 * not consumed by a planned rename. These labels are always preserved.
 */
export function findExtraLabels(
  definitions: LabelDefinition[],
  existing: ExistingLabel[],
  operations: LabelOperation[],
): string[] {
  const managed = new Set<string>(definitions.map((d) => key(d.name)));
  for (const op of operations) {
    if (op.type === "rename" && op.from) {
      managed.add(key(op.from));
    }
  }
  return existing
    .filter((label) => !managed.has(key(label.name)))
    .map((label) => label.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Number of API writes an operation list needs. */
export function countWrites(operations: LabelOperation[]): number {
  return operations.filter(
    (op) => op.type === "create" || op.type === "update" || op.type === "rename",
  ).length;
}

/* -------------------------------------------------------------------------- */
/* Report helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Create an empty per-repository result for the given repo name. */
export function emptyRepoResult(repo: string): RepoSyncResult {
  return {
    repo,
    created: [],
    updated: [],
    renamed: [],
    conflicts: [],
    errors: [],
    skipped: false,
    extra: [],
  };
}

/**
 * Aggregate per-repository results into a {@link LabelSyncReport}. Counts are
 * derived strictly from the recorded operation lists, so the totals always
 * equal the operations planned (dry-run) or performed (apply).
 */
export function buildReport(
  results: RepoSyncResult[],
  mode: LabelSyncMode = "apply",
  remaining: string[] = [],
): LabelSyncReport {
  let createdCount = 0;
  let updatedCount = 0;
  let renamedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;
  let extraCount = 0;

  for (const result of results) {
    createdCount += result.created.length;
    updatedCount += result.updated.length;
    renamedCount += result.renamed.length;
    conflictCount += result.conflicts.length;
    errorCount += result.errors.length;
    extraCount += result.extra.length;
  }

  return {
    repos: results,
    createdCount,
    updatedCount,
    renamedCount,
    conflictCount,
    errorCount,
    repoCount: results.length,
    mode,
    extraCount,
    writeCount: createdCount + updatedCount + renamedCount,
    remaining,
  };
}

/** Format a {@link LabelSyncReport} as human-readable text. */
export function formatReport(report: LabelSyncReport): string {
  const dryRun = report.mode === "dry-run";
  const verb = dryRun ? "planned" : "applied";
  const lines: string[] = [];

  lines.push(`Label sync report (${report.mode})`);
  lines.push("==============================");
  if (dryRun) {
    lines.push("DRY RUN: no changes were written. Re-run with --apply to write.");
  }
  lines.push(`Repositories processed: ${report.repoCount}`);
  lines.push(
    `Totals (${verb}): created: ${report.createdCount}, updated: ${report.updatedCount}, ` +
      `renamed: ${report.renamedCount}, conflicts: ${report.conflictCount}, ` +
      `errors: ${report.errorCount}, extra (preserved): ${report.extraCount}`,
  );
  lines.push(`Writes ${verb}: ${report.writeCount}`);
  if (dryRun && report.writeCount > GITHUB_HOURLY_WRITE_LIMIT) {
    lines.push(
      `WARNING: ${report.writeCount} writes exceed GitHub's secondary limit of ` +
        `${GITHUB_HOURLY_WRITE_LIMIT} per hour. Split the targets across runs.`,
    );
  }
  if (report.remaining.length > 0) {
    lines.push(
      `Write budget reached. Not processed (${report.remaining.length}): ` +
        `${report.remaining.join(", ")}. Re-run to continue.`,
    );
  }
  lines.push("");

  for (const result of report.repos) {
    lines.push(`• ${result.repo}`);
    if (result.skipped) {
      lines.push(`    skipped: ${result.errors.join("; ") || "unknown reason"}`);
      continue;
    }
    lines.push(
      `    created (${result.created.length}): ` +
        (result.created.join(", ") || "—"),
    );
    lines.push(
      `    updated (${result.updated.length}): ` +
        (result.updated.join(", ") || "—"),
    );
    lines.push(
      `    renamed (${result.renamed.length}): ` +
        (result.renamed.map((r) => `${r.from} → ${r.to}`).join(", ") || "—"),
    );
    if (result.conflicts.length > 0) {
      lines.push(
        `    conflicts (${result.conflicts.length}): ` +
          result.conflicts
            .map((c) => `${c.from} ⇸ ${c.name} (${c.reason})`)
            .join(", "),
      );
    }
    if (result.extra.length > 0) {
      lines.push(
        `    extra, preserved (${result.extra.length}): ${result.extra.join(", ")}`,
      );
    }
    if (result.errors.length > 0) {
      lines.push(`    errors (${result.errors.length}): ${result.errors.join("; ")}`);
    }
  }

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

/** Shape of an Octokit `RequestError` that the retry logic reads. */
interface HttpErrorLike {
  status?: number;
  message?: string;
  response?: { headers?: Record<string, string | number | undefined> };
}

/**
 * Return the wait in milliseconds before retrying a failed request, or
 * `undefined` when the error is not a rate-limit error (for example a plain
 * 403 permission error) and must not be retried.
 *
 * Order of precedence:
 *   1. `retry-after` header (seconds).
 *   2. Primary limit exhausted (`x-ratelimit-remaining: 0`): wait until
 *      `x-ratelimit-reset`.
 *   3. 429, or a 403 whose message names a secondary rate limit: wait one
 *      minute, doubled on each attempt.
 *
 * @param err     The thrown error.
 * @param attempt Zero-based retry attempt.
 * @param now     Current time in ms (injectable for tests).
 */
export function rateLimitDelayMs(
  err: unknown,
  attempt: number,
  now: number = Date.now(),
): number | undefined {
  const e = (err ?? {}) as HttpErrorLike;
  if (e.status !== 403 && e.status !== 429) {
    return undefined;
  }
  const headers = e.response?.headers ?? {};

  const retryAfter = Number(headers["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }

  if (String(headers["x-ratelimit-remaining"]) === "0") {
    const reset = Number(headers["x-ratelimit-reset"]);
    if (Number.isFinite(reset)) {
      return Math.max(0, reset * 1000 - now) + 1000;
    }
  }

  if (e.status === 429 || /secondary rate limit/i.test(e.message ?? "")) {
    return 60_000 * 2 ** attempt;
  }

  return undefined;
}

/** Execution settings shared by {@link syncRepoLabels} and {@link syncLabels}. */
export interface SyncOptions {
  /** Write to GitHub. Default `false` (dry-run). */
  apply?: boolean;
  /** Maximum writes in this run. Default {@link DEFAULT_MAX_WRITES}. */
  maxWrites?: number;
  /** Pause between writes in ms. Default {@link DEFAULT_WRITE_DELAY_MS}. */
  writeDelayMs?: number;
  /** Retries after a rate-limit response. Default {@link DEFAULT_MAX_RETRIES}. */
  maxRetries?: number;
  /** Sleep function (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Fully resolved {@link SyncOptions}. */
type ResolvedOptions = Required<SyncOptions>;

function resolveOptions(options: SyncOptions): ResolvedOptions {
  return {
    apply: options.apply ?? false,
    maxWrites: options.maxWrites ?? DEFAULT_MAX_WRITES,
    writeDelayMs: options.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    sleep:
      options.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

/**
 * Serializes, throttles, and retries writes. One instance is shared across all
 * repositories of a run, so the throttle applies to the whole run.
 */
class Writer {
  private writes = 0;

  constructor(private readonly options: ResolvedOptions) {}

  /** Writes performed so far in this run. */
  get count(): number {
    return this.writes;
  }

  /** Run one write with throttling and rate-limit retries. */
  async write(fn: () => Promise<void>): Promise<void> {
    if (this.writes > 0 && this.options.writeDelayMs > 0) {
      await this.options.sleep(this.options.writeDelayMs);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await fn();
        this.writes++;
        return;
      } catch (err) {
        const delay = rateLimitDelayMs(err, attempt);
        if (delay === undefined || attempt >= this.options.maxRetries) {
          throw err;
        }
        await this.options.sleep(delay);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Octokit I/O orchestration                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Minimal interface over the subset of Octokit's issues API that the sync
 * uses. Tests inject a fake without network calls.
 */
export interface LabelsClient {
  listLabels(owner: string, repo: string): Promise<ExistingLabel[]>;
  createLabel(
    owner: string,
    repo: string,
    name: string,
    color: string,
    description: string,
  ): Promise<void>;
  updateLabel(
    owner: string,
    repo: string,
    currentName: string,
    newName: string,
    color: string,
    description: string,
  ): Promise<void>;
}

/** A single `{ owner, repo }` target. */
export interface RepoRef {
  owner: string;
  repo: string;
  archived?: boolean;
}

/** Build the `owner/repo` display string. */
function repoSlug(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/**
 * Wrap an {@link Octokit} instance in the {@link LabelsClient} interface.
 * Label reads use pagination, so repositories with more than 100 labels are
 * read completely.
 */
export function createLabelsClient(octokit: Octokit): LabelsClient {
  return {
    async listLabels(owner, repo) {
      const labels = await octokit.paginate(octokit.issues.listLabelsForRepo, {
        owner,
        repo,
        per_page: 100,
      });
      return labels.map((label) => ({
        name: label.name,
        color: label.color ?? "",
        description: label.description ?? "",
      }));
    },
    async createLabel(owner, repo, name, color, description) {
      await octokit.issues.createLabel({ owner, repo, name, color, description });
    },
    async updateLabel(owner, repo, currentName, newName, color, description) {
      await octokit.issues.updateLabel({
        owner,
        repo,
        name: currentName,
        new_name: newName,
        color,
        description,
      });
    },
  };
}

/**
 * Plan, and in apply mode execute, the label operations for one repository.
 *
 * In dry-run mode the result lists the PLANNED operations and the client
 * receives no write call. In apply mode the result lists the operations that
 * succeeded. A failed operation is recorded and the remaining operations
 * continue.
 *
 * @param client      Label API client.
 * @param ref         The target repository.
 * @param definitions Validated label definitions.
 * @param options     Execution settings. Default: dry-run.
 */
export async function syncRepoLabels(
  client: LabelsClient,
  ref: RepoRef,
  definitions: LabelDefinition[],
  options: SyncOptions = {},
): Promise<RepoSyncResult> {
  const resolved = resolveOptions(options);
  return executeRepo(client, ref, definitions, resolved, new Writer(resolved));
}

async function readLabels(
  client: LabelsClient,
  ref: RepoRef,
  options: ResolvedOptions,
): Promise<ExistingLabel[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.listLabels(ref.owner, ref.repo);
    } catch (err) {
      const delay = rateLimitDelayMs(err, attempt);
      if (delay === undefined || attempt >= options.maxRetries) {
        throw err;
      }
      await options.sleep(delay);
    }
  }
}

async function executeRepo(
  client: LabelsClient,
  ref: RepoRef,
  definitions: LabelDefinition[],
  options: ResolvedOptions,
  writer: Writer,
  existingSnapshot?: ExistingLabel[],
): Promise<RepoSyncResult> {
  const result = emptyRepoResult(repoSlug(ref));

  let existing: ExistingLabel[];
  if (existingSnapshot) {
    existing = existingSnapshot;
  } else {
    try {
      existing = await readLabels(client, ref, options);
    } catch (err) {
      result.skipped = true;
      result.errors.push(describeError(err));
      return result;
    }
  }

  const operations = planLabelSync(definitions, existing);
  result.extra = findExtraLabels(definitions, existing, operations);

  // Names present on the repo, updated as operations are applied, so the
  // rename conflict guard reflects this run's own changes.
  const presentNames = new Set<string>(existing.map((l) => key(l.name)));

  for (const op of operations) {
    try {
      switch (op.type) {
        case "create":
          if (options.apply) {
            await writer.write(() =>
              client.createLabel(ref.owner, ref.repo, op.name, op.color, op.description),
            );
          }
          presentNames.add(key(op.name));
          result.created.push(op.name);
          break;

        case "update":
          if (options.apply) {
            await writer.write(() =>
              client.updateLabel(
                ref.owner,
                ref.repo,
                op.name,
                op.name,
                op.color,
                op.description,
              ),
            );
          }
          result.updated.push(op.name);
          break;

        case "rename": {
          const from = op.from as string;
          // Conflict guard: the canonical name must not already be taken by a
          // different label.
          if (presentNames.has(key(op.name)) && key(op.name) !== key(from)) {
            result.conflicts.push({
              name: op.name,
              from,
              reason:
                "canonical name already assigned to a different label on the target repository",
            });
            break;
          }
          if (options.apply) {
            await writer.write(() =>
              client.updateLabel(
                ref.owner,
                ref.repo,
                from,
                op.name,
                op.color,
                op.description,
              ),
            );
          }
          presentNames.delete(key(from));
          presentNames.add(key(op.name));
          result.renamed.push({ from, to: op.name });
          break;
        }

        case "conflict":
          result.conflicts.push({
            name: op.name,
            from: op.from ?? "",
            reason: op.reason ?? "rename conflict",
          });
          break;

        case "noop":
        default:
          break;
      }
    } catch (err) {
      result.errors.push(
        `${op.type} "${op.name}"${op.from ? ` (from "${op.from}")` : ""}: ${describeError(err)}`,
      );
    }
  }

  return result;
}

/**
 * Plan, and in apply mode execute, label sync for every target repository.
 *
 * Archived targets are skipped. A failure on one repository never aborts the
 * others. In apply mode, a repository is processed only if its planned writes
 * fit in the remaining write budget; otherwise it and all later targets are
 * listed in `remaining`. The first repository is always processed, so every
 * run makes progress.
 *
 * @param client      Label API client.
 * @param repos       Explicit target repositories.
 * @param definitions Validated label definitions.
 * @param options     Execution settings. Default: dry-run.
 */
export async function syncLabels(
  client: LabelsClient,
  repos: RepoRef[],
  definitions: LabelDefinition[],
  options: SyncOptions = {},
): Promise<LabelSyncReport> {
  const resolved = resolveOptions(options);
  const writer = new Writer(resolved);
  const results: RepoSyncResult[] = [];
  const remaining: string[] = [];

  for (let i = 0; i < repos.length; i++) {
    const ref = repos[i];

    if (ref.archived) {
      const skipped = emptyRepoResult(repoSlug(ref));
      skipped.skipped = true;
      skipped.errors.push("repository is archived; skipped");
      results.push(skipped);
      continue;
    }

    let existing: ExistingLabel[];
    try {
      existing = await readLabels(client, ref, resolved);
    } catch (err) {
      const skipped = emptyRepoResult(repoSlug(ref));
      skipped.skipped = true;
      skipped.errors.push(describeError(err));
      results.push(skipped);
      continue;
    }

    if (resolved.apply) {
      const planned = countWrites(planLabelSync(definitions, existing));
      if (writer.count > 0 && writer.count + planned > resolved.maxWrites) {
        remaining.push(...repos.slice(i).map(repoSlug));
        break;
      }
    }

    results.push(
      await executeRepo(client, ref, definitions, resolved, writer, existing),
    );
  }

  return buildReport(results, resolved.apply ? "apply" : "dry-run", remaining);
}

/* -------------------------------------------------------------------------- */
/* Targets                                                                    */
/* -------------------------------------------------------------------------- */

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** Thrown when the target list is empty, malformed, or too large. */
export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetError";
  }
}

/**
 * Parse an explicit target list. Entries are separated by commas, spaces, or
 * new lines. An entry is `owner/repo`, or `repo` when `defaultOwner` is set.
 * When `defaultOwner` is set, every entry must belong to that owner.
 *
 * @throws {TargetError} when the list is empty, an entry is malformed, an
 *   entry belongs to another owner, or the list has more than
 *   {@link MAX_TARGETS} entries.
 */
export function parseTargets(input: string, defaultOwner?: string): RepoRef[] {
  const entries = input
    .split(/[\s,]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (entries.length === 0) {
    throw new TargetError(
      "No target repositories. Pass --repos or set LABEL_SYNC_REPOS.",
    );
  }

  const seen = new Set<string>();
  const refs: RepoRef[] = [];

  for (const entry of entries) {
    const parts = entry.split("/");
    let owner: string;
    let repo: string;
    if (parts.length === 1 && defaultOwner) {
      owner = defaultOwner;
      repo = parts[0];
    } else if (parts.length === 2) {
      [owner, repo] = parts;
    } else {
      throw new TargetError(
        `Invalid target "${entry}". Use owner/repo${defaultOwner ? " or repo" : ""}.`,
      );
    }

    if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) {
      throw new TargetError(`Invalid target "${entry}".`);
    }
    if (defaultOwner && key(owner) !== key(defaultOwner)) {
      throw new TargetError(
        `Target "${entry}" is not in owner "${defaultOwner}".`,
      );
    }

    const id = key(`${owner}/${repo}`);
    if (!seen.has(id)) {
      seen.add(id);
      refs.push({ owner, repo });
    }
  }

  if (refs.length > MAX_TARGETS) {
    throw new TargetError(
      `${refs.length} targets exceed the maximum of ${MAX_TARGETS} per run. Split the rollout.`,
    );
  }

  return refs;
}

/* -------------------------------------------------------------------------- */
/* Loading definitions                                                        */
/* -------------------------------------------------------------------------- */

/** Thrown when the label definitions file is invalid. */
export class LabelDefinitionsError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid label definitions:\n${errors.join("\n")}`);
    this.name = "LabelDefinitionsError";
  }
}

/**
 * Parse and validate label definitions from raw YAML text. Validation reuses
 * {@link validateLabels}, so the sync and the validator apply identical rules.
 * An invalid file throws {@link LabelDefinitionsError} before any repository
 * is read.
 */
export function loadDefinitions(
  source: string,
  sourceName = DEFAULT_LABELS_PATH,
): LabelDefinition[] {
  const validation = validateLabels(source, sourceName);
  if (!validation.valid) {
    throw new LabelDefinitionsError(validation.errors);
  }

  const parsed = yaml.load(source) as unknown;
  if (!Array.isArray(parsed)) {
    throw new LabelDefinitionsError([
      `${sourceName}: expected a list of label definitions.`,
    ]);
  }

  return parsed.map((entry) => {
    const record = entry as Record<string, unknown>;
    const definition: LabelDefinition = {
      name: String(record.name).trim(),
      color: String(record.color).trim(),
      description: String(record.description),
    };
    if (Array.isArray(record.aliases)) {
      definition.aliases = record.aliases.map((a) => String(a).trim());
    }
    return definition;
  });
}

/** Read and validate label definitions from a file on disk. */
export function loadDefinitionsFile(
  filePath: string = DEFAULT_LABELS_PATH,
): LabelDefinition[] {
  const source = fs.readFileSync(filePath, "utf8");
  return loadDefinitions(source, filePath);
}

/* -------------------------------------------------------------------------- */
/* Error utilities                                                            */
/* -------------------------------------------------------------------------- */

/** Extract a readable message from an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/** Parsed command-line arguments. */
export interface CliArgs {
  apply: boolean;
  repos?: string;
  maxWrites: number;
  jsonPath?: string;
}

/**
 * Parse command-line arguments.
 *
 *   --repos <list>      Explicit targets (or LABEL_SYNC_REPOS).
 *   --apply             Write changes. Without it the run is a dry run.
 *   --max-writes <n>    Write budget for the run.
 *   --json <path>       Also write the report as JSON to <path>.
 *
 * @throws {Error} on an unknown argument or a bad value.
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, maxWrites: DEFAULT_MAX_WRITES };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`${arg} needs a value.`);
      }
      return v;
    };
    switch (arg) {
      case "--apply":
        args.apply = true;
        break;
      case "--repos":
        args.repos = value();
        break;
      case "--max-writes": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) {
          throw new Error("--max-writes must be a positive integer.");
        }
        args.maxWrites = n;
        break;
      }
      case "--json":
        args.jsonPath = value();
        break;
      default:
        throw new Error(`Unknown argument "${arg}".`);
    }
  }
  return args;
}

/**
 * CLI orchestration. Exit codes:
 *   0  success (dry-run or apply).
 *   1  invalid input, invalid definitions, or at least one repository error.
 *   2  apply stopped at the write budget; re-run to continue.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required. Supply it at run time; never commit it.",
    );
  }

  const targets = parseTargets(
    args.repos ?? process.env.LABEL_SYNC_REPOS ?? "",
    process.env.LABEL_SYNC_OWNER || undefined,
  );
  const definitions = loadDefinitionsFile(
    process.env.LABELS_PATH ?? DEFAULT_LABELS_PATH,
  );

  const client = createLabelsClient(new Octokit({ auth: token }));
  const report = await syncLabels(client, targets, definitions, {
    apply: args.apply,
    maxWrites: args.maxWrites,
  });

  const text = formatReport(report);
  console.log(text);

  if (args.jsonPath) {
    fs.writeFileSync(args.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(
      summaryPath,
      `## Label sync (${report.mode})\n\n\`\`\`text\n${text}\n\`\`\`\n`,
    );
  }

  if (report.errorCount > 0) {
    process.exit(1);
  }
  if (report.remaining.length > 0) {
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(describeError(err));
    process.exit(1);
  });
}
