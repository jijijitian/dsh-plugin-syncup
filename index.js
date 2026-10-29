import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeConfig } from './lib/config.js'
import { registerApiRoutes } from './lib/http.js'
import { createSyncRuntime } from './lib/sync.js'

export { normalizeConfig }

export const name = 'dsh-plugin-sync'
export const inject = ['tools', 'pluginManager']

const ACTIONS = new Set(['status', 'preview', 'apply', 'latest', 'push', 'log'])

/**
 * Locate the runtime directory that holds this DSH's bundled node and pnpm.
 *
 * The manual-update command should work when pasted as-is, so it points at the
 * exact binaries DSH itself uses rather than assuming a global `pnpm` on PATH.
 * Candidate order: DSH_PACK_HOME, then walking up from this module's real path
 * (profile → <dsh home>/dsh-runtimes/<runtime>).
 */
function resolvePackHome() {
  const explicit = process.env.DSH_PACK_HOME
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  let current
  try {
    current = dirname(fileURLToPath(import.meta.url))
  } catch {
    return ''
  }
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')
    if (existsSync(candidate)) return current
    const nested = join(current, 'dsh-runtimes')
    if (existsSync(nested)) {
      const primary = join(nested, 'dsh-primary-runtime')
      if (existsSync(join(primary, 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))) return primary
    }
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return ''
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summarizeError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  return typeof error.message === 'string' ? error.message : JSON.stringify(error).slice(0, 500)
}

function shortSha(value) {
  return typeof value === 'string' && value.length > 12 ? value.slice(0, 12) : value ?? ''
}

function conflictLabel(type) {
  if (type === 'host-disagreement') return 'hosts disagree'
  if (type === 'downgrade') return 'remote is older'
  if (type === 'spec-change') return 'same version, different source'
  if (type === 'enable-state') return 'installed but disabled locally'
  return type
}

function renderPreview(preview, lines) {
  lines.push(
    `Preview: ${preview.counts.actionable} default action(s), ${preview.counts.conflicts} conflict(s), `
    + `${preview.counts.localOnly} local-only`,
  )
  const visible = preview.entries.filter((entry) => (
    entry.defaultChoice === 'remote'
    || entry.conflict !== null
    || ['install', 'upgrade', 'downgrade', 'spec-change', 'enable'].includes(entry.kind)
  ))
  for (const entry of visible.slice(0, 30)) {
    const localVersion = entry.local?.version ? `local ${entry.local.version}` : 'not installed'
    const remoteVersion = entry.remote?.version ? `remote ${entry.remote.version}` : 'remote none'
    const conflict = entry.conflict === null ? '' : ` [${conflictLabel(entry.conflict.type)}]`
    lines.push(`  ${entry.name}: ${entry.kind} (${localVersion} -> ${remoteVersion})${conflict}`)
  }
  if (visible.length > 30) lines.push(`  … ${visible.length - 30} more`)
}

export function renderToolResult(_args, value) {
  const lines = []
  if (!isRecord(value)) return [{ type: 'text', text: 'Plugin Sync returned an unexpected result.' }]
  const title = typeof value.action === 'string' ? value.action : 'status'
  lines.push(`Plugin Sync — ${title}`)
  lines.push(value.ok === false
    ? `FAILED: ${value.error === undefined ? 'one or more operations failed' : summarizeError(value.error)}`
    : 'OK')
  if (typeof value.hostId === 'string') lines.push(`Host: ${value.hostId}`)
  if (isRecord(value.job)) {
    lines.push(`Job: ${value.job.id}`)
  } else if (typeof value.gistId === 'string') {
    lines.push(value.gistId !== ''
      ? `Gist: ${value.gistId}${typeof value.gistUrl === 'string' ? ` (${value.gistUrl})` : ''}`
      : 'Gist: not created yet')
  }
  if (isRecord(value.config)) {
    lines.push(`File: ${value.config.fileName ?? 'dsh-plugins.json'}`)
  }
  if (isRecord(value.token)) {
    lines.push(`Token: ${value.token.configured === true ? `configured (${value.token.source})` : 'not configured'}`)
  }
  if (isRecord(value.local)) {
    lines.push(
      `Local: ${value.local.profileBundles ?? 0} profile bundles, ${value.local.portableBundles ?? 0} portable`,
    )
  }
  if (isRecord(value.state)) {
    if (value.state.lastPreviewAt !== undefined) lines.push(`Last preview: ${value.state.lastPreviewAt}`)
    if (value.state.lastApplyAt !== undefined) lines.push(`Last apply: ${value.state.lastApplyAt}`)
    if (value.state.lastPushAt !== undefined) lines.push(`Last push: ${value.state.lastPushAt}`)
    if (Array.isArray(value.state.pendingUpgrades) && value.state.pendingUpgrades.length > 0) {
      lines.push(`Unfinished upgrades: ${value.state.pendingUpgrades.length}`)
      for (const item of value.state.pendingUpgrades.slice(0, 8)) {
        lines.push(`  ? ${item.name}: ${item.fromVersion || item.fromSpec} -> ${item.toSpec} (started ${item.startedAt})`)
      }
    }
  }
  if (typeof value.previewId === 'string' && isRecord(value.counts)) {
    renderPreview(value, lines)
    lines.push(`Preview ID: ${value.previewId}`)
  }
  if (Array.isArray(value.removed)) {
    lines.push(`Removed: ${value.removed.length}`)
    for (const item of value.removed.slice(0, 12)) {
      lines.push(`  - ${item.name}${item.restartRequired ? ' (restart required)' : ''}`)
    }
  }
  if (Array.isArray(value.applied)) {
    lines.push(`Applied: ${value.applied.length}`)
    for (const item of value.applied.slice(0, 12)) {
      lines.push(`  + ${item.name}${item.restartRequired ? ' (restart required)' : ''}`)
    }
  }
  if (Array.isArray(value.failed) && value.failed.length > 0) {
    lines.push(`Failed: ${value.failed.length}`)
    for (const item of value.failed.slice(0, 12)) {
      lines.push(`  ! ${item.name}: ${item.error ?? item.message ?? summarizeError(item)}`)
    }
    for (const item of value.failed.filter((entry) => entry.manual !== undefined).slice(0, 4)) {
      lines.push(`  Manual update for ${item.name}:`)
      for (const step of item.manual.steps ?? []) {
        if (typeof step.command === 'string' && step.command !== '') lines.push(`    ${step.command}`)
      }
    }
  }
  if (isRecord(value.counts) && Array.isArray(value.entries) && value.action === 'latest') {
    lines.push(
      `Latest check: ${value.counts.outdated} outdated, ${value.counts.current} current, `
      + `${value.counts.unsupported} not checkable`,
    )
    for (const entry of value.entries.filter((item) => item.outdated === true).slice(0, 15)) {
      lines.push(`  ^ ${entry.name}: ${entry.local?.version ?? '?'} -> ${entry.latest}`)
    }
  }
  if (Array.isArray(value.updatedList) && value.updatedList.length > 0) {
    lines.push(`Updated: ${value.updatedList.length}`)
    for (const item of value.updatedList.slice(0, 12)) {
      lines.push(`  ^ ${item.name}: ${item.replaced ?? ''} -> ${item.version ?? item.latest ?? ''}`)
    }
  }
  if (typeof value.status === 'string' && value.action === 'push') {
    lines.push(`Push: ${value.status}${value.version ? ` (${shortSha(value.version)})` : ''}`)
  }
  if (isRecord(value.remote) && value.remote.hostCount !== undefined) {
    lines.push(`Remote: ${value.remote.hostCount} host(s), ${value.remote.bundleCount} bundle record(s)`)
  }
  if (isRecord(value.job)) {
    const job = value.job
    lines.push(
      `Job ${job.id} (${job.kind}): ${job.status}`
      + (job.progress?.total > 0 ? ` ${job.progress.done}/${job.progress.total}` : ''),
    )
    for (const line of (job.lines ?? []).slice(-40)) {
      lines.push(`  ${line.message}`)
    }
    if (typeof job.error === 'string' && job.error !== '') lines.push(`  ! ${job.error}`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig({
    ...rawConfig,
    packHome: resolvePackHome(),
  })
  const runtime = createSyncRuntime({
    config,
    pluginManager: ctx.pluginManager,
    credentialsProvider: () => ctx.get('credentials'),
    logger: ctx.logger,
  })

  registerApiRoutes({ ctx, runtime, config })

  ctx.effect(() => ctx.tools.register({
    name: 'plugin_sync',
    description:
      'Preview and apply a GitHub Gist plugin manifest. Manual only: no background sync. '
      + '`preview` fetches the Gist and returns install/upgrade/downgrade/enable/local-only entries plus conflicts; '
      + '`apply` installs, enables, or removes only the entries the caller selects from that preview; '
      + '`push` uploads this host\'s portable inventory (creating a secret Gist when no Gist id is configured); '
      + '`log` returns the latest install log with per-item progress; `status` reports config and last-run state. '
      + 'Installs and removals go through the DSH plugin manager. The same operations are available in the plugin page.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'status, preview, apply, latest, push, or log.',
        },
        previewId: {
          type: 'string',
          description: 'Preview id returned by `preview`; required for `apply`.',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Bundle names for `latest`: omitted or empty checks the newest release of every bundle; a non-empty list updates those bundles to their newest release.',
        },
        selections: {
          type: 'object',
          additionalProperties: { type: 'string', enum: ['remote', 'local', 'skip', 'remove'] },
          description: 'Map of bundle name to choice. `remove` uninstalls a local-only bundle; omitted entries use the preview default.',
        },
        jobId: {
          type: 'string',
          description: 'Job id for `log`; omitted returns the latest job.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          hostId: { type: 'string' },
          error: { type: 'object' },
        },
      },
      render: renderToolResult,
    },
    timeoutMs: 15 * 60 * 1000,
    isConcurrencySafe: (args) => args?.action === 'status',
    execute: async (args, exec) => {
      const action = typeof args?.action === 'string' ? args.action : 'status'
      if (!ACTIONS.has(action)) return { ok: false, action, error: { code: 'invalid-action', message: `Unknown action: ${action}` } }
      try {
        if (action === 'status') return { ...(await runtime.status()), action: 'status' }
        if (action === 'preview') return { ...(await runtime.preview({ signal: exec?.signal })), action: 'preview' }
        if (action === 'push') return { ...(await runtime.push({ signal: exec?.signal })), action: 'push' }
        if (action === 'latest') {
          const names = Array.isArray(args?.names) ? args.names.filter((name) => typeof name === 'string') : []
          if (names.length === 0) {
            return { ...(await runtime.checkLatest({ signal: exec?.signal })), action }
          }
          return { ...(await runtime.applyLatest(names, { signal: exec?.signal })), action }
        }
        if (action === 'log') {
          const jobId = typeof args?.jobId === 'string' && args.jobId !== '' ? args.jobId : undefined
          const job = jobId === undefined ? runtime.latestJob() : runtime.job(jobId)
          if (job === null) {
            return { ok: false, action, error: { code: 'job-not-found', message: 'No install job is recorded yet' } }
          }
          return { ok: true, action, job }
        }
        if (typeof args?.previewId !== 'string' || args.previewId === '') {
          return {
            ok: false,
            action,
            error: { code: 'missing-preview-id', message: 'previewId is required for apply' },
          }
        }
        const selections = isRecord(args?.selections) ? args.selections : {}
        return {
          ...(await runtime.apply(args.previewId, selections, { signal: exec?.signal })),
          action: 'apply',
        }
      } catch (error) {
        return {
          ok: false,
          action,
          error: {
            code: typeof error?.code === 'string' ? error.code : 'operation-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    },
  }), 'plugin-sync: tool')

  if (config.configError !== undefined) {
    runtime.log('warn', config.configError)
  } else if (config.gistId === '') {
    runtime.log('info', 'no Gist id configured; push once to create a secret Gist')
  }
}
