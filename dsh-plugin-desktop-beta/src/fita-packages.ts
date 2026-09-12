/**
 * Which of our packages may be published, and to where.
 *
 * GitHub Packages only serves packages named for their owner, so the rule is stated once and
 * tested on its own: a package is ours to publish when it is named `@aleffita/…`, is not
 * private, and points `publishConfig.registry` at GitHub Packages. A scoped package that fails
 * either condition is an error rather than a skip — publishing something that points at npm is
 * exactly the mistake this exists to prevent.
 */

/** The scope every package we publish must carry. */
export const PUBLISH_SCOPE = '@aleffita/'
/** Registry GitHub Packages serves npm packages from. */
export const GITHUB_PACKAGES_REGISTRY = 'https://npm.pkg.github.com'

/** One workspace package, as the publisher sees it. */
export interface PublishCandidate {
  /** Package name. */
  readonly name: string
  /** Version that would be published. */
  readonly version: string
  /** Workspace directory, relative to the repository root. */
  readonly directory: string
  /** Registry its publishConfig names, when it has one. */
  readonly registry?: string
  /** Whether the manifest marks the package private. */
  readonly private: boolean
}

/** What a run decided, before anything is published. */
export type PublishPlan =
  | { readonly status: 'nothing'; readonly reason: string }
  | { readonly status: 'publish'; readonly packages: readonly PublishCandidate[] }
  | { readonly status: 'invalid'; readonly problems: readonly string[] }

/**
 * Decide what this repository would publish, and whether it is configured to.
 * @param candidates - every workspace package.
 * @returns what to publish, or why nothing can be.
 */
export function planPublish(candidates: readonly PublishCandidate[]): PublishPlan {
  const scoped = candidates.filter(candidate => candidate.name.startsWith(PUBLISH_SCOPE))
  if (scoped.length === 0) {
    return { status: 'nothing', reason: `no package is named ${PUBLISH_SCOPE}…` }
  }
  const problems: string[] = []
  const publishable: PublishCandidate[] = []
  for (const candidate of scoped) {
    if (candidate.private) {
      problems.push(`${candidate.name} is scoped but private, so it cannot be published`)
      continue
    }
    if (candidate.registry !== GITHUB_PACKAGES_REGISTRY) {
      problems.push(`${candidate.name} publishes to ${candidate.registry ?? 'no registry'}, not ${GITHUB_PACKAGES_REGISTRY}`)
      continue
    }
    publishable.push(candidate)
  }
  if (problems.length > 0) return { status: 'invalid', problems }
  if (publishable.length === 0) return { status: 'nothing', reason: 'every scoped package is private' }
  return { status: 'publish', packages: publishable }
}
