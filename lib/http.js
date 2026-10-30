import {
  clearCredential,
  ConfigError,
  describeCredential,
  readConfigSnapshot,
  setCredential,
  writeConfigValues,
} from './config.js'

const API_PREFIX = '/dsh-plugin-sync/api/v2'
const MAX_BODY_BYTES = 64 * 1024

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function sendError(response, status, code, message) {
  sendJson(response, status, { ok: false, error: { code, message } })
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

async function readJson(request) {
  const length = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large')
    error.status = 413
    throw error
  }
  let total = 0
  const chunks = []
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (total === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object')
    }
    return parsed
  } catch (error) {
    const failure = new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`)
    failure.status = 400
    throw failure
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function methodGuard(request, response, allowed) {
  if (allowed.includes(request.method)) return true
  response.writeHead(405, { allow: allowed.join(', ') })
  response.end()
  return false
}

export function registerApiRoutes({ ctx, runtime, config }) {
  const routes = [
    {
      name: 'status',
      methods: ['GET'],
      path: `${API_PREFIX}/status`,
      handle: async (_request, response) => {
        const status = await runtime.status()
        const credential = await describeCredential(ctx)
        if (credential.available) {
          status.token = {
            configured: credential.configured,
            source: credential.source,
            writable: credential.writable,
          }
        }
        const configSnapshot = readConfigSnapshot(ctx, config)
        sendJson(response, 200, {
          ...status,
          configSnapshot,
        })
      },
    },
    {
      name: 'config',
      methods: ['GET', 'POST'],
      path: `${API_PREFIX}/config`,
      handle: async (request, response) => {
        if (request.method === 'GET') {
          sendJson(response, 200, {
            ok: true,
            config: readConfigSnapshot(ctx, config),
            credential: await describeCredential(ctx),
          })
          return
        }
        const body = await readJson(request)
        if (!isRecord(body.values)) {
          sendError(response, 400, 'invalid-request', 'values must be an object')
          return
        }
        if (body.clearToken === true) {
          await clearCredential(ctx)
        } else if (typeof body.token === 'string' && body.token.trim() !== '') {
          await setCredential(ctx, body.token)
        }
        const values = await writeConfigValues(ctx, body.values, config)
        sendJson(response, 200, {
          ok: true,
          values,
          credential: await describeCredential(ctx),
        })
      },
    },
    {
      name: 'jobs',
      methods: ['GET'],
      path: `${API_PREFIX}/jobs`,
      handle: async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const jobId = url.searchParams.get('id')
        if (typeof jobId === 'string' && jobId !== '') {
          const job = runtime.job(jobId)
          if (job === null) {
            sendError(response, 404, 'job-not-found', `No job with id ${jobId}`)
            return
          }
          sendJson(response, 200, { ok: true, job })
          return
        }
        const kind = url.searchParams.get('kind')
        sendJson(response, 200, {
          ok: true,
          latest: runtime.latestJob(kind === null ? undefined : kind),
          jobs: runtime.jobs(kind === null ? undefined : kind),
        })
      },
    },
    {
      name: 'latest',
      methods: ['GET', 'POST'],
      path: `${API_PREFIX}/latest`,
      handle: async (request, response) => {
        if (request.method === 'GET') {
          // `cached=1` restores the last result without re-querying the registries,
          // so a page that remounts mid-work does not start a second check.
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          if (url.searchParams.get('cached') === '1') {
            const cached = runtime.cachedLatest()
            sendJson(response, 200, cached === null
              ? { ok: true, cached: false, entries: [], counts: { entries: 0, outdated: 0, current: 0, unsupported: 0, failed: 0 } }
              : { ok: true, cached: true, ...cached })
            return
          }
          const result = await runtime.checkLatest()
          sendJson(response, 200, result)
          return
        }
        const body = await readJson(request)
        if (!Array.isArray(body.names)) {
          sendError(response, 400, 'invalid-request', 'names must be an array of bundle names')
          return
        }
        const result = await runtime.applyLatest(body.names)
        sendJson(response, 200, result)
      },
    },
    {
      name: 'preview',
      methods: ['POST'],
      path: `${API_PREFIX}/preview`,
      handle: async (_request, response) => {
        const preview = await runtime.preview()
        sendJson(response, 200, preview)
      },
    },
    {
      name: 'apply',
      methods: ['POST'],
      path: `${API_PREFIX}/apply`,
      handle: async (request, response) => {
        const body = await readJson(request)
        if (typeof body.previewId !== 'string' || body.previewId === '') {
          sendError(response, 400, 'invalid-request', 'previewId is required')
          return
        }
        if (!isRecord(body.selections)) {
          sendError(response, 400, 'invalid-request', 'selections must be an object')
          return
        }
        const result = await runtime.apply(body.previewId, body.selections)
        sendJson(response, 200, result)
      },
    },
    {
      name: 'push',
      methods: ['POST'],
      path: `${API_PREFIX}/push`,
      handle: async (request, response) => {
        const body = await readJson(request)
        if (body.confirm !== true) {
          sendError(response, 400, 'confirm-required', 'Set confirm=true to update the remote manifest')
          return
        }
        const result = await runtime.push()
        sendJson(response, 200, result)
      },
    },
  ]

  const mount = (hostCtx) => {
    hostCtx.effect(() => {
      const disposers = []
      for (const route of routes) {
        disposers.push(hostCtx.webServer.register({
          kind: 'exact',
          path: route.path,
          handler: async (request, response) => {
            if (!sameOrigin(request)) {
              sendError(response, 403, 'cross-origin', 'Cross-origin requests are not allowed')
              return
            }
            if (!methodGuard(request, response, route.methods)) return
            try {
              await route.handle(request, response)
            } catch (error) {
              if (error instanceof ConfigError) {
                sendError(response, 400, error.code, error.message)
                return
              }
              const status = typeof error?.status === 'number' ? error.status : 500
              const code = typeof error?.code === 'string' ? error.code : 'operation-failed'
              const message = error instanceof Error ? error.message : String(error)
              sendError(response, status, code, message)
            }
          },
        }))
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'plugin-sync: API routes')
  }

  const existing = ctx.get('webServer')
  if (existing !== undefined && existing !== null) {
    mount({ webServer: existing, effect: ctx.effect.bind(ctx) })
  } else {
    ctx.inject(['webServer'], mount)
  }
}
