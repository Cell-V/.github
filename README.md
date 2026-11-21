# Cell-V `.github` repository

This repository is the configuration hub for the Cell-V GitHub organization. It holds three kinds of content:

1. **Inherited defaults.** GitHub applies these files automatically to organization repositories that do not have their own version.
2. **Opt-in templates.** A repository uses these only when a maintainer adopts them, for example a workflow starter.
3. **Explicit automation.** Scripts and workflows in this repository that act on other repositories, for example label synchronization.

This repository is **not** a general configuration inheritance mechanism. Most settings (Dependabot, CODEOWNERS, branch protection, security features, licenses) do not inherit. Each repository must adopt them. See [docs/adoption.md](docs/adoption.md) for the full adoption and override matrix.

> This repository must stay **public**. GitHub uses default community health files only from a public `.github` repository. Everything here is public: do not commit credentials, private repository names, internal URLs, or private organization details.

## Layout

| Path | Kind | Purpose |
| --- | --- | --- |
| `profile/README.md` | Organization profile | Public profile on the organization page. It is not a default README for other repositories. |
| `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md` | Inherited default | Fallback community health files. There is no `FUNDING.yml`, so no repository inherits a **Sponsor** button. |
| `.github/ISSUE_TEMPLATE/` | Inherited default | Fallback issue forms and issue chooser configuration. |
| `.github/pull_request_template.md` | Inherited default | Fallback pull request template. |
| `workflow-templates/` | Opt-in template | Workflow starters shown in each repository's **Actions → New workflow** page. |
| `.github/labels.yml` | Explicit automation | Canonical label catalog, the source of truth for label sync. |
| `.github/workflows/` | Automation for this repository | CI for this repository and the manually triggered label sync. |
| `.github/dependabot.yml` | Local to this repository | Dependabot version updates for this repository only. It does not inherit. |
| `.github/branch-protection.md` | Documentation | Branch protection rules for this repository. GitHub does not read it. |
| `CODEOWNERS` | Local to this repository | Review owners for this repository only. It does not inherit. |
| `scripts/` | Tooling | TypeScript validators, label sync, and tests. |
| `docs/` | Documentation | Adoption model and operational guides. |
| `.kiro/specs/` | Documentation | Original requirements, design, and task plan. |

## Commands

Requirements: Node.js 20 or later and npm.

```sh
npm ci              # install the locked dependencies
npm run typecheck   # type-check all scripts
npm test            # run unit and property tests
npm run validate    # validate labels, issue templates, FUNDING.yml (if present), and workflow templates
```

`npm run validate` needs no credentials and no network access. It exits with a non-zero status when a file is not valid.

Label sync needs credentials and explicit targets. It is a dry run unless you pass `--apply`. See [docs/label-sync.md](docs/label-sync.md).

Security controls come mostly from settings, not files. See [docs/security-baseline.md](docs/security-baseline.md).

## Change process

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Open a pull request. CI runs the commands above.
3. A change to an inherited default affects every repository that has no local version of that file. Describe the impact in the pull request.

## References

- [Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
- [Customizing your organization's profile](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile)
- [Creating workflow templates for your organization](https://docs.github.com/en/actions/how-tos/reuse-automations/create-workflow-templates)
