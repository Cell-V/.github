# Adoption and override model

This document describes how each type of configuration in this repository reaches other organization repositories. Each type has one of these delivery models:

- **Inherited.** GitHub applies the file automatically when the target repository has no local version. No action is necessary.
- **Opt-in copy.** A maintainer copies the file into the target repository. Later changes here do not reach the copy.
- **Reference.** The target repository calls the file by reference. Later changes here reach the target, depending on the pinned ref.
- **Automation.** A script or workflow in this repository changes the target repository through the GitHub API.
- **Settings.** An administrator configures the setting in the GitHub UI or API. No file in this repository enforces it.

## Matrix

| Configuration | Location here | Delivery model | Local override | Notes |
| --- | --- | --- | --- | --- |
| Organization profile | `profile/README.md` | Shown on the organization page | Not applicable | It is not a default README for repositories. A members-only profile needs a separate private `.github-private` repository (out of scope). |
| Code of conduct | `CODE_OF_CONDUCT.md` | Inherited | A local `CODE_OF_CONDUCT.md` replaces it | |
| Contributing guide | `CONTRIBUTING.md` | Inherited | A local `CONTRIBUTING.md` replaces it | Put project-specific build and test steps in the local file. |
| Security policy | `SECURITY.md` | Inherited | A local `SECURITY.md` replaces it | Reporting guidance only. It does not turn on any security feature. See [Security features](#security-features). |
| Support guide | `SUPPORT.md` | Inherited | A local `SUPPORT.md` replaces it | |
| Funding | None | Inherited when present | A local `.github/FUNDING.yml` adds a **Sponsor** button to that repository | This repository has no `FUNDING.yml`, so no repository inherits a **Sponsor** button. If you add one, every repository without a local file shows it. |
| Issue forms and chooser | `.github/ISSUE_TEMPLATE/` | Inherited as **one set** | **Any** file in the local `.github/ISSUE_TEMPLATE/` replaces the **whole** set | No merge. A local `config.yml` alone also disables all inherited forms. |
| Pull request template | `.github/pull_request_template.md` | Inherited | A local PR template replaces it | |
| Workflow starters | `workflow-templates/` | Opt-in copy | Not applicable: the copy belongs to the target | Edits here do not update copies already adopted. |
| Reusable workflows | None yet | Reference (`uses: Cell-V/.github/.github/workflows/<file>.yml@<ref>`) | Caller chooses the ref | Public callers can only call reusable workflows in public repositories. |
| Labels | `.github/labels.yml` | Automation ([label sync](label-sync.md)) | Extra local labels are kept | Organization default labels in settings only seed **new** repositories. They do not update existing ones. |
| License | None | Not inherited | Not applicable | Add a `LICENSE` file to each repository. GitHub does not use a default license. |
| CODEOWNERS | `CODEOWNERS` (this repository only) | Not inherited | Not applicable | Add a `CODEOWNERS` file to each repository that needs one. It applies per branch. |
| Dependabot | `.github/dependabot.yml` (this repository only) | Not inherited | Not applicable | Add `.github/dependabot.yml` to each repository. See the [security baseline](security-baseline.md#example-dependabotyml). |
| Branch protection and rulesets | `.github/branch-protection.md` (documentation) | Settings | Not applicable | Availability depends on the plan and on repository visibility. See the [security baseline](security-baseline.md#plan-and-availability). |
| Security features | [docs/security-baseline.md](security-baseline.md) (documentation) | Settings | Not applicable | Dependency alerts, secret scanning, push protection, code scanning, and private vulnerability reporting. |
| Actions permissions | None | Settings | Not applicable | Default `GITHUB_TOKEN` permissions and allowed actions. |

## Inheritance rules

These rules apply to every inherited file in the matrix.

1. **Public hub.** GitHub uses default files only when this `.github` repository is public. The defaults then apply to organization repositories of any visibility.
2. **Local file wins.** GitHub looks for a local file in the target repository's root, `.github/`, or `docs/` folder. If a local file of the same type exists, GitHub ignores the default.
3. **Issue templates are all or nothing.** If the target repository has any file in `.github/ISSUE_TEMPLATE/`, GitHub ignores all inherited issue templates and the inherited `config.yml`.
4. **No copy.** Defaults are not copied into the target repository. They are not in clones, archives, or packages of the target repository.
5. **Relative links break.** An inherited file is rendered in the context of the target repository. Use absolute URLs to files in this repository.
6. **Form labels must exist in the target.** An inherited issue form applies its `labels` in the target repository. Run [label sync](label-sync.md) on the target before you depend on these labels.
7. **Defaults come from the default branch.** GitHub reads defaults only from the default branch of this repository. Content on other branches or in open pull requests is not live.

Verification results and open gaps are in [verification.md](verification.md).

## Adopting a workflow starter

1. In the target repository, open **Actions → New workflow**.
2. Find the starter in the section for the organization.
3. Select **Configure**. Check the file and commit it.

GitHub replaces `$default-branch` with the default branch of the target repository. After adoption, the workflow is a normal file in the target repository. Later changes to the starter here do not reach it.

## Security features

`SECURITY.md` tells reporters where to send a vulnerability. It does not turn on any feature. An administrator must turn on these features in organization or repository settings, or through security configurations:

- Private vulnerability reporting.
- Dependency graph, Dependabot alerts, and Dependabot security updates.
- Secret scanning and push protection.
- Code scanning.

Availability depends on the plan and on repository visibility. Some features for private repositories need paid GitHub Advanced Security products.

## Keep this repository public and clean

- Do not commit credentials, tokens, or keys. Supply credentials at run time through secrets.
- Do not commit private repository names, internal URLs, or private organization details. Keep internal inventories in a private location.

## References

- [Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
- [Configuring issue templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)
- [Customizing your organization's profile](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile)
- [Creating workflow templates](https://docs.github.com/en/actions/how-tos/reuse-automations/create-workflow-templates)
- [Reusing workflow configurations](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)
- [Managing default labels](https://docs.github.com/en/organizations/managing-organization-settings/managing-default-labels-for-repositories-in-your-organization)
- [About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- [About the dependabot.yml file](https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file)
- [Applying a custom security configuration](https://docs.github.com/en/code-security/how-tos/secure-at-scale/configure-organization-security/establish-complete-coverage/apply-custom-configuration)
