# Fita Harness

This fork is not a patch pile. It is our own distribution of the Harness desktop: our
channels, our installer, our pipelines and our product opinion — with a deliberate,
narrow path back upstream.

| document | what it fixes |
| --- | --- |
| `GITFLOW.md` | the four lanes, what qualifies for `beta`, how agents work in them |
| `CHANNELS.md` | the channel registry, the header identity, how each consumer reads it |
| `INSTALLS.md` | several builds on one machine, the install manager, CI/CD integration |
| `WORKFLOWS.md` | the pipelines, release rules, the scheduled upstream reconciliation |

`fita/channels.yml` is the contract all four describe. `scripts/fita/fita.mjs` is the
install manager. Planning lives in this fork's GitHub Projects: one item per task, each
carrying its lane, its target (`dev` / `beta` / upstream) and whether it is upstream-eligible.

## Program

Work is developed on `dev`. Nothing below is proposed upstream as a whole; the target column
is the only thing that may ever leave the fork, one isolated commit set at a time.

| epic | what it is | target | state |
| --- | --- | --- | --- |
| Channels and branding | channel registry, colour-coded `FITA` chip, version subtitle, `DSH Fita` product name | dev | landed |
| Per-channel packaging | stamp `productName`, `bundleId` and updater feed per channel so installs stand side by side | dev | landed |
| Install manager | `yarn fita install/use/status`, verified downloads, no manual copying | dev | landed |
| Update channels UI | in-app updater: check, choose channel, download, apply, report state | dev, later beta | next |
| GitHub Packages | publish our scoped plugin packages to our registry | dev | queued |
| Marketplace source | our fork as a marketplace source, with an `alefita's choices` bundle YAML consumed by onboarding and plugin settings | dev | queued |
| Planning plugin | kanban board in the Harness itself: backlog, epics/projects/tasks hierarchy, tags, provenance, related sessions, colours, agent skills; local storage first, git-authored, read-only without git | dev | queued |
| Feature flags | bundling and gating by domain, so a feature can be absent from a build; the natural successor once bundle splitting is on the table | dev, later beta | after 1–5 |
| i18n pass | translate the remaining Chinese-only surfaces | dev, upstream candidate | after 1–5 |
| Remote access as forward | remote clients see the same board and sessions | dev | after 1–5 |
| Sync | pluggable sync, Google Drive OAuth first, provenance preserved | dev | after 1–5 |
| Upstream reconciliation | scheduled merge of upstream `master` into `dev`, logged | dev | recipe documented |

"Landed" means the slice's evidence is in `docs/fita/INSTALLS.md` and `CHANNELS.md`, its e2e
runs locally, and it entered `dev` through a pull request. "Next" is the only slice that may
start before the previous one is merged.


## Non-negotiables

- Upstream reviews are opened only when we decide to, one `beta` commit set at a time;
  never automatically.
- A commit that mixes a generalizable fix with fork-only polish is a commit that can never
  leave the fork. Keep the concerns separate.
- Anything shipped is described here first. A workflow, channel or installer mode that is
  undocumented does not exist for the next agent.
