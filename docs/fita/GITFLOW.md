# Fita Harness — gitflow

Four lanes, one rule: **`dev` is where we work, `beta` is what we offer upstream, `master`
is somebody else's branch, `PR-*` is a review, not a home.**

| lane | branch | who writes | what lands there | goes upstream? |
| --- | --- | --- | --- | --- |
| upstream | `master` | upstream only | fast-forward mirror of `anywhere-labs/dsh-desktop` | — |
| beta | `beta` | us | isolated generalizable fixes, cherry-picked out of `dev` | yes, one at a time |
| dev | `dev` (default) | us | everything: product opinion, channels, tooling, fork-only config | no |
| PR | `PR-<number>-<slug>` | us | the exact commit set a review is about | only as that review |

## The flow

```
upstream master ──ff──> master
                          │
                          ├──cherry-pick──> beta ──(review)──> upstream PR ──> upstream master
                          │                     ▲
                          └──merge/sync─────────┴──────────> dev ──> releases on the dev channel
                                                              │
                                                              └──PR-<number>-<slug> ──> review builds
```

1. **Work happens on `dev`.** Divergence is expected and wanted: the channel registry,
   the installer, the header branding, the pipelines, the marketplace source and any
   product opinion live here and are never proposed upstream as a whole.
2. **A fix becomes upstream-bound when it is generalizable without our context.**
   It is cherry-picked from `dev` to `beta` as an isolated commit set. `beta` is the
   staging area for those commit sets; nothing else lands there.
3. **A review is opened from a `PR-<number>-<slug>` branch cut from `master`** (not from
   `dev`), so the diff is exactly the generalizable change. The branch name carries the
   upstream review number once it exists.
4. **Upstream reconciliation** pulls `master` into `dev` regularly. It is repetitive
   rather than deterministic — conflicts are expected where we patched the same files —
   so it is a scheduled, documented workflow (see `WORKFLOWS.md`), not an improvised one.
5. **Never open an upstream review unprompted.** Reviews are a decision, taken lane by
   lane from `beta`; until then the work stays in our fork.

## What qualifies for `beta`

| qualifies | does not qualify |
| --- | --- |
| a defect reproducible on a stock upstream build | channel names, colours, branding |
| a fix that makes sense with our fork absent | our installer, our pipelines |
| a patch with a test that fails before it | preferences about what to ship at all |
| an asar/packaging defect in a vendored package | workarounds for our own environment |

## Agents working in this gitflow

- **Read this file before touching a branch.** An agent's lane is its contract: it
  commits to `dev` unless it was explicitly pointed at `beta` or a `PR-*` branch.
- **One concern per commit.** A commit that mixes a generalizable fix with fork-only
  polish cannot be cherry-picked, and that is the only currency this flow trades in.
- **A fix is not "done" until it is described as a cherry-pick candidate** — the
  generalizable slice written down, so `beta` can take it later without archaeology.
- **Planning lives in the fork's GitHub Projects**, one item per task, each carrying its
  lane, its target (dev / beta / upstream) and its upstream-eligibility. The board is the
  readable form of this document; the document is the contract behind the board.
- **Registration is part of the work.** A pipeline, a channel, an installer mode or a
  workflow that is not written down here does not exist for the next agent.
