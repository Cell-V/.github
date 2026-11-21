# Label sync

Label sync applies the canonical catalog in `.github/labels.yml` to an explicit list of repositories. The script is `scripts/sync-labels.ts`. The workflow is `.github/workflows/label-sync.yml`.

## Safety rules

- **Dry-run is the default.** The script writes only with `--apply`. In the workflow, the `apply` input must be checked.
- **Explicit targets only.** You must name each target repository. The script never lists or syncs all repositories of the organization. One run accepts at most 50 targets.
- **No deletion.** The script never deletes a label. Labels that the catalog does not manage stay on the repository. The report lists them as `extra (preserved)`.
- **Bounded writes.** Writes are serialized, with a 1-second pause between writes. A run stops at the write budget (default 400). The script retries rate-limit responses and honors `retry-after`.
- **Idempotent.** A second run with no catalog change makes no writes. A run that stopped at the budget continues when you run it again.

## What the sync changes

For each label in the catalog, in this order:

1. A label with the same name exists (case-insensitive): the script updates its color and description if they differ.
2. Else, a label matches one of the `aliases`: the script renames it to the canonical name. Issues and pull requests keep the label, under its new name.
3. Else: the script creates the label.

If the canonical name and an alias both exist, the script updates the canonical label and does not rename the alias label. The report lists the alias label under `extra`. To merge the two labels, move the issues to the canonical label and delete the alias label by hand. The report shows a conflict only when a rename would use a name that another operation in the same run already took.

For a worked example, see the fixtures in [`scripts/__tests__/fixtures/label-sync/`](../scripts/__tests__/fixtures/label-sync/): the input catalog (`labels.yml`), the current labels of two repositories (`repositories.json`), and the dry-run report as text (`expected-report.txt`) and JSON (`expected-report.json`). `scripts/__tests__/label-sync-fixtures.test.ts` checks that the script still produces these reports.

Check renames in the dry-run report before you apply. A rename changes the label name on every issue and pull request that uses it.

Renames have no separate option. `--apply` runs them together with creates and updates. A rename keeps the label on issues and pull requests, so it loses no data. To prevent a rename in one repository, remove the alias from `.github/labels.yml` before the run, or exclude that repository from the targets.

## Credentials

The sync needs a token for the target repositories with these repository permissions:

- `Issues: write` (or `Pull requests: write`; request only one)
- `Metadata: read`

The default `GITHUB_TOKEN` of a workflow run is scoped to its own repository. It cannot write labels in other repositories. Do not use it for the sync.

Recommended: a GitHub App.

1. Create a GitHub App owned by the organization with the permissions above. Turn off webhooks.
2. Install the App only on the repositories that label sync may change.
3. In this repository, open **Settings → Environments** and create the environment `label-sync`.
4. In that environment, add the variable `LABEL_SYNC_APP_ID` (the App ID) and the secret `LABEL_SYNC_APP_PRIVATE_KEY` (the App private key).
5. Optional: add required reviewers to the environment. Then each run waits for an approval.

The workflow creates a short-lived installation token, scoped to the target repositories only. Never commit a token or a private key.

## Run from GitHub Actions

1. Open **Actions → Label Sync → Run workflow**.
2. In `repositories`, enter repository names in this organization, separated by commas, for example `api,web`. Enter names only, without the owner.
3. Leave `apply` unchecked. Run the workflow.
4. Read the report in the run summary. The JSON report is the `label-sync-report` artifact.
5. If the plan is correct, run the workflow again with `apply` checked.

## Run locally

Use a fine-grained personal access token with the permissions above, limited to the target repositories. Supply it only through the environment.

```sh
export GITHUB_TOKEN=...            # never commit this value
npx ts-node scripts/sync-labels.ts --repos Cell-V/api,Cell-V/web                  # dry run
npx ts-node scripts/sync-labels.ts --repos Cell-V/api,Cell-V/web --apply          # write
```

| Option | Meaning |
| --- | --- |
| `--repos <list>` | Targets as `owner/repo`, separated by commas or spaces. Alternative: the `LABEL_SYNC_REPOS` environment variable. |
| `--apply` | Write changes. Without it, the run is a dry run. |
| `--max-writes <n>` | Write budget for the run. Default 400. |
| `--json <path>` | Also write the report as JSON. |

Environment variables: `GITHUB_TOKEN` (required), `LABEL_SYNC_REPOS`, `LABEL_SYNC_OWNER` (if set, all targets must belong to this owner, and bare repository names are allowed), `LABELS_PATH` (default `.github/labels.yml`).

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Invalid input, invalid catalog, or at least one repository error. |
| 2 | The run stopped at the write budget. Run it again to continue. |

## Rate limits

GitHub limits content-creating requests to about 80 per minute and 500 per hour. Each create, update, or rename is one write.

- The dry-run report shows the planned writes. It warns when the total is more than 500.
- For a large rollout, split the targets across runs, or run the same targets again after the budget stops a run.
- A permission error (403 without rate-limit information) is not retried. The report lists it, and the run continues with the next repository.

## References

- [REST API endpoints for labels](https://docs.github.com/rest/issues/labels)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Managing default labels for repositories in your organization](https://docs.github.com/en/organizations/managing-organization-settings/managing-default-labels-for-repositories-in-your-organization)
