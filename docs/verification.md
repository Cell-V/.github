# Verification record

This document records how we verify that this repository behaves as [docs/adoption.md](adoption.md) describes. It lists each test case, the command or steps, the observed result, and the remediation.

Rules for this record:

- Record only what a person observed. Mark results that another run reported as **Reported**, not **Pass**.
- Record failures and gaps. Do not remove a failed result. Add a new run below it.
- Keep evidence public-safe. Do not record private repository names, tokens, raw logs, or security findings. Keep detailed security results in a private location.
- Downstream writes need a named, authorized target. Record the authorization in the run header.

Result values: **Pass**, **Fail**, **Blocked** (a prerequisite is missing), **Pending** (not run yet), **Not applicable**.

## Run 1: pre-merge verification

| Field | Value |
| --- | --- |
| Date | 2026-11-21 |
| Commit | `4f5b929` (branch of pull request #1, not merged) |
| Default branch state | `main` contains only `.gitignore`. No default is live. |
| Tooling | Node.js 24.21.0, npm 11.4.2, `gh` CLI with a read-only use of a user token |
| Downstream target | None authorized. No write to any other repository. |
| Writes | None. All commands in this run are read-only. |

### Local checks

| ID | Test case | Command | Result | Observed |
| --- | --- | --- | --- | --- |
| L-01 | Dependencies install from the lockfile | `npm ci` | Pass | Install completed without error. |
| L-02 | Scripts type-check | `npm run typecheck` | Pass | Exit code 0. |
| L-03 | Unit and property tests pass | `npm test` | Pass | 48 tests, 48 pass, 0 fail. |
| L-04 | Labels, issue forms, `FUNDING.yml`, and workflow starters are valid | `npm run validate` | Pass | All four validators passed. |
| L-05 | Workflow files pass a workflow linter | `actionlint` | Pending | `actionlint` is not installed. The CI of this repository does not run a workflow linter. |

L-04 checks structure only. It does not detect placeholder values. See F-01 and F-02.

### Content review

| ID | Test case | Result | Observed | Remediation |
| --- | --- | --- | --- | --- |
| F-01 | Inherited files contain the organization's real contacts and links | Fail | `.github/ISSUE_TEMPLATE/config.yml` and `SUPPORT.md` point to a personal account, not to `Cell-V`. `SECURITY.md` and `CODE_OF_CONDUCT.md` use `example.com` placeholder addresses. | R-01 |
| F-02 | `FUNDING.yml` contains real accounts | Fail | All values are placeholders (`your-org`, `example.com`). An inherited placeholder shows a **Sponsor** button with broken links on every inheriting repository. | R-02 |
| F-03 | `profile/README.md` names the organization | Fail | The heading is a personal account name, not `Cell-V`. | R-01 |
| F-04 | Discussions links resolve | Fail | The profile, `SUPPORT.md`, and the issue chooser link to organization Discussions. Organization Discussions is not turned on. | R-03 |
| F-05 | `CODEOWNERS` names a team that exists and has write access | Fail | `CODEOWNERS` named `@Cell-V/massimoselvi-dev`. The organization has no team with that name. GitHub ignores an owner that does not exist, so no review is requested. Changed to `@Cell-V/developers`. That team exists, but `gh api repos/Cell-V/.github/teams` returns no team, so it has no write access yet. | R-04 |
| F-06 | Issue forms apply labels that exist | Fail | The forms apply `triage`. The hub repository does not have `triage` yet. See S-01. | R-05 |

### Label sync dry-run

| ID | Test case | Command | Result | Observed |
| --- | --- | --- | --- | --- |
| S-01 | Dry-run against the hub writes nothing and reports a plan | `GITHUB_TOKEN=$(gh auth token) npx ts-node scripts/sync-labels.ts --repos Cell-V/.github` | Pass | Exit code 0. Report says `DRY RUN`. Plan: 13 create, 5 update, 0 rename, 0 conflict, 0 extra. |
| S-02 | Bounded apply to an authorized target | `GITHUB_TOKEN=<scoped token> npx ts-node scripts/sync-labels.ts --repos Cell-V/<target> --apply` | Blocked | No authorized target. |
| S-03 | A second apply is a no-op | Same as S-02 | Blocked | Needs S-02. Expected: 0 writes planned. |
| S-04 | An unmanaged label survives apply | Create a label that is not in the catalog, run S-02, then list labels | Blocked | Needs S-02. Expected: the label is in the report as `extra (preserved)` and still exists. |
| S-05 | Label deletion safeguard | None | Not applicable | The script does not support deletion. |
| S-06 | Label sync workflow runs from GitHub Actions | **Actions → Label Sync → Run workflow** | Blocked | The workflow is not on `main`. The `label-sync` environment and the GitHub App credentials do not exist. |

The S-01 plan is the state on 2026-11-21. It is not an expected permanent value.

### Hub security configuration

We ran the [verification checklist](security-baseline.md#verification-checklist) against this repository. The detailed results are in a private location.

| ID | Check | Result |
| --- | --- | --- |
| H-01 | Repository is public | Pass |
| H-02 | Dependency alerts, security updates, secret scanning, push protection, private vulnerability reporting | Pass |
| H-03 | Default `GITHUB_TOKEN` permissions are `read` | Pass |
| H-04 | Branch protection or a ruleset on `main` matches [branch-protection.md](../.github/branch-protection.md) | Fail. Not configured yet. Configure before merge (R-06). |
| H-05 | `CODEOWNERS` names owners that exist | Fail. See F-05. |

### Inheritance and adoption checks

These checks need the defaults on `main` and an authorized downstream repository. They are all **Blocked** in this run. Run 2 must run them. Use a disposable public repository that has no community health files, no `.github/ISSUE_TEMPLATE/`, and no PR template, for example `Cell-V/defaults-sandbox`.

| ID | Test case | Steps | Expected |
| --- | --- | --- | --- |
| D-01 | Organization profile renders | Open `https://github.com/Cell-V` signed out | The page shows `profile/README.md`. Links resolve. |
| D-02 | Community file fallback | In the sandbox, open **Insights → Community standards**. Open the **Code of conduct**, **Contributing**, **Security policy**, and **Support** links. | Each file comes from `Cell-V/.github`. |
| D-03 | Local policy override | Add a local `SECURITY.md` to the sandbox | The **Security** tab shows the local file, not the default. |
| D-04 | Issue chooser and forms render | Open **Issues → New issue** in the sandbox | The two forms and the contact links show. No blank issue option. |
| D-05 | Labels from forms apply | Run label sync on the sandbox (S-02), then submit each form | The new issue has `bug` or `enhancement` and `triage`. |
| D-06 | Local issue template replaces the whole set | Add one file to the sandbox `.github/ISSUE_TEMPLATE/` | Only the local template shows. No inherited form shows. |
| D-07 | Local `config.yml` alone disables inherited forms | Remove the file from D-06. Add only `.github/ISSUE_TEMPLATE/config.yml` | No inherited form shows. |
| D-08 | PR template fallback | Open a pull request in the sandbox | The body contains the default PR template. |
| D-09 | Workflow starter shows and runs | Add a minimal `package.json`. Adopt **CI Pipeline** from **Actions → New workflow**. Push. | The starter shows in the organization section. `$default-branch` is replaced. The run passes. |
| D-10 | Starter edits do not reach adopted copies | Change `workflow-templates/ci-pipeline.yml` on `main`. Compare the sandbox workflow. | The sandbox file does not change. |
| D-11 | Downstream security configuration is separate | Run the security checklist on the sandbox | Only settings that an administrator set are on. The hub files do not turn on any feature. |

Commands for D-02 and D-08 without the UI:

```sh
gh api repos/Cell-V/<sandbox>/community/profile --jq '.files | map_values(.html_url // null)'
```

## Remediation

| ID | Action | Owner | Status |
| --- | --- | --- | --- |
| R-01 | Replace personal and placeholder contacts and names in `config.yml`, `SUPPORT.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `profile/README.md` with confirmed `Cell-V` values | Organization owner | Open. Needs the real values. |
| R-02 | Decide on funding. Set real accounts in `FUNDING.yml`, or delete the file so that no **Sponsor** button shows | Organization owner | Open |
| R-03 | Turn on organization Discussions with this repository as the source, or remove the Discussions links | Organization owner | Open |
| R-04 | Set `CODEOWNERS` to a team that exists and has write access | Organization owner | In progress. `CODEOWNERS` names `@Cell-V/developers`. On 2026-11-21 the team got write (`push`) access to this repository. `gh api repos/Cell-V/.github/teams` confirms it. Still to do: after `CODEOWNERS` is on `main`, confirm that a pull request requests a review from the team. |
| R-05 | Run label sync with `--apply` on the hub and on each target before you depend on form labels | Maintainer | Open. Needs authorization. |
| R-06 | Configure branch protection or a ruleset on `main` as [branch-protection.md](../.github/branch-protection.md) describes | Organization owner | Open |
| R-07 | Add a workflow linter to CI, or run `actionlint` locally before merge | Maintainer | Open |

## Reported results that are not verified here

- The source pull request in a personal account is implementation history. It is not deployment evidence for `Cell-V`.
- Pull request #1 reported 48 passing tests and a dry-run plan of 13 creates and 5 updates. Run 1 repeated both and observed the same values on 2026-11-21.
