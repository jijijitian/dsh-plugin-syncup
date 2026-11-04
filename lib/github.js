import { readFileSync } from 'node:fs'
import { emptyManifest, normalizeManifest } from './manifest.js'
import { expandHome } from './spec.js'

const USER_AGENT = 'dsh-plugin-syncup/2.2.0'
const MAX_MANIFEST_BYTES = 1_000_000

export class GitHubError extends Error {
  constructor(message, { code = 'github-error', status = undefined, retryable = false, body = undefined } = {}) {
    super(message)
    this.name = 'GitHubError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.body = body
  }
}

export function resolveToken({ token = '', tokenEnv = 'GITHUB_TOKEN', tokenFile = '', env = process.env } = {}) {
  if (typeof token === 'string' && token.trim() !== '') {
    return { token: token.trim(), source: 'config' }
  }
  if (typeof tokenEnv === 'string' && tokenEnv.trim() !== '') {
    const value = env[tokenEnv.trim()]
    if (typeof value === 'string' && value.trim() !== '') {
      return { token: value.trim(), source: `env:${tokenEnv.trim()}` }
    }
  }
  const file = expandHome(tokenFile)
  if (file !== '') {
    try {
      const value = readFileSync(file, 'utf8').trim()
      if (value !== '') return { token: value, source: 'file' }
    } catch {
      return { token: '', source: null }
    }
  }
  return { token: '', source: null }
}

function parseApiBase(value) {
  const fallback = 'https://api.github.com'
  if (typeof value !== 'string' || value.trim() === '') return fallback
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return fallback
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function errorMessageFromBody(body, status) {
  if (typeof body === 'string' && body.trim() !== '') return body.trim().slice(0, 500)
  if (body !== null && typeof body === 'object' && typeof body.message === 'string') {
    const details = Array.isArray(body.errors)
      ? body.errors
          .map((item) => (typeof item === 'string' ? item : item?.message ?? item?.code ?? ''))
          .filter((item) => typeof item === 'string' && item !== '')
      : []
    const suffix = details.length === 0 ? '' : ` (${details.join('; ')})`
    return `${body.message}${suffix}`.slice(0, 500)
  }
  return `GitHub API request failed with status ${status}`
}

function gistVersion(gist) {
  if (gist !== null && typeof gist === 'object' && Array.isArray(gist.history)) {
    const version = gist.history[0]?.version
    if (typeof version === 'string' && version !== '') return version
  }
  return typeof gist?.updated_at === 'string' ? gist.updated_at : null
}

function gistSummary(gist) {
  return {
    gistId: typeof gist?.id === 'string' ? gist.id : null,
    htmlUrl: typeof gist?.html_url === 'string' ? gist.html_url : null,
    description: typeof gist?.description === 'string' ? gist.description : null,
    updatedAt: typeof gist?.updated_at === 'string' ? gist.updated_at : null,
    version: gistVersion(gist),
    public: gist?.public === true,
  }
}

function gistFileName(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'dsh-plugins.json'
}

export function createGitHubClient({
  apiBaseUrl = 'https://api.github.com',
  token = '',
  timeoutMs = 20_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new GitHubError('fetch is unavailable in this Host', { code: 'no-fetch' })
  const base = parseApiBase(apiBaseUrl)

  async function requestUrl(url, { method = 'GET', body, headers = {}, allow404 = false, extraSignal } = {}) {
    const requestHeaders = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
      ...headers,
    }
    if (token !== '') requestHeaders.authorization = `Bearer ${token}`
    if (body !== undefined) requestHeaders['content-type'] = 'application/json'
    const signals = [AbortSignal.timeout(timeoutMs)]
    for (const candidate of [extraSignal]) {
      if (candidate !== undefined) signals.push(candidate)
    }
    const combined = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (combined.aborted) {
        throw new GitHubError('GitHub request was aborted or timed out', { code: 'timeout', retryable: true })
      }
      throw new GitHubError(`GitHub request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: 'network',
        retryable: true,
      })
    }
    const raw = await response.text()
    let parsed = null
    if (raw.trim() !== '') {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }
    if (response.ok) return { status: response.status, body: parsed, headers: response.headers }
    if (response.status === 404 && allow404) return null
    if (response.status === 409 || response.status === 412) {
      throw new GitHubError(errorMessageFromBody(parsed, response.status), {
        code: 'conflict',
        status: response.status,
        retryable: true,
        body: parsed,
      })
    }
    const retryable = response.status === 429 || response.status >= 500
    const code = response.status === 401 || response.status === 403
      ? 'auth'
      : response.status === 404
        ? 'not-found'
        : retryable
          ? 'server'
          : 'github-error'
    throw new GitHubError(errorMessageFromBody(parsed, response.status), {
      code,
      status: response.status,
      retryable,
      body: parsed,
    })
  }

  async function readGist(gistId, fileName = 'dsh-plugins.json', { extraSignal } = {}) {
    if (typeof gistId !== 'string' || gistId === '') throw new GitHubError('A Gist id is required', { code: 'invalid-gist' })
    const name = gistFileName(fileName)
    const response = await requestUrl(`${base}/gists/${encodeURIComponent(gistId)}`, {
      allow404: true,
      extraSignal,
    })
    if (response === null) {
      throw new GitHubError(`Gist ${gistId} was not found or is not accessible with this token`, { code: 'not-found' })
    }
    const gist = response.body
    const summary = gistSummary(gist)
    const file = gist !== null && typeof gist === 'object' && gist.files !== null && typeof gist.files === 'object'
      ? gist.files[name]
      : undefined
    if (file === undefined || file === null) {
      return {
        ...summary,
        exists: false,
        fileName: name,
        manifest: emptyManifest(),
        etag: response.headers.get('etag'),
      }
    }
    let text = typeof file.content === 'string' ? file.content : ''
    if (file.truncated === true || (text === '' && typeof file.raw_url === 'string')) {
      if (typeof file.raw_url !== 'string' || file.raw_url === '') {
        throw new GitHubError(`Gist file ${name} is truncated and has no raw URL`, { code: 'invalid-response' })
      }
      const raw = await requestUrl(file.raw_url, {
        headers: { accept: 'text/plain' },
        extraSignal,
      })
      text = typeof raw.body === 'string'
        ? raw.body
        : raw.body === null || raw.body === undefined ? '' : JSON.stringify(raw.body)
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new GitHubError(`Gist manifest ${name} is larger than 1 MB`, { code: 'manifest-too-large' })
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new GitHubError(`Gist file ${name} is not valid JSON`, { code: 'invalid-manifest' })
    }
    const manifest = normalizeManifest(parsed, { source: `gist ${gistId}/${name}`, requireShape: true })
    return {
      ...summary,
      exists: true,
      fileName: name,
      manifest,
      etag: response.headers.get('etag'),
    }
  }

  async function listGists({ extraSignal } = {}) {
    const response = await requestUrl(`${base}/gists?per_page=100`, { extraSignal })
    if (!Array.isArray(response.body)) {
      throw new GitHubError('GitHub did not return a Gist list', { code: 'invalid-response' })
    }
    return response.body.map(gistSummary)
  }

  async function createGist({ description = 'DSH plugin inventory', fileName = 'dsh-plugins.json', manifest, extraSignal } = {}) {
    if (token === '') {
      throw new GitHubError('A GitHub token is required to create a Gist', { code: 'no-token' })
    }
    const name = gistFileName(fileName)
    const text = `${JSON.stringify(manifest, null, 2)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new GitHubError('Manifest is larger than 1 MB', { code: 'manifest-too-large' })
    }
    const response = await requestUrl(`${base}/gists`, {
      method: 'POST',
      body: {
        description,
        public: false,
        files: { [name]: { content: text } },
      },
      extraSignal,
    })
    return { ...gistSummary(response.body), fileName: name }
  }

  /**
   * Update a Gist's manifest file.
   *
   * GitHub rejects conditional headers on this endpoint ("Conditional request
   * headers are not allowed in unsafe requests unless supported by the
   * endpoint"), so conflict detection uses the read-then-merge retry in the
   * caller instead of If-Match. `expectedVersion` is only used to detect that
   * someone else changed the Gist between the caller's read and this write.
   */
  async function updateGist(gistId, {
    description = 'DSH plugin inventory',
    fileName = 'dsh-plugins.json',
    manifest,
    expectedVersion = null,
    extraSignal,
  } = {}) {
    if (token === '') {
      throw new GitHubError('A GitHub token is required to update a Gist', { code: 'no-token' })
    }
    const name = gistFileName(fileName)
    const text = `${JSON.stringify(manifest, null, 2)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
      throw new GitHubError('Manifest is larger than 1 MB', { code: 'manifest-too-large' })
    }
    if (expectedVersion !== null) {
      const current = await requestUrl(`${base}/gists/${encodeURIComponent(gistId)}`, { extraSignal })
      const currentVersion = gistVersion(current.body)
      if (currentVersion !== null && currentVersion !== expectedVersion) {
        throw new GitHubError('The Gist changed after it was read; retry the update', {
          code: 'conflict',
          status: 412,
          retryable: true,
        })
      }
    }
    const response = await requestUrl(`${base}/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      body: {
        description,
        files: { [name]: { content: text } },
      },
      extraSignal,
    })
    return { ...gistSummary(response.body), fileName: name }
  }

  return {
    apiBaseUrl: base,
    readGist,
    listGists,
    createGist,
    updateGist,
  }
}
