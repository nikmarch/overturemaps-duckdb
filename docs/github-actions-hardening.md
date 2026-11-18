# GitHub Actions hardening checklist

This repository was reviewed after the November 2026 `wfx-loot` GitHub Actions secret-stealer campaign.

## What this PR does

- Keeps the workflow token least-privilege by declaring explicit `permissions:` in workflow files.
- Documents the manual repository settings that cannot be safely enforced by a pull request.
- Keeps deployment/cloud secrets limited to deploy or cleanup paths instead of broad CI defaults.
- For PR workflows that touch Cloudflare or GitHub comments, same-repository PR guards are used where applicable so fork PRs do not request deployment secrets.

Workflows in this repo: 2.

## Manual settings for Nik

After merging this PR, check the repository settings in GitHub:

1. Go to **Settings → Actions → General → Workflow permissions**.
2. Select **Read repository contents permission** as the default `GITHUB_TOKEN` permission.
3. Leave **Allow GitHub Actions to create and approve pull requests** disabled unless a workflow explicitly needs it.
4. For private repositories, keep fork pull-request workflows from receiving repository secrets or write tokens.
5. Keep cloud provider secrets scoped to the minimum deployment permissions needed for this repo.

## If a suspicious workflow appears

Do not run it. Look for the incident indicators from the Aikido advisory:

- branch `wfx-docs` or `chore/[a-z0-9]{8}`
- PR title `docs: dependency audit notes`
- commits such as `ci: refresh build cache`, `chore: add ci helper`, or `chore: add dependency audit workflow`
- workflow/env markers `WF_CALLBACK`, `WF_CTOKEN`, `WFX-BEGIN`, or `wfx-loot`
- callbacks to `194.150.166.244:8080` or `18.143.168.96:8080`

If any of those ran in this repo, assume every secret available to that workflow was exposed and rotate those secrets before trusting CI again.
