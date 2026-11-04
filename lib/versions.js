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

/**
 * A version carrying build metadata such as `2.0.0+win` or `1.0.0+linux-x64`.
 *
 * Semver treats `+…` as build metadata, so `2.0.0+win` compares equal to
 * `2.0.0`. Repositories use it for per-platform builds, which are not the
 * project's newest release and can be older than the current line — one real
 * repo shipped `v2.0.0+win` a month before `v0.4.2`. They never win the
 * newest-release pick.
 */
export function isPlatformVersion(value) {
  const text = typeof value === 'string' ? value.trim().replace(/^v/i, '') : ''
  return text.includes('+')
}

/** The moment a release went public (or a tag was created), as epoch ms. */
function releaseTime(entry) {
  for (const key of ['published_at', 'created_at', 'updated_at']) {
    const value = entry?.[key]
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return Date.parse(value)
  }
  return null
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
  onReleaseFallback = null,
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
   * Two independent ideas of "newest" exist here and the caller chooses:
   *
   *   - by version (`prefer: 'version'`, the default): highest semver.
   *   - by release date (`prefer: 'date'`): the release published last. A repo can
   *     publish a high-numbered build early and then continue a lower line, so the
   *     highest number is not the newest code — `v2.0.0+win` (2026-09) versus
   *     `v0.4.2` (2026-10) is exactly that case.
   *
   * Drafts are never installable. A version is treated as a prerelease when GitHub
   * flags it or when the version string itself carries a prerelease suffix, so a
   * mistimed flag cannot hide a real stable release and a `-beta` tag cannot slip
   * through. Platform builds (`+win`) are always skipped.
   */
  function newestRelease(rows, { includePrerelease = false, prefer = 'version', includePlatform = false } = {}) {
    let best = null
    for (const entry of Array.isArray(rows) ? rows : []) {
      if (entry?.draft === true) continue
      const raw = typeof entry?.tag_name === 'string' ? entry.tag_name : ''
      const version = cleanVersion(raw)
      if (version === '' || !/^\d/.test(version)) continue
      if (includePlatform === false && isPlatformVersion(raw)) continue
      const flagged = entry?.prerelease === true
      if (includePrerelease === false && (flagged || isPrereleaseVersion(version))) continue

      const at = releaseTime(entry)
      if (best === null) {
        best = { latest: version, latestTag: raw === '' ? `v${version}` : raw, prerelease: flagged, publishedAt: at }
        continue
      }
      // Date ordering needs timestamps on both sides. When either is missing
      // (a tag list carries none), fall back to the version so it still resolves.
      const newer = prefer === 'date' && at !== null && best.publishedAt !== null
        ? at > best.publishedAt
        : compareVersions(version, best.latest) > 0
      if (newer) {
        best = { latest: version, latestTag: raw === '' ? `v${version}` : raw, prerelease: flagged, publishedAt: at }
      }
    }
    return best
  }

  /**
   * Read a repository's newest installable version.
   *
   * A git tag is not a release, and the two lists routinely disagree: a repo can
   * carry `v5.18.0` with no matching release, or platform tags like `v2.0.0+win`
   * that are far ahead of the newest published release. Releases are therefore
   * authoritative.
   *
   * The tag fallback runs only when the release list was fetched successfully and
   * is genuinely empty. A failed request (rate limit, network, auth) must NOT
   * look like "no releases" — that would silently downgrade the answer to a tag,
   * which is exactly the bug this guards against. Such a failure is reported as an
   * error and the caller keeps whatever the other source said.
   */
  async function gitHubLatestRef(target, upstream, { includePrerelease = false, prefer = 'date' } = {}) {
    const repoUrl = `${githubBaseUrl}/repos/${target.owner}/${target.repo}`

    const releases = await getJson(`${repoUrl}/releases?per_page=100`, githubHeaders(), upstream)
    if (releases.ok && Array.isArray(releases.body)) {
      const best = newestRelease(releases.body, { includePrerelease, prefer })
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
          ...(best.publishedAt === null
            ? {}
            : { publishedAt: new Date(best.publishedAt).toISOString() }),
        }
      }
      // The release list was read and holds no stable release. Only now may a
      // tag stand in for it.
      if (releases.body.length > 0 && typeof onReleaseFallback === 'function') {
        onReleaseFallback(target, { reason: 'no-stable-release' })
      }
    } else if (releases.ok === false) {
      // Do not silently fall back to tags on a failed read.
      return {
        source: 'github',
        latest: null,
        ok: false,
        code: releases.code ?? 'release-read-failed',
        ...(releases.status === undefined ? {} : { status: releases.status }),
      }
    }

    // No stable release exists: a tagged commit is still better than nothing.
    const tags = await getJson(`${repoUrl}/tags?per_page=100`, githubHeaders(), upstream)
    if (tags.ok && Array.isArray(tags.body)) {
      const rows = tags.body.map((item) => ({ tag_name: item?.name, prerelease: false }))
      const best = newestRelease(rows, { includePrerelease, prefer })
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
   * Ask both package channels what their newest installable version is.
   *
   * The automatic answer favors the newer of npm and the repository's newest
   * **release** (a tie stays on npm, which installs more reliably). That guess is
   * not always what the user wants — one channel can lead the other, and a
   * platform build can be newer than either — so each channel's own answer is
   * reported as `channels` for the page to offer as an explicit choice.
   */
  async function latestFor(spec, { upstream } = {}) {
    const npm = registryNameOf(spec)
    if (npm !== null) {
      const published = await npmLatest(npm.name, upstream)
      const repo = published.repository ?? null
      if (repo === null) {
        return {
          ...published,
          spec: spec.trim(),
          kind: 'npm',
          channels: { npm: published.latest ?? null, github: null },
        }
      }

      const fromGitHub = await gitHubLatestRef(repo, upstream)
      const npmVersion = cleanVersion(published.latest)
      const gitVersion = cleanVersion(fromGitHub.latest)
      const channels = { npm: published.latest ?? null, github: fromGitHub.latest ?? null }
      const githubInfo = {
        githubLatest: fromGitHub.latest,
        githubSource: fromGitHub.source,
        ...(fromGitHub.latestTag === undefined ? {} : { latestTag: fromGitHub.latestTag }),
        ...(fromGitHub.publishedAt === undefined ? {} : { githubPublishedAt: fromGitHub.publishedAt }),
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
          channels,
          ...githubInfo,
          ...(gitNewer && fromGitHub.sha ? { sha: fromGitHub.sha } : {}),
          ...(gitNewer && fromGitHub.publishedAt !== undefined ? { publishedAt: fromGitHub.publishedAt } : {}),
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
          channels,
          ...githubInfo,
          ...(fromGitHub.sha ? { sha: fromGitHub.sha } : {}),
          ...(fromGitHub.publishedAt === undefined ? {} : { publishedAt: fromGitHub.publishedAt }),
          ok: true,
        }
      }
      return {
        ...published,
        spec: spec.trim(),
        kind: 'npm',
        channels,
        ...(gitVersion === '' ? {} : githubInfo),
      }
    }
    const git = gitHubTargetOf(spec)
    if (git !== null) {
      const found = await gitHubLatestRef(git, upstream)
      return {
        ...found,
        spec: spec.trim(),
        kind: 'github',
        ref: git.ref,
        channels: { npm: null, github: found.latest ?? null },
      }
    }
    return {
      source: null,
      spec: typeof spec === 'string' ? spec.trim() : '',
      kind: 'other',
      latest: null,
      channels: { npm: null, github: null },
      ok: false,
      code: 'unsupported',
    }
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
        // Per-source versions and the winning source must survive this mapping:
        // the page needs them to offer npm and GitHub as separate choices, and
        // without them every channel option was disabled.
        ...(found.source === undefined ? {} : { source: found.source }),
        ...(found.channels === undefined ? {} : { channels: found.channels }),
        ...(found.repository === undefined ? {} : { repository: found.repository }),
        ...(found.publishedAt === undefined ? {} : { publishedAt: found.publishedAt }),
        ...(found.npmLatest === undefined ? {} : { npmLatest: found.npmLatest }),
        ...(found.githubLatest === undefined ? {} : { githubLatest: found.githubLatest }),
        ...(found.latestTag === undefined ? {} : { latestTag: found.latestTag }),
        ...(found.sha === undefined ? {} : { sha: found.sha }),
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
