# Security baseline

This document defines the security baseline for Cell-V repositories. It explains which controls come from files, which come from settings, and how to verify each one.

> This repository is public. Do not record findings, alert details, private repository names, or a settings inventory here. Keep that information in a private location.

## Files versus features

Files in this repository do not turn on security features.

- `SECURITY.md` is inherited. It tells reporters where to send a vulnerability. It does not turn on private vulnerability reporting, scanning, or alerts.
- `.github/dependabot.yml` applies to **this repository only**. It is not inherited. Each repository needs its own file.
- `CODEOWNERS` applies to **this repository only**, per branch. It is not inherited. Each repository that needs code owners must add its own file.
- `.github/branch-protection.md` is documentation. GitHub does not read it.
- `workflow-templates/security-scan.yml` is an opt-in starter. A repository gets it only when a maintainer adopts it.

Security features need organization or repository settings, a security configuration, or API automation.

## Plan and availability

The organization uses **GitHub Free** (checked on 2026-11-21 with `gh api orgs/Cell-V --jq .plan.name`). Check the plan again before you change this baseline. Availability depends on the plan and on repository visibility.

| Control | Public repository (Free) | Private repository (Free) | Private repository (Team or higher) |
| --- | --- | --- | --- |
| Dependency graph | Yes, on by default | Yes, turn on | Yes |
| Dependabot alerts and security updates | Yes | Yes | Yes |
| Dependabot version updates (`dependabot.yml`) | Yes | Yes | Yes |
| Dependency review (`actions/dependency-review-action`) | Yes | No | Needs GitHub Code Security |
| Code scanning (CodeQL) | Yes | No | Needs GitHub Code Security |
| Secret scanning and push protection | Yes | No | Needs GitHub Secret Protection |
| Private vulnerability reporting | Yes | No | No |
| Branch protection and repository rulesets | Yes | No | Yes |
| Required reviews from code owners | Yes | No | Yes |
| Organization rulesets | No | No | Verify in organization settings |
| Security configurations (organization level) | Yes, for the features in this table | Yes, for the features in this table | Yes |
| Actions permissions | Yes | Yes | Yes |

GitHub documentation is not consistent about the plan for organization rulesets (Team and Enterprise, or Enterprise only). Do not depend on them. Use repository rulesets.

Do not assume that a paid feature is available. Check before you document a control as enforced.

## Baseline per repository

Apply these controls to each repository. Mark a control as an exception only with a written reason, kept in a private location.

| Control | How to apply | Who | Public | Private (Free) |
| --- | --- | --- | --- | --- |
| Security policy | Inherited `SECURITY.md`, or a local file | Nothing to do | Required | Required |
| Private vulnerability reporting | **Settings → Security → Private vulnerability reporting**, or a security configuration | Repository admin | Required | Not available |
| Dependency graph and Dependabot alerts | Security configuration (for example "GitHub recommended") | Organization admin | Required | Required |
| Dependabot security updates | Security configuration | Organization admin | Required | Required |
| Dependabot version updates | Add `.github/dependabot.yml` (see [Example](#example-dependabotyml)) | Maintainer | Required | Required |
| Secret scanning and push protection | Security configuration | Organization admin | Required | Not available |
| Code scanning | CodeQL default setup, or adopt the `security-scan` starter | Maintainer | Recommended | Not available |
| Default branch protection | Repository ruleset or branch protection, as in [branch-protection.md](../.github/branch-protection.md) | Repository admin | Required | Not available |
| Code owners | Add `CODEOWNERS` and require code owner review in the ruleset | Maintainer | Recommended | Review not enforced |
| Actions token permissions | **Settings → Actions → General → Workflow permissions**: read repository contents | Organization admin | Required | Required |
| Workflow permissions in files | Set `permissions:` in each workflow, with the least access | Maintainer | Required | Required |

### Actions settings

Set these at organization level, and check that repositories do not override them:

- Default `GITHUB_TOKEN` permissions: **read repository contents and packages**.
- **Allow GitHub Actions to create and approve pull requests**: off, unless a workflow needs it.
- Fork pull request workflows: require approval for outside contributors.
- Allowed actions: GitHub-owned actions and a reviewed list of other actions.

## Example `dependabot.yml`

Adapt the ecosystems and directories to the real manifests of the repository. Do not add an ecosystem that the repository does not use.

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
    groups:
      minor-and-patch:
        applies-to: version-updates
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      github-actions:
        applies-to: version-updates
        patterns: ["*"]
```

`cooldown` delays version updates for new releases. It does not delay security updates.

## Ecosystem caveats

- **pnpm.** pnpm 12 writes `pnpm-lock.yaml` as two YAML documents when a pnpm version is pinned (the default). The dependency graph does not detect these dependencies. Version updates still work, but alerts and security updates can miss dependencies. For each pnpm repository, check that the dependency graph lists the packages (**Insights → Dependency graph**). If it does not, do not depend on Dependabot alerts for that repository. Record the exception and use another audit, for example `pnpm audit` in CI.
- **Bun.** Dependabot supports the text lockfile `bun.lock` (Bun 1.1.39 or later). It does not support the binary `bun.lockb`. Migrate with `bun install --save-text-lockfile` before you depend on Dependabot.
- **Workflow starters.** Dependabot does not update `workflow-templates/`. Update the action versions in the starters by hand.

## Verification checklist

Run these read-only commands with a token that can read the repository settings. Replace `OWNER` and `REPO`. Record the results in a private location.

```sh
# Plan of the organization
gh api orgs/OWNER --jq .plan.name

# Visibility and secret scanning status
gh api repos/OWNER/REPO --jq '{visibility, security_and_analysis}'

# Dependabot alerts: exit code 0 (HTTP 204) = on, HTTP 404 = off
gh api repos/OWNER/REPO/vulnerability-alerts --silent && echo "alerts on"

# Dependabot security updates
gh api repos/OWNER/REPO/automated-security-fixes

# Private vulnerability reporting (public repositories)
gh api repos/OWNER/REPO/private-vulnerability-reporting

# Security configuration attached to the repository (empty = none)
gh api repos/OWNER/REPO/code-security-configuration

# Rulesets and classic branch protection of the default branch
gh api repos/OWNER/REPO/rulesets
gh api repos/OWNER/REPO/branches/main/protection

# Default GITHUB_TOKEN permissions (expected: "read")
gh api repos/OWNER/REPO/actions/permissions/workflow
```

Also check:

- [ ] `.github/dependabot.yml` exists, and every `directory` in it contains a manifest.
- [ ] The **Insights → Dependency graph → Dependabot** tab shows no configuration error.
- [ ] Each workflow file sets `permissions:`.
- [ ] `CODEOWNERS` names teams or users that exist and have write access.

## References

- [About the dependabot.yml file](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file)
- [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [Supported ecosystems and repositories](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [Applying a custom security configuration](https://docs.github.com/en/code-security/how-tos/secure-at-scale/configure-organization-security/establish-complete-coverage/apply-custom-configuration)
- [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)
- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [REST API endpoints for repositories](https://docs.github.com/en/rest/repos/repos)
