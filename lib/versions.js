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

  async function gitHubLatestRef(target, upstream) {
    const headers = { 'x-github-api-version': '2022-11-28' }
    if (token !== '') headers.authorization = `Bearer ${token}`
    const repoUrl = `${githubBaseUrl}/repos/${target.owner}/${target.repo}`
    const tagsUrl = `${repoUrl}/tags?per_page=100`

    const tags = await getJson(tagsUrl, headers, upstream)
    if (tags.ok && Array.isArray(tags.body)) {
      const names = tags.body.map((item) => item?.name).filter((item) => typeof item === 'string')
      const best = newestTag(names)
      if (best !== '') {
        const match = tags.body.find((item) => cleanVersion(item?.name) === best)
        return {
          source: 'github',
          latest: best,
          latestTag: match?.name ?? best,
          sha: typeof match?.commit?.sha === 'string' ? match.commit.sha : null,
          ok: true,
        }
      }
    }

    // No usable tags: fall back to the default-branch head.
    const repo = await getJson(repoUrl, headers, upstream)
    if (!repo.ok) return { source: 'github', latest: null, ...repo }
    const branch = typeof repo.body?.default_branch === 'string' ? repo.body.default_branch : 'main'
    const head = await getJson(`${repoUrl}/commits/${encodeURIComponent(branch)}`, headers, upstream)
    if (!head.ok) return { source: 'github', latest: null, ...head }
    const sha = typeof head.body?.sha === 'string' ? head.body.sha : null
    return sha === null
      ? { source: 'github', latest: null, ok: false, code: 'no-version' }
      : { source: 'github', latest: sha.slice(0, 12), sha, branch, ok: true }
  }

  /**
   * Ask the package source what its newest release is.
   *
   * A `github:` spec has one obvious source. An npm spec does not: a maintainer
   * can tag a release in git before publishing it to the registry, so npm's
   * `dist-tags.latest` is not always the newest code. For an npm spec the registry
   * answer is combined with the GitHub tags of the repository named in the
   * package metadata, and the higher version wins.
   */
  async function latestFor(spec, { upstream } = {}) {
    const npm = registryNameOf(spec)
    if (npm !== null) {
      const published = await npmLatest(npm.name, upstream)
      const repo = published.repository ?? null
      if (repo === null) return { ...published, spec: spec.trim(), kind: 'npm' }

      const tagged = await gitHubLatestRef(repo, upstream)
      const npmVersion = cleanVersion(published.latest)
      const gitVersion = cleanVersion(tagged.latest)
      // Both sides comparable: keep the newer one and report both for the UI.
      if (npmVersion !== '' && gitVersion !== '') {
        const gitNewer = compareVersions(gitVersion, npmVersion) > 0
        return {
          ...published,
          spec: spec.trim(),
          kind: 'npm',
          source: gitNewer ? 'github' : 'npm',
          latest: gitNewer ? tagged.latest : published.latest,
          npmLatest: published.latest,
          githubLatest: tagged.latest,
          ...(gitNewer ? { latestTag: tagged.latestTag, sha: tagged.sha } : {}),
          ok: true,
        }
      }
      // The repository answer is only a fallback when npm gave nothing usable.
      if (npmVersion === '' && gitVersion !== '') {
        return {
          ...published,
          spec: spec.trim(),
          kind: 'npm',
          source: 'github',
          latest: tagged.latest,
          npmLatest: published.latest,
          githubLatest: tagged.latest,
          latestTag: tagged.latestTag,
          sha: tagged.sha,
          ok: true,
        }
      }
      return { ...published, spec: spec.trim(), kind: 'npm', ...(gitVersion === '' ? {} : { githubLatest: tagged.latest }) }
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
