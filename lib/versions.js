import { isRecord, parseVersion, compareVersions } from './spec.js'

const DEFAULT_NPM = 'https://registry.npmjs.org'
const GITHUB_API = 'https://api.github.com'
const MAX_CHECK = 40

function timeoutSignal(ms, upstream) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms)
  const abort = () => controller.abort()
  if (upstream !== undefined && upstream !== null) {
    if (upstream.aborted) abort()
    else upstream.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      if (upstream !== undefined && upstream !== null) upstream.removeEventListener?.('abort', abort)
    },
  }
}

/** A registry-backed spec: `name` or `name@range`, never a git/tarball/local source. */
export function registryNameOf(spec) {
  if (typeof spec !== 'string') return null
  const text = spec.trim()
  if (text === '') return null
  if (/^(?:github:|git\+|git@|https?:|file:|link:|npm:|workspace:|\.{1,2}[\\/])/i.test(text)) return null
  const at = text.indexOf('@', text.startsWith('@') ? 1 : 0)
  const name = at === -1 ? text : text.slice(0, at)
  const range = at === -1 ? '' : text.slice(at + 1)
  if (name === '' || /\s/.test(name)) return null
  if (range !== '' && (/\s/.test(range) || range.includes(':'))) return null
  return { name, range }
}

/** `github:owner/repo#ref` → `{ owner, repo, ref }`. */
export function gitHubTargetOf(spec) {
  if (typeof spec !== 'string') return null
  const text = spec.trim()
  const match = /^github:([^/#\s]+)\/([^/#\s]+)(?:#([^\s]+))?$/i.exec(text)
    ?? /^git\+(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/#\s]+)\/([^/#\s]+?)(?:\.git)?(?:#([^\s]+))?$/i.exec(text)
  if (match === null) return null
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
    ref: match[3] ?? '',
  }
}

function cleanVersion(value) {
  if (typeof value !== 'string') return ''
  const text = value.trim().replace(/^v/i, '')
  return parseVersion(text) === null ? '' : text
}

/** A semver prerelease such as `5.18.0-beta.1` is not a stable release. */
export function isPrereleaseVersion(value) {
  const parsed = parseVersion(typeof value === 'string' ? value.trim().replace(/^v/i, '') : value)
  return parsed !== null && Array.isArray(parsed.prerelease) && parsed.prerelease.length > 0
}

/** Pick the newest version out of a list of tag names. */
export function newestTag(tags) {
  let best = ''
  for (const tag of Array.isArray(tags) ? tags : []) {
    const version = cleanVersion(typeof tag === 'string' ? tag : tag?.name)
    if (version === '' || !/^\d/.test(version)) continue
    if (best === '' || compareVersions(version, best) > 0) best = version
  }
  return best
}

/** `git+https://github.com/owner/repo.git` (or a bare owner/repo) → GitHub target. */
export function gitHubTargetOfRepository(repository) {
  const raw = typeof repository === 'string'
    ? repository
    : typeof repository === 'object' && repository !== null && typeof repository.url === 'string'
      ? repository.url
      : ''
  const text = raw.trim()
  if (text === '') return null
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(text)
  if (shorthand !== null) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, ''), ref: '' }
  const match = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com\/([^/#\s]+)\/([^/#\s]+?)(?:\.git)?(?:#([^\s]+))?$/i.exec(text)
  if (match === null) return null
  return { owner: match[1], repo: match[2].replace(/\.git$/i, ''), ref: match[3] ?? '' }
}

export function createVersionChecker({
  fetchImpl = globalThis.fetch,
  npmBaseUrl = DEFAULT_NPM,
  githubBaseUrl = GITHUB_API,
  token = '',
  timeoutMs = 15_000,
} = {}) {
  async function getJson(url, headers, upstream) {
    const { signal, dispose } = timeoutSignal(timeoutMs, upstream)
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-sync/2.8.0', ...headers },
        signal,
      })
      if (!response.ok) {
        const hint = response.status === 404 ? 'not-found' : response.status === 401 || response.status === 403 ? 'auth' : 'http'
        return { ok: false, code: hint, status: response.status }
      }
      return { ok: true, body: await response.json() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, code: /abort/i.test(message) ? 'timeout' : 'network', message }
    } finally {
      dispose()
    }
  }

  /**
   * Read the newest published version and, when the registry exposes it, the
   * source repository.
   *
   * The compact `install-v1` document omits `repository`, so a package that ships
   * newer git tags than npm releases cannot be judged from it. Full metadata is
   * asked for instead; the version fields are identical in both documents.
   */
  async function npmLatest(name, upstream) {
    const url = `${npmBaseUrl.replace(/\/+$/, '')}/${name.replace('/', '%2F')}`
    const result = await getJson(url, { accept: 'application/json' }, upstream)
    if (!result.ok) return { source: 'npm', name, latest: null, ...result }
    const latest = cleanVersion(result.body?.['dist-tags']?.latest)
    const repository = gitHubTargetOfRepository(
      result.body?.repository ?? result.body?.versions?.[result.body?.['dist-tags']?.latest]?.repository,
    )
    if (latest === '') {
      const versions = Object.keys(result.body?.versions ?? {})
      const best = newestTag(versions)
      return best === ''
        ? { source: 'npm', name, latest: null, ok: false, code: 'no-version', ...(repository === null ? {} : { repository }) }
        : { source: 'npm', name, latest: best, ok: true, ...(repository === null ? {} : { repository }) }
    }
    return {
      source: 'npm',
      name,
      latest,
      ok: true,
      distTags: result.body?.['dist-tags'] ?? {},
      ...(repository === null ? {} : { repository }),
    }
  }

  function githubHeaders() {
    const headers = { 'x-github-api-version': '2022-11-28' }
    if (token !== '') headers.authorization = `Bearer ${token}`
    return headers
  }

  /**
   * Pick the newest stable version out of GitHub release rows.
   *
   * Drafts are never installable. A version is treated as a prerelease when
   * either GitHub flags the release or the version string itself carries a
   * prerelease suffix, so a mistimed flag cannot hide a real stable release and
   * a `-beta` tag cannot slip through as stable.
   */
  function newestRelease(rows, { includePrerelease = false } = {}) {
    let best = null
    for (const entry of Array.isArray(rows) ? rows : []) {
      if (entry?.draft === true) continue
      const version = cleanVersion(entry?.tag_name)
      if (version === '' || !/^\d/.test(version)) continue
      const flagged = entry?.prerelease === true
      if (includePrerelease === false && (flagged || isPrereleaseVersion(version))) continue
      if (best === null || compareVersions(version, best.latest) > 0) {
        best = { latest: version, latestTag: entry?.tag_name ?? `v${version}`, prerelease: flagged }
      }
    }
    return best
  }

  /**
   * Read a repository's newest installable version.
   *
   * A git tag is not a release: maintainers push `v5.18.0` and publish the
   * matching release later (or never), so installing from the newest tag can
   * fail with ERR_PNPM_NO_MATCHING_VERSION. Releases are therefore authoritative;
   * tags are only consulted when a repository has published no stable release at
   * all, and that fallback is reported as `source: 'tag'` so callers can tell.
   */
  async function gitHubLatestRef(target, upstream, { includePrerelease = false } = {}) {
    const repoUrl = `${githubBaseUrl}/repos/${target.owner}/${target.repo}`

    const releases = await getJson(`${repoUrl}/releases?per_page=100`, githubHeaders(), upstream)
    if (releases.ok && Array.isArray(releases.body) && releases.body.length > 0) {
      const best = newestRelease(releases.body, { includePrerelease })
      if (best !== null) {
        const match = releases.body.find((item) => cleanVersion(item?.tag_name) === best.latest)
        return {
          source: 'release',
          latest: best.latest,
          latestTag: best.latestTag,
          sha: typeof match?.target_commitish === 'string' && /^[0-9a-f]{40}$/i.test(match.target_commitish)
            ? match.target_commitish
            : null,
          ok: true,
          prerelease: best.prerelease,
        }
      }
    }

    // No stable release yet: a tagged commit is still better than nothing.
    const tags = await getJson(`${repoUrl}/tags?per_page=100`, githubHeaders(), upstream)
    if (tags.ok && Array.isArray(tags.body)) {
      const rows = tags.body.map((item) => ({ tag_name: item?.name, prerelease: false }))
      const best = newestRelease(rows, { includePrerelease })
      if (best !== null) {
        const match = tags.body.find((item) => cleanVersion(item?.name) === best.latest)
        return {
          source: 'tag',
          latest: best.latest,
          latestTag: best.latestTag,
          sha: typeof match?.commit?.sha === 'string' ? match.commit.sha : null,
          ok: true,
        }
      }
    }

    // Nothing tag-shaped: report the default-branch head rather than guessing.
    const repo = await getJson(repoUrl, githubHeaders(), upstream)
    if (!repo.ok) return { source: 'github', latest: null, ...repo }
    const branch = typeof repo.body?.default_branch === 'string' ? repo.body.default_branch : 'main'
    const head = await getJson(`${repoUrl}/commits/${encodeURIComponent(branch)}`, githubHeaders(), upstream)
    if (!head.ok) return { source: 'github', latest: null, ...head }
    const sha = typeof head.body?.sha === 'string' ? head.body.sha : null
    return sha === null
      ? { source: 'github', latest: null, ok: false, code: 'no-version' }
      : { source: 'github', latest: sha.slice(0, 12), sha, branch, ok: true }
  }

  /**
   * Ask the package source what its newest installable version is.
   *
   * A `github:` spec has one obvious source. An npm spec does not: a maintainer
   * can publish a GitHub release before pushing the matching npm version, so
   * `dist-tags.latest` is not always the newest code. For an npm spec the
   * registry answer is compared with the repository's newest **release** and:
   *
   *   - GitHub strictly newer → take GitHub;
   *   - same version on both sides → keep npm, which installs more reliably;
   *   - npm newer or no repository → keep npm.
   */
  async function latestFor(spec, { upstream } = {}) {
    const npm = registryNameOf(spec)
    if (npm !== null) {
      const published = await npmLatest(npm.name, upstream)
      const repo = published.repository ?? null
      if (repo === null) return { ...published, spec: spec.trim(), kind: 'npm' }

      const fromGitHub = await gitHubLatestRef(repo, upstream)
      const npmVersion = cleanVersion(published.latest)
      const gitVersion = cleanVersion(fromGitHub.latest)
      const githubInfo = {
        githubLatest: fromGitHub.latest,
        githubSource: fromGitHub.source,
        ...(fromGitHub.latestTag === undefined ? {} : { latestTag: fromGitHub.latestTag }),
      }

      // Both sides comparable: only a strictly newer GitHub version wins, so a
      // tie stays on npm.
      if (npmVersion !== '' && gitVersion !== '') {
        const gitNewer = compareVersions(gitVersion, npmVersion) > 0
        return {
          ...published,
          spec: spec.trim(),
          kind: 'npm',
          source: gitNewer ? fromGitHub.source : 'npm',
          latest: gitNewer ? fromGitHub.latest : published.latest,
          npmLatest: published.latest,
          ...githubInfo,
          ...(gitNewer && fromGitHub.sha ? { sha: fromGitHub.sha } : {}),
          ok: true,
        }
      }
      // The repository answer is only a fallback when npm gave nothing usable.
      if (npmVersion === '' && gitVersion !== '') {
        return {
          ...published,
          spec: spec.trim(),
          kind: 'npm',
          source: fromGitHub.source,
          latest: fromGitHub.latest,
          npmLatest: published.latest,
          ...githubInfo,
          ...(fromGitHub.sha ? { sha: fromGitHub.sha } : {}),
          ok: true,
        }
      }
      return { ...published, spec: spec.trim(), kind: 'npm', ...(gitVersion === '' ? {} : githubInfo) }
    }
    const git = gitHubTargetOf(spec)
    if (git !== null) {
      const found = await gitHubLatestRef(git, upstream)
      return { ...found, spec: spec.trim(), kind: 'github', ref: git.ref }
    }
    return { source: null, spec: typeof spec === 'string' ? spec.trim() : '', kind: 'other', latest: null, ok: false, code: 'unsupported' }
  }

  async function checkAll(entries, { upstream } = {}) {
    const items = Array.isArray(entries) ? entries.slice(0, MAX_CHECK) : []
    const results = []
    for (const item of items) {
      if (upstream?.aborted === true) break
      const found = await latestFor(item.spec, { upstream })
      const current = cleanVersion(item.version)
      const latestVersion = cleanVersion(found.latest)
      const comparable = current !== '' && latestVersion !== ''
      results.push({
        name: item.name,
        spec: found.spec,
        kind: found.kind,
        current,
        latest: found.latest,
        ...(found.ok === false ? { error: found.code ?? 'lookup-failed' } : {}),
        ...(comparable
          ? { outdated: compareVersions(latestVersion, current) > 0 }
          : found.sha !== undefined && typeof item.version === 'string' && found.sha !== null
            ? { outdated: !found.sha.startsWith(item.version) && item.version.length < 40 }
            : {}),
        ...(found.distTags === undefined ? {} : { distTags: found.distTags }),
      })
    }
    return results
  }

  return { latestFor, checkAll }
}

export function isRegistrySpec(spec) {
  return isRecord({ spec }) && registryNameOf(spec) !== null
}
