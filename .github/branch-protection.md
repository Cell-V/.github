# Default branch protection

This document describes the protection of the default branch of this `.github` repository. Changes here define organization-wide defaults, so every change goes through a pull request.

> GitHub does not read this document or the ruleset file. The ruleset is a repository setting. The file `.github/rulesets/main-protection.json` is the version-controlled copy. When you change the setting, update the file in the same pull request.

## Ruleset

The repository ruleset `main protection` applies to the default branch (`~DEFAULT_BRANCH`). The source is [`.github/rulesets/main-protection.json`](rulesets/main-protection.json).

| Rule | Setting |
| --- | --- |
| Require a pull request before merging | On. Direct pushes to the default branch are rejected. |
| Required approvals | 1 |
| Dismiss stale approvals when new commits are pushed | On |
| Require conversation resolution before merging | On |
| Required status check | `Type-check, test, and validate` (GitHub Actions, from `.github/workflows/ci.yml`) |
| Block force pushes | On |
| Block deletion of the branch | On |
| Bypass | Repository role **Admin**, only through a pull request |

### Why admins can bypass

The organization has one member, who is also the only admin. GitHub does not let an author approve their own pull request. Without a bypass, no pull request could be merged.

The bypass mode is `pull_request`. An admin can merge a pull request without an approval, but cannot push directly to the default branch. The required status check still runs on the pull request, and the admin must explicitly choose to bypass.

Remove the bypass when a second maintainer with write access joins. Then also set `require_code_owner_review` to `true` if `CODEOWNERS` names a team.

### Plan

Rulesets for this repository work on GitHub Free because the repository is public. On GitHub Free, private repositories cannot use rulesets or branch protection. See [docs/security-baseline.md](../docs/security-baseline.md).

## Apply or update the ruleset

Create the ruleset (first time):

```sh
gh api --method POST repos/Cell-V/.github/rulesets --input .github/rulesets/main-protection.json
```

Update the ruleset (find the ID with the list command below):

```sh
gh api --method PUT repos/Cell-V/.github/rulesets/<ruleset-id> --input .github/rulesets/main-protection.json
```

The token needs admin access to the repository. In the UI, go to **Settings → Rules → Rulesets**. The UI can also import the JSON file.

The status check name must match the job `name` in `ci.yml`. If you rename the job, update the ruleset in the same pull request, or merges are blocked.

## Verify

```sh
gh api repos/Cell-V/.github/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/Cell-V/.github/rules/branches/main --jq '[.[].type]'
```

Expected rule types: `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`.

Expected behavior:

- `git push origin main` is rejected.
- A pull request shows the required check, and needs 1 approval or an admin bypass to merge.

## References

- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [REST API endpoints for rules](https://docs.github.com/en/rest/repos/rules)
