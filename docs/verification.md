# Verification of the organization defaults

This document records how the defaults in this repository were verified in a real repository. It lists each check, the method, the observed result, and the limitations. Repeat the checks after a change to the defaults, and add a new run section.

> This repository is public. Record only results that are safe to publish. Keep security findings, alert details, and settings inventories of other repositories in a private location.

## Run 1: 2026-11-22

| Item | Value |
| --- | --- |
| Hub commit for the checks | `da8b9d0` (main) |
| Hub commit for the propagation check | `e152ee6` (main, after PR #9) |
| Hub commit for the Actions label sync | `464e71e` (main, after PR #12) for the dry run, `63f70a0` (main, after PR #14) for the apply run |
| Test repository | [`Cell-V/defaults-sandbox`](https://github.com/Cell-V/defaults-sandbox), public, created on 2026-11-22 for this verification only |
| Authorization | The organization owner authorized the test repository, direct commits to it, and a label sync with `--apply` on it only. No other repository was changed. |
| Methods | GitHub REST and GraphQL API with `gh`, the GitHub web UI in a signed-in browser, and the scripts in this repository |

### Results

| ID | Check | Method | Observed | Result |
| --- | --- | --- | --- | --- |
| V1 | Organization profile renders `profile/README.md` | Opened `https://github.com/Cell-V` | The About, Explore, and Community Standards sections render with the current text. | Pass |
| V2 | Community files fall back to the defaults | `gh api repos/Cell-V/defaults-sandbox/community/profile` on a repository with only a README | `code_of_conduct`, `contributing`, and `pull_request_template` point to files in `Cell-V/.github`. The security policy page of the test repository shows the default `SECURITY.md`. | Pass |
| V3 | Issue forms and chooser fall back to the defaults | Opened **Issues → New issue** in the test repository | The chooser lists Bug Report and Feature Request, blank issues for maintainers only, and the contact links from `config.yml`. | Pass |
| V4 | Forms preselect labels that exist | Opened both forms | Bug Report preselects `bug`. Feature Request preselects `enhancement`. Both labels exist in a new repository as GitHub default labels. | Pass |
| V5 | PR template falls back to the default | GraphQL `repository.pullRequestTemplates` | Returns the default `pull_request_template.md` with the current sections. | Pass |
| V6 | A local `SECURITY.md` overrides the default | Commit `8998af7` in the test repository, then opened the security policy page | The page shows the local file. | Pass |
| V7 | A local issue form replaces the whole inherited set | Commit `021bd0f` (one local form), then opened the chooser and GraphQL `contactLinks` | Only the local form is listed. Both inherited forms and the inherited `config.yml` are gone: no contact links, and blank issues are allowed again. | Pass |
| V8 | Overrides are removed cleanly | Commit `ab743b0` removed the local files | The test repository uses the defaults again. | Pass |
| V9 | Label validation | `npm run validate` | All validators pass. The catalog has 22 labels. | Pass |
| V10 | Label sync dry run | `npx tsx scripts/sync-labels.ts --repos defaults-sandbox` with `LABEL_SYNC_OWNER=Cell-V` | Planned 18 writes: 12 creates, 5 updates, 1 rename (`feature-request` → `feature`). Extra labels `docs` and `sandbox-extra` listed as preserved. No write. | Pass |
| V11 | Label sync apply | Same command with `--apply` | 18 writes, 0 errors. The repository has 24 labels: the 22 catalog labels and the 2 extra labels. | Pass |
| V12 | Second apply is a no-op | Same command with `--apply` again | 0 writes. | Pass |
| V13 | Unmanaged labels are kept | Labels after V11 and V12 | `sandbox-extra` (unmanaged) and `docs` (alias of an existing canonical label) still exist. | Pass |
| V14 | Starter is offered | Opened **Actions → New workflow** after commit `9fec741` (pnpm project) | `typescript-ci` by Cell-V is listed under "Suggested for this repository". `security-scan` is listed under "By Cell-V". | Pass |
| V15 | Adopted starter runs | **Configure** showed the generated file. The same content was committed as `8051a33`. | The first run passed: Node.js 24, pnpm from `packageManager`, `pnpm install --frozen-lockfile`, type-check, and test. Lint and build were skipped because the scripts do not exist. No annotations. | Pass |
| V16 | Later starter edits do not reach an adopted copy | PR #9 changed `typescript-ci.yml` (merged as `e152ee6`). Compared the adopted file afterwards. | The adopted file is unchanged: same SHA-256 (`357536dc…916b`), the old comment, and no commit after `8051a33`. | Pass |
| V17 | Starter icons render | **Actions → New workflow** | Before PR #9: broken image for both starters. After PR #9: rocket and shield icons. | Pass after fix |
| V18 | Security settings of a new repository | Compared the settings of the test repository with this repository | A new repository does not receive the security configuration of this repository. Details are recorded privately. | As documented. Fixed for new public repositories, see F1 and F7 |
| V19 | Label sync on GitHub Actions (dry run) | [Run 45042493795](https://github.com/Cell-V/.github/actions/runs/45042493795) of `label-sync.yml` with `repositories=defaults-sandbox` and `apply` off, after the GitHub App and the `label-sync` environment were set up | The App token was created for the target repository only and was revoked after the job. 0 writes planned: 0 creates, 0 updates, 0 renames, 0 conflicts, 0 errors. Extra labels `docs` and `sandbox-extra` listed as preserved. The JSON report artifact matches the log. No write. | Pass |
| V20 | Label sync on GitHub Actions (apply) with an approval | [Run 45043603259](https://github.com/Cell-V/.github/actions/runs/45043603259) of `label-sync.yml` with `repositories=defaults-sandbox` and `apply` on | The run waited for the required reviewer of the `label-sync` environment and started after the approval. 0 writes applied: 0 creates, 0 updates, 0 renames, 0 conflicts, 0 errors. Extra labels `docs` and `sandbox-extra` were kept. The test repository still has 24 labels. | Pass |

### Findings and remediation

| ID | Finding | Remediation | Status |
| --- | --- | --- | --- |
| F1 | A new repository does not inherit the security settings of this repository. | The organization admin set "GitHub recommended" as the default configuration for new public repositories (later replaced, see F7), and set the default `GITHUB_TOKEN` permissions to read with pull request approval off. The configuration was attached to the test repository. Its settings then matched this repository, except F7. See [security-baseline.md](security-baseline.md#files-versus-features). | Fixed on 2026-11-22 for new public repositories. Existing repositories were not changed. |
| F2 | `iconName` values `rocket` and `shield-check` were not valid, so both starters showed a broken image. | Use `octicon rocket` and `octicon shield-check`. The workflow validator now rejects an invalid `iconName`. | Fixed in PR #9 |
| F3 | GitHub replaces `$default-branch` also inside comments. The adopted comment read `GitHub replaces "main" with the default branch`. | Remove the token from the starter comment. | Fixed in PR #9 |
| F4 | The `config.yml` contact link "Report a Security Vulnerability" duplicated the chooser entry that GitHub adds for a security policy, and it pointed to this repository instead of the affected repository. | Remove the contact link. | Fixed in this change |
| F5 | GraphQL `issueTemplates` and the community profile `issue_template` do not report YAML issue forms. They return empty or `null`, also in this repository. | Check issue forms in the chooser in a browser. Noted in [adoption.md](adoption.md). | Documented |
| F6 | The description of PR #1 said that the catalog has 23 labels. It has 22. | None. This document records the correct count. | Documented |
| F7 | "GitHub recommended" does not turn on Dependabot security updates (`not_set`). A repository that gets only this configuration has no security updates. | The organization admin created the custom configuration "Cell-V baseline": "GitHub recommended" plus Dependabot security updates. It replaced "GitHub recommended" as the default for new public repositories. It was attached to the test repository, and its settings then matched this repository. | Fixed on 2026-11-22 for new public repositories. Existing repositories were not changed. |

### Not verified

- `label-sync.yml` on GitHub Actions with `apply` on and planned writes. V20 applied 0 writes, because the test repository already matched the catalog.
- A public repository created after the F1 fix. The default configuration was verified through the API only. The test repository got the configuration by a manual attach.
- Adoption and a run of the `security-scan` starter.
- Workflow linting with `actionlint`.
- Behavior in a private repository.
- The PR template in a real pull request. V5 verified it through the API only.
- Label deletion: not applicable. The sync never deletes labels.

### Reported results that were not verified here

The description of PR #1 reports a label dry run against this repository on 2026-11-21 (13 creates and 5 updates planned). That result was not repeated. It depends on the labels of this repository at that time.

## Repeat the checks

Use a disposable repository. Get authorization before any write.

```sh
# V2, V5: fallback through the API
gh api repos/<owner>/<repo>/community/profile --jq '.files'
gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequestTemplates{filename} contactLinks{name}}}'

# V3, V4, V7, V14, V17: open in a signed-in browser
#   https://github.com/<owner>/<repo>/issues/new/choose
#   https://github.com/<owner>/<repo>/actions/new

# V9 to V13: label validation and sync (dry run first)
npm run validate
GITHUB_TOKEN="$(gh auth token)" LABEL_SYNC_OWNER=<owner> npx tsx scripts/sync-labels.ts --repos <repo>
GITHUB_TOKEN="$(gh auth token)" LABEL_SYNC_OWNER=<owner> npx tsx scripts/sync-labels.ts --repos <repo> --apply
GITHUB_TOKEN="$(gh auth token)" LABEL_SYNC_OWNER=<owner> npx tsx scripts/sync-labels.ts --repos <repo> --apply   # expect 0 writes

# V16: compare the adopted starter after a change to the starter here
shasum -a 256 .github/workflows/typescript-ci.yml
```
