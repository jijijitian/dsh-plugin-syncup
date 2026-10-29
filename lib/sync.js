import { randomUUID } from 'node:crypto'
import { gistUrl, TOKEN_REF } from './config.js'
import { describeChangeError, managementCodeOf } from './errors.js'
import { createGitHubClient, resolveToken } from './github.js'
import { createJobStore } from './jobs.js'
import { emptyManifest, localHostEntry, mergeHost, pickInstallSpec, summarizeManifest } from './manifest.js'
import { buildPreview, selectPreviewEntries } from './preview.js'
import { manualUpdateInstructions, resolveProfileDir } from './manual.js'
import { readState, resolveStatePath, writeState } from './state.js'
import { createVersionChecker, gitHubTargetOf, registryNameOf } from './versions.js'

const PREVIEW_TTL_MS = 10 * 60 * 1000
const MAX_HISTORY = 20
const SELF_NAMES = new Set(['dsh-plugin-sync'])

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function errorInfo(error) {
  if (error === null || typeof error !== 'object') {
    return { message: String(error) }
  }
  return {
    message: describeChangeError(error) ?? String(error),
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.status === 'number' ? { status: error.status } : {}),
    ...(error.retryable === true ? { retryable: true } : {}),
  }
}

function bundleKey(bundle) {
  return [
    bundle.name,
    bundle.spec,
    bundle.version ?? '',
    bundle.enabled === false ? '0' : '1',
  ].join('\u0000')
}

function sameBundles(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (bundleKey(left[index]) !== bundleKey(right[index])) return false
  }
  return true
}

function changeError(change) {
  if (change === null || typeof change !== 'object' || change.error === undefined) return null
  const message = describeChangeError(change.error)
  if (message === null) return null
  const code = managementCodeOf(change.error)
  return {
    message,
    ...(typeof code === 'string' ? { code } : {}),
  }
}

function summarizeInstallChange(name, spec, change) {
  const base = { name, spec }
  if (change === null || typeof change !== 'object') {
    return { ...base, status: 'failed', error: 'plugin manager returned no result' }
  }
  const failure = changeError(change)
  if (failure !== null) return { ...base, status: 'failed', error: failure.message, ...(failure.code ? { code: failure.code } : {}) }
  if (change.application === 'failed' || change.application === 'cancelled') {
    return { ...base, status: 'failed', application: change.application }
  }
  return {
    ...base,
    status: change.changed === false ? 'unchanged' : 'installed',
    ...(typeof change.application === 'string' ? { application: change.application } : {}),
    ...(typeof change.version === 'string' ? { version: change.version } : {}),
    ...(change.application === 'restart-required' ? { restartRequired: true } : {}),
    ...(Array.isArray(change.warnings) && change.warnings.length > 0
      ? { warnings: change.warnings.slice(0, 10) }
      : {}),
    ...(Array.isArray(change.pendingBuilds) && change.pendingBuilds.length > 0
      ? { pendingBuilds: change.pendingBuilds.slice(0, 10) }
      : {}),
  }
}

export function createSyncRuntime({
  config,
  pluginManager,
  credentials = null,
  credentialsProvider = null,
  logger = console,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  statePath = resolveStatePath(config),
  env = process.env,
}) {
  let stateCache = null
  let stateLoading = null
  let operation = null
  let previewCache = null
  let latestCache = null
  const jobs = createJobStore({ now })

  function jobLog(job, level, message) {
    jobs.append(job.id, level, message)
    log(level, message)
  }

  function log(level, message) {
    const write = logger?.[level]
    if (typeof write !== 'function') return
    try {
      write.call(logger, `plugin-sync: ${message}`)
    } catch {
      // logging must never break the operation
    }
  }

  async function getState() {
    if (stateCache !== null) return stateCache
    if (stateLoading === null) {
      stateLoading = readState(statePath, config.hostId).then((state) => {
        stateCache = state
        return state
      })
    }
    return stateLoading
  }

  async function resolveCredential() {
    const currentCredentials = typeof credentialsProvider === 'function'
      ? credentialsProvider()
      : credentials
    if (currentCredentials !== null && currentCredentials !== undefined && typeof currentCredentials.resolve === 'function') {
      try {
        const resolved = await currentCredentials.resolve(TOKEN_REF)
        if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') {
          return {
            token: resolved.value,
            source: typeof resolved.source === 'string' ? resolved.source : 'credentials',
            configured: true,
            writable: true,
          }
        }
      } catch {
        // Fall through to the legacy env/file sources.
      }
    }
    const fallback = resolveToken({
      token: config.token,
      tokenEnv: config.tokenEnv,
      tokenFile: config.tokenFile,
      env,
    })
    return {
      token: fallback.token,
      source: fallback.source,
      configured: fallback.token !== '',
      writable: false,
    }
  }

  async function getClient() {
    if (config.configError !== undefined) throw new Error(config.configError)
    const token = await resolveCredential()
    return createGitHubClient({
      apiBaseUrl: config.apiBaseUrl,
      token: token.token,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl,
    })
  }

  async function resolveGistId(github) {
    const state = await getState()
    if (
      typeof state.gistId === 'string' && state.gistId !== ''
      && (state.gistName === null || state.gistName === config.gistName)
    ) {
      return state.gistId
    }
    const gists = await github.listGists()
    const matches = gists
      .filter((gist) => typeof gist.description === 'string' && gist.description.trim() === config.gistName)
      .sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime())
    if (matches.length === 0) return ''
    const match = matches[0]
    await persist({
      gistName: config.gistName,
      gistId: match.gistId,
      gistUrl: match.htmlUrl,
    })
    return match.gistId
  }

  async function runExclusive(name, work) {
    if (operation !== null) {
      throw new Error(`Another plugin-sync operation is already running (${name}).`)
    }
    const job = work()
    operation = job
    try {
      return await job
    } finally {
      if (operation === job) operation = null
    }
  }

  async function collectLocal() {
    const bundles = await pluginManager.listBundles()
    const entry = localHostEntry(bundles, {
      hostId: config.hostId,
      profile: config.profile,
      platform: process.platform,
      now: now().toISOString(),
      exclude: config.excludeBundles,
    })
    return { bundles, entry }
  }

  function localSummary(bundles, entry) {
    return {
      profileBundles: bundles.filter((bundle) => bundle?.availability === 'profile' && bundle.installed === true).length,
      portableBundles: entry.bundles.length,
      ...(entry.dshVersion === undefined ? {} : { dshVersion: entry.dshVersion }),
      ...(entry.profile === undefined ? {} : { profile: entry.profile }),
    }
  }

  /**
   * Install a bundle, replacing an installed copy when the manager refuses it.
   *
   * dsh 0.2.1's plugin manager answers `installBundle` with `already-installed`
   * whenever a live `hmr` service is present and the package is already a profile
   * dependency, so an in-place upgrade does not exist. The Plugins page and
   * dshmarket both work around this by removing first and installing again.
   *
   * That two-step is not atomic, and `removeBundle` deselects the bundle BEFORE
   * it can fail with `bundle-in-use` — which leaves the bundle installed but
   * dropped from `dsh.profile.bundles`, i.e. silently disabled and gone from the
   * Loader. So this path:
   *
   *   1. probes first: deselect, then verify the Loader really released it;
   *   2. reselects immediately when the probe proves the bundle cannot be unloaded;
   *   3. records such bundles in `state.manualUpdates` and skips them next time;
   *   4. reselects after any failed removal, so a failure never strands the bundle.
   */
  async function installOrUpgrade({ name, spec, previous, job }) {
    // `previous` is either a raw listBundles() row (spec lives in
    // installTarget.spec or source) or a preview local view (already resolved).
    const fromSpec = previous === null || previous === undefined
      ? ''
      : String(pickInstallSpec(previous) || previous.spec || '').trim()
    const record = fromSpec === ''
      ? null
      : {
          name,
          fromSpec,
          fromVersion: typeof previous?.version === 'string' ? previous.version : '',
          toSpec: spec,
          startedAt: now().toISOString(),
        }

    const first = await safeInstall(job, name, spec)

    if (first.status !== 'failed' || first.code !== 'already-installed') return first

    if (record === null) {
      return {
        ...first,
        error: `${first.error ?? 'already-installed'} The installed spec is unknown, so it cannot be replaced automatically.`,
        hint: 'plugins-page',
      }
    }

    const known = await findManualUpdate(name)
    if (known !== null) {
      jobLog(job, 'warn', `${name}: previously required a manual update; skipping`)
      return {
        ...first,
        code: 'manual-update',
        error: `${first.error ?? 'already-installed'} This bundle could not be unloaded by HMR before (${known.at}), so it was left untouched.`,
        hint: 'manual-terminal',
        manual: instructionsFor(name, spec),
      }
    }

    jobLog(job, 'warn', `${name}: already installed; replacing ${record.fromVersion || record.fromSpec} with ${spec}`)

    // Step 1: probe with a deselect, then check whether the Loader let it go.
    const probe = await probeUnload(job, name)
    if (probe.released === false) {
      await reselect(job, name)
      await rememberManualUpdate(name, { reason: 'bundle-in-use', toSpec: spec })
      return {
        ...first,
        code: 'manual-update',
        error: `${first.error ?? 'already-installed'} HMR cannot unload this bundle while DSH runs (${probe.reason ?? 'still loaded'}), so it was left untouched.`,
        hint: 'manual-terminal',
        manual: instructionsFor(name, spec),
      }
    }

    await persist({ pendingUpgrades: [...(await getPendingUpgrades()).filter((item) => item.name !== name), record] })

    // Step 2: the real removal, then reselect if it refuses.
    const removal = await safeRemove(job, name)
    if (removal.status === 'failed') {
      await reselect(job, name)
      await clearPendingUpgrade(name)
      if (removal.code === 'bundle-in-use') {
        await rememberManualUpdate(name, { reason: 'bundle-in-use', toSpec: spec })
      }
      return {
        ...removal,
        error: `Could not replace the installed copy: ${removal.error ?? 'remove failed'}`,
        reselected: true,
        ...(removal.code === 'bundle-in-use'
          ? { hint: 'manual-terminal', manual: instructionsFor(name, spec) }
          : {}),
      }
    }

    const second = await safeInstall(job, name, spec)
    if (second.status !== 'failed') {
      await clearPendingUpgrade(name)
      await forgetManualUpdate(name)
      return { ...second, replaced: record.fromVersion || record.fromSpec, upgraded: true }
    }

    jobLog(job, 'error', `${name}: install failed after removal; restoring ${record.fromSpec}`)
    const restore = await safeInstall(job, name, record.fromSpec)
    if (restore.status === 'failed') {
      jobLog(job, 'error', `${name}: could not restore ${record.fromSpec} — ${restore.error ?? 'unknown error'}`)
      return {
        ...second,
        error: `${second.error ?? 'install failed'} The previous copy could not be restored either; reinstall ${record.fromSpec} manually.`,
        rollback: 'failed',
      }
    }
    await clearPendingUpgrade(name)
    jobLog(job, 'warn', `${name}: restored ${record.fromVersion || record.fromSpec}`)
    return {
      ...second,
      error: `${second.error ?? 'install failed'} Restored the previous copy (${record.fromVersion || record.fromSpec}).`,
      rollback: 'restored',
    }
  }

  /**
   * Deselect a bundle and report whether the Loader actually dropped its rows.
   *
   * `setBundleEnabled(name, false)` is the only public way to ask HMR to stop a
   * bundle. When it refuses outright it throws, and the bundle stays selected, so
   * the caller can simply stop. When it succeeds, `listBundles()` tells us whether
   * the bundle is still marked enabled: a bundle HMR refused to unload keeps its
   * row, which is exactly the state `removeBundle` turns into `bundle-in-use`.
   */
  async function probeUnload(job, name) {
    jobLog(job, 'info', `${name}: checking whether HMR can unload it`)
    try {
      const change = await pluginManager.setBundleEnabled(name, false)
      const summary = summarizeInstallChange(name, '', change)
      if (summary.status === 'failed') {
        jobLog(job, 'warn', `${name}: cannot be disabled (${summary.error ?? 'refused'}); treating as still loaded`)
        return { released: false, reason: summary.error ?? 'disable refused' }
      }
      if (summary.application === 'restart-required' || summary.restartRequired === true) {
        jobLog(job, 'warn', `${name}: needs a restart before it can be unloaded`)
        return { released: false, reason: 'restart required' }
      }
    } catch (error) {
      const info = errorInfo(error)
      jobLog(job, 'warn', `${name}: cannot be disabled — ${info.message}`)
      return { released: false, reason: info.message }
    }

    const current = await findBundle(name)
    if (current === null) return { released: true }
    if (current.enabled === false) {
      jobLog(job, 'info', `${name}: HMR released it`)
      return { released: true }
    }
    return { released: false, reason: 'still enabled after deselect' }
  }

  async function findBundle(name) {
    try {
      const bundles = await pluginManager.listBundles()
      for (const bundle of bundles) {
        if (bundle !== null && typeof bundle === 'object' && bundle.name === name) return bundle
      }
    } catch (error) {
      log('warn', `could not list bundles: ${describeChangeError(error) ?? String(error)}`)
    }
    return null
  }

  /** Put a bundle back in the profile selection after a refused removal. */
  async function reselect(job, name) {
    try {
      const change = await pluginManager.setBundleEnabled(name, true)
      const summary = summarizeInstallChange(name, '', change)
      if (summary.status === 'failed') {
        jobLog(job, 'error', `${name}: could not restore its profile selection — ${summary.error ?? 'unknown error'}`)
        return false
      }
      jobLog(job, 'warn', `${name}: kept selected (removal was refused)`)
      return true
    } catch (error) {
      const info = errorInfo(error)
      jobLog(job, 'error', `${name}: could not restore its profile selection — ${info.message}`)
      return false
    }
  }

  async function safeInstall(job, name, spec) {
    try {
      const change = await pluginManager.installBundle(spec, { enabled: true })
      const summary = summarizeInstallChange(name, spec, change)
      if (summary.status === 'failed') {
        jobLog(job, 'error', `${name}: install failed — ${summary.error ?? 'unknown error'}`)
      }
      return summary
    } catch (error) {
      const info = errorInfo(error)
      jobLog(job, 'error', `${name}: install failed — ${info.message}`)
      return { name, spec, status: 'failed', error: info.message, ...(info.code ? { code: info.code } : {}) }
    }
  }

  async function safeRemove(job, name) {
    try {
      const change = await pluginManager.removeBundle(name)
      const summary = summarizeInstallChange(name, '', change)
      if (summary.status === 'failed') {
        jobLog(job, 'error', `${name}: remove failed — ${summary.error ?? 'unknown error'}`)
      }
      return summary
    } catch (error) {
      const info = errorInfo(error)
      jobLog(job, 'error', `${name}: remove failed — ${info.message}`)
      return { name, status: 'failed', error: info.message, ...(info.code ? { code: info.code } : {}) }
    }
  }

  async function getPendingUpgrades() {
    const state = await getState()
    return Array.isArray(state.pendingUpgrades) ? state.pendingUpgrades : []
  }

  /** Terminal steps for a bundle HMR will not let go of. */
  function instructionsFor(name, spec) {
    return manualUpdateInstructions({
      name,
      spec,
      profileDir: resolveProfileDir(config),
      packHome: config.packHome,
    })
  }

  async function clearPendingUpgrade(name) {
    const pending = (await getPendingUpgrades()).filter((item) => item.name !== name)
    await persist({ pendingUpgrades: pending })
  }

  async function getManualUpdates() {
    const state = await getState()
    return Array.isArray(state.manualUpdates) ? state.manualUpdates : []
  }

  async function findManualUpdate(name) {
    const entries = await getManualUpdates()
    return entries.find((item) => item.name === name) ?? null
  }

  async function rememberManualUpdate(name, { reason, toSpec }) {
    const entries = (await getManualUpdates()).filter((item) => item.name !== name)
    entries.push({ name, reason, toSpec, at: now().toISOString(), attempts: 1 })
    await persist({ manualUpdates: entries })
  }

  async function forgetManualUpdate(name) {
    const entries = await getManualUpdates()
    if (!entries.some((item) => item.name === name)) return
    await persist({ manualUpdates: entries.filter((item) => item.name !== name) })
  }

  async function pushWithRetry(github, gistId, hostEntry, signal) {
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) throw new Error('operation was aborted')
      const remote = await github.readGist(gistId, config.fileName, { extraSignal: signal })
      if (remote.exists && sameBundles(remote.manifest.hosts[config.hostId]?.bundles, hostEntry.bundles)) {
        return {
          status: 'unchanged',
          attempts: attempt,
          version: remote.version,
          htmlUrl: remote.htmlUrl,
          manifest: remote.manifest,
        }
      }
      const merged = mergeHost(remote.manifest, config.hostId, hostEntry, now().toISOString())
      try {
        const updated = await github.updateGist(gistId, {
          description: config.gistName,
          fileName: config.fileName,
          manifest: merged,
          expectedVersion: remote.version,
          extraSignal: signal,
        })
        return {
          status: 'pushed',
          attempts: attempt,
          version: updated.version,
          htmlUrl: updated.htmlUrl,
          manifest: merged,
        }
      } catch (error) {
        lastError = error
        if (error?.code === 'conflict' && attempt < 3) {
          await sleep(150 * attempt)
          continue
        }
        throw error
      }
    }
    throw lastError ?? new Error('could not update the Gist')
  }

  async function persist(patch) {
    try {
      const current = await getState()
      const history = Array.isArray(patch.history)
        ? patch.history.slice(0, MAX_HISTORY)
        : Array.isArray(current.history) ? current.history.slice(0, MAX_HISTORY) : []
      const next = {
        ...current,
        ...patch,
        hostId: config.hostId,
        history,
      }
      stateCache = await writeState(statePath, next)
    } catch (error) {
      log('warn', `could not save state: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function status() {
    let local = null
    let localError = null
    try {
      const snapshot = await collectLocal()
      local = localSummary(snapshot.bundles, snapshot.entry)
    } catch (error) {
      localError = errorInfo(error)
    }
    const state = await getState()
    const gistName = config.gistName
    const stateMatchesGist = state.gistName === gistName || (state.gistName === null && typeof state.gistId === 'string')
    const gistId = stateMatchesGist && typeof state.gistId === 'string' ? state.gistId : ''
    const effectiveGistUrl = stateMatchesGist
      ? (state.gistUrl ?? (gistId === '' ? null : gistUrl(gistId)))
      : null
    const token = await resolveCredential()
    return {
      ok: true,
      configured: gistId !== '',
      gistName,
      gistId,
      gistUrl: effectiveGistUrl,
      ...(config.configError === undefined ? {} : { configError: config.configError }),
      config: {
        gistName,
        fileName: config.fileName,
        description: config.description,
        hostId: config.hostId,
        maxInstallsPerRun: config.maxInstallsPerRun,
      },
      token: {
        configured: token.configured,
        source: token.source,
        writable: token.writable,
      },
      local,
      ...(localError === null ? {} : { localError }),
      state: {
        ...(state.lastPreviewAt === null ? {} : { lastPreviewAt: state.lastPreviewAt }),
        ...(state.lastApplyAt === null ? {} : { lastApplyAt: state.lastApplyAt }),
        ...(state.lastPushAt === null ? {} : { lastPushAt: state.lastPushAt }),
        ...(state.remote === null || state.remote === undefined ? {} : { remote: state.remote }),
        lastResults: Array.isArray(state.lastResults) ? state.lastResults : [],
        ...(Array.isArray(state.pendingUpgrades) && state.pendingUpgrades.length > 0
          ? { pendingUpgrades: state.pendingUpgrades }
          : {}),
        ...(Array.isArray(state.manualUpdates) && state.manualUpdates.length > 0
          ? { manualUpdates: state.manualUpdates }
          : {}),
        ...(state.loadError === undefined ? {} : { loadError: state.loadError }),
      },
      previewAvailable: previewCache !== null,
      statePath,
    }
  }

  async function preview({ signal } = {}) {
    return runExclusive('preview', async () => {
      const job = jobs.start('preview')
      jobs.progress(job.id, 0, 3)
      jobLog(job, 'info', `reading Gist "${config.gistName}"`)
      try {
        const github = await getClient()
        jobs.progress(job.id, 1, 3)
        const gistId = await resolveGistId(github)
        if (gistId === '') {
          throw new Error(`No Gist named "${config.gistName}" was found. Push the local inventory to create it.`)
        }
        const remote = await github.readGist(gistId, config.fileName, { extraSignal: signal })
        jobLog(job, 'info', `Gist ${gistId} read (${remote.exists ? 'manifest found' : 'no manifest file yet'})`)
        jobs.progress(job.id, 2, 3)
        const { bundles, entry } = await collectLocal()
        const previewData = buildPreview({
          manifest: remote.manifest,
          localBundles: bundles,
          hostId: config.hostId,
          exclude: config.excludeBundles,
          now: now().toISOString(),
        })
        // Bundles HMR could not unload before keep failing on remove-then-install;
        // surface that on the row so the choice is made with open eyes.
        const manualNames = new Set((await getManualUpdates()).map((item) => item.name))
        if (manualNames.size > 0) {
          for (const entry of previewData.entries) {
            if (manualNames.has(entry.name) && entry.kind !== 'current') entry.manualUpdate = true
          }
        }
        jobs.progress(job.id, 3, 3)
        jobLog(
          job,
          'info',
          `preview built: ${previewData.counts.actionable} actionable, ${previewData.counts.conflicts} conflicts, `
          + `${previewData.counts.localOnly} local-only`,
        )
        const previewId = randomUUID()
        previewCache = {
          id: previewId,
          createdAt: Date.now(),
          expiresAt: Date.now() + PREVIEW_TTL_MS,
          gistId,
          version: remote.version,
          preview: previewData,
        }
        const state = await getState()
        await persist({
          gistName: config.gistName,
          gistId,
          gistUrl: remote.htmlUrl ?? gistUrl(gistId),
          lastPreviewAt: now().toISOString(),
          remote: summarizeManifest(remote.manifest),
          history: [
            {
              at: now().toISOString(),
              action: 'preview',
              ok: true,
              conflicts: previewData.conflicts.length,
              actionable: previewData.counts.actionable,
            },
            ...(Array.isArray(state.history) ? state.history : []),
          ].slice(0, MAX_HISTORY),
        })
        const local = localSummary(bundles, entry)
        const result = {
          ok: true,
          previewId,
          jobId: job.id,
          gistName: config.gistName,
          gistId,
          gistUrl: remote.htmlUrl ?? gistUrl(gistId),
          ...previewData,
          remote: {
            ...previewData.remote,
            version: remote.version,
            exists: remote.exists,
            htmlUrl: remote.htmlUrl,
          },
          local: {
            ...previewData.local,
            profileBundles: local.profileBundles,
            portableBundles: local.portableBundles,
            ...(local.dshVersion === undefined ? {} : { dshVersion: local.dshVersion }),
          },
          expiresAt: new Date(previewCache.expiresAt).toISOString(),
        }
        jobs.finish(job.id, { result: { actionable: previewData.counts.actionable } })
        return result
      } catch (error) {
        const info = errorInfo(error)
        jobLog(job, 'error', `preview failed: ${info.message}`)
        jobs.finish(job.id, { error: info.message })
        throw error
      }
    })
  }

  /**
   * Ask each package source what its newest release actually is.
   *
   * The Gist manifest only knows what some host last pushed, so it can lag the
   * registry — `dshmarket@1.70.2` in the Gist while npm already serves 1.73.3.
   * This look-up answers "what is the real latest", separately from "what does
   * the manifest say", so the page can offer updating past the manifest.
   */
  async function checkLatest({ signal } = {}) {
    return runExclusive('check', async () => {
      const job = jobs.start('check')
      try {
        const { bundles } = await collectLocal()
        const credential = await resolveCredential()
        const checker = createVersionChecker({
          fetchImpl,
          token: credential.token,
          timeoutMs: Math.max(config.requestTimeoutMs, 15_000),
        })
        const candidates = []
        for (const bundle of bundles) {
          if (bundle === null || typeof bundle !== 'object' || typeof bundle.name !== 'string') continue
          if (bundle.installed !== true && bundle.availability !== 'profile') continue
          const spec = pickInstallSpec(bundle)
          if (spec === '') continue
          candidates.push({
            name: bundle.name,
            spec,
            version: typeof bundle.version === 'string' ? bundle.version : '',
            enabled: bundle.enabled !== false,
            removable: bundle.removable !== false,
          })
        }
        jobs.progress(job.id, 0, candidates.length)
        jobLog(job, 'info', `checking the newest release of ${candidates.length} bundle(s)`)
        const results = await checker.checkAll(candidates, { upstream: signal })
        jobs.progress(job.id, results.length, candidates.length)
        const byName = new Map(candidates.map((item) => [item.name, item]))
        const entries = results.map((result) => {
          const local = byName.get(result.name)
          return {
            id: result.name,
            name: result.name,
            kind: 'latest-check',
            local: {
              version: local?.version ?? '',
              spec: local?.spec ?? '',
              enabled: local?.enabled !== false,
              removable: local?.removable !== false,
            },
            source: result.kind,
            latest: result.latest,
            outdated: result.outdated === true,
            ...(result.error === undefined ? {} : { error: result.error }),
            ...(result.distTags === undefined ? {} : { distTags: result.distTags }),
          }
        })
        const outdated = entries.filter((entry) => entry.outdated === true)
        const unsupported = entries.filter((entry) => entry.error === 'unsupported')
        for (const entry of outdated) {
          jobLog(job, 'info', `${entry.name}: ${entry.local.version} -> ${entry.latest}`)
          entry.target = buildLatestSpec(entry)
        }
        for (const entry of entries) {
          if (entry.outdated !== true && entry.error !== undefined) {
            jobLog(job, 'warn', `${entry.name}: could not check (${entry.error})`)
          }
        }
        jobLog(
          job,
          'info',
          `checked: ${outdated.length} outdated, ${entries.length - outdated.length - unsupported.length} current`
          + `${unsupported.length === 0 ? '' : `, ${unsupported.length} not registry-backed`}`,
        )
        const result = {
          ok: true,
          jobId: job.id,
          generatedAt: now().toISOString(),
          entries,
          counts: {
            entries: entries.length,
            outdated: outdated.length,
            current: entries.length - outdated.length - unsupported.length,
            unsupported: unsupported.length,
            failed: entries.filter((entry) => entry.error !== undefined && entry.error !== 'unsupported').length,
          },
        }
        latestCache = { at: Date.now(), result }
        jobs.finish(job.id, { result: { outdated: outdated.length } })
        return result
      } catch (error) {
        const info = errorInfo(error)
        jobLog(job, 'error', `check failed: ${info.message}`)
        jobs.finish(job.id, { error: info.message })
        throw error
      }
    })
  }

  function buildLatestSpec(entry) {
    const version = String(entry.latest ?? '').trim()
    if (version === '') return ''
    if (entry.source === 'github') {
      const target = gitHubTargetOf(entry.local.spec)
      if (target !== null) {
        return `github:${target.owner}/${target.repo}#v${version}`
      }
      return ''
    }
    const npm = registryNameOf(entry.local.spec)
    return npm === null ? '' : `${npm.name}@${version}`
  }

  async function apply(previewId, selections = {}, { signal } = {}) {
    return runExclusive('apply', async () => {
      if (previewCache === null || previewCache.id !== previewId) {
        throw new Error('The preview expired or no longer belongs to this Host. Pull the manifest again.')
      }
      if (Date.now() > previewCache.expiresAt) {
        previewCache = null
        throw new Error('The preview expired. Pull the manifest again.')
      }
      const chosen = selectPreviewEntries(previewCache.preview, selections)
      const max = config.maxInstallsPerRun
      const allowed = chosen.slice(0, max)
      const skipped = chosen.slice(max).map(({ entry }) => ({
        name: entry.name,
        reason: 'max-installs-per-run',
      }))
      const job = jobs.start('apply', { previewId, total: allowed.length })
      jobs.progress(job.id, 0, allowed.length)
      jobLog(job, 'info', `apply started with ${allowed.length} selected change(s)`)

      const applied = []
      const failed = []
      const removed = []
      const fresh = await pluginManager.listBundles()
      const installed = new Map()
      for (const bundle of fresh) {
        if (bundle !== null && typeof bundle === 'object' && typeof bundle.name === 'string') {
          installed.set(bundle.name, bundle)
        }
      }

      let done = 0
      for (const { entry, choice } of allowed) {
        done += 1
        jobs.progress(job.id, done, allowed.length)
        if (signal?.aborted) {
          jobs.finish(job.id, { error: 'operation was aborted' })
          throw new Error('operation was aborted')
        }

        if (choice === 'remove') {
          const current = installed.get(entry.name)
          if (current === undefined) {
            skipped.push({ name: entry.name, reason: 'not-installed' })
            jobLog(job, 'info', `${entry.name}: already absent, skipped`)
            continue
          }
          if (SELF_NAMES.has(entry.name)) {
            failed.push({
              name: entry.name,
              error: 'This plugin cannot remove itself while it is running. Remove it from the Plugins page instead.',
              code: 'self-removal',
            })
            jobLog(job, 'error', `${entry.name}: refusing to remove the running plugin itself`)
            continue
          }
          if (current.removable === false) {
            failed.push({ name: entry.name, error: 'This bundle cannot be removed.', code: 'not-removable' })
            jobLog(job, 'warn', `${entry.name}: bundle is not removable`)
            continue
          }
          jobLog(job, 'info', `${entry.name}: removing local bundle`)
          const summary = await safeRemove(job, entry.name)
          if (summary.status === 'failed') {
            failed.push({ name: entry.name, error: summary.error ?? 'remove failed', ...(summary.code ? { code: summary.code } : {}) })
          } else {
            removed.push({ ...summary, kind: 'remove' })
            installed.delete(entry.name)
            jobLog(job, 'info', `${entry.name}: removed`)
          }
          continue
        }

        if (entry.kind === 'current' || entry.kind === 'local-only' || entry.kind === 'remote-disabled') continue
        const current = installed.get(entry.name)
        if (entry.kind === 'install' && current !== undefined && (current.installed === true || current.availability === 'profile')) {
          skipped.push({ name: entry.name, reason: 'already-installed' })
          jobLog(job, 'info', `${entry.name}: already installed, skipped`)
          continue
        }
        if (entry.kind === 'enable') {
          if (current?.enabled === true) {
            skipped.push({ name: entry.name, reason: 'already-enabled' })
            jobLog(job, 'info', `${entry.name}: already enabled, skipped`)
            continue
          }
          jobLog(job, 'info', `${entry.name}: enabling bundle`)
          try {
            const change = await pluginManager.setBundleEnabled(entry.name, true)
            const summary = summarizeInstallChange(entry.name, entry.remote?.spec ?? '', change)
            if (summary.status === 'failed') {
              failed.push({ name: entry.name, error: summary.error ?? 'could not enable bundle', ...(summary.code ? { code: summary.code } : {}) })
              jobLog(job, 'error', `${entry.name}: enable failed — ${summary.error ?? 'unknown error'}`)
            } else {
              applied.push({ ...summary, kind: 'enable' })
              jobLog(job, 'info', `${entry.name}: enabled`)
            }
          } catch (error) {
            const info = errorInfo(error)
            failed.push({ name: entry.name, ...info })
            jobLog(job, 'error', `${entry.name}: ${info.message}`)
          }
          continue
        }

        const spec = entry.remote?.spec
        if (typeof spec !== 'string' || spec === '') {
          skipped.push({ name: entry.name, reason: 'no-install-spec' })
          jobLog(job, 'warn', `${entry.name}: no install spec, skipped`)
          continue
        }
        if (SELF_NAMES.has(entry.name)) {
          failed.push({
            name: entry.name,
            spec,
            error: 'This plugin cannot replace itself while it is running. Update it from the Plugins page instead.',
            code: 'self-update',
          })
          jobLog(job, 'warn', `${entry.name}: skipping self-update; update it from the Plugins page`)
          continue
        }
        jobLog(job, 'info', `${entry.name}: installing ${spec}`)
        const summary = await installOrUpgrade({
          name: entry.name,
          spec,
          previous: current ?? entry.local ?? null,
          job,
        })
        if (summary.status === 'failed') {
          failed.push({
            name: entry.name,
            spec,
            error: summary.error ?? 'install failed',
            ...(summary.code ? { code: summary.code } : {}),
            ...(summary.rollback ? { rollback: summary.rollback } : {}),
            ...(summary.reselected === true ? { reselected: true } : {}),
            ...(summary.manual === undefined ? {} : { hint: summary.hint, manual: summary.manual }),
          })
        } else {
          applied.push({ ...summary, kind: entry.kind })
          installed.set(entry.name, {
            name: entry.name,
            installed: true,
            availability: 'profile',
            enabled: true,
          })
          jobLog(
            job,
            'info',
            `${entry.name}: ${summary.rollback === 'restored' ? 'kept' : summary.upgraded === true ? 'upgraded' : summary.status === 'unchanged' ? 'already current' : 'installed'}`
            + `${summary.restartRequired === true ? ' (restart required)' : ''}`,
          )
        }
      }

      previewCache = null
      const at = now().toISOString()
      const state = await getState()
      await persist({
        lastApplyAt: at,
        lastResults: [...applied, ...removed, ...failed].slice(0, 50),
        history: [
          {
            at,
            action: 'apply',
            ok: failed.length === 0,
            applied: applied.length,
            removed: removed.length,
            failed: failed.length,
            skipped: skipped.length,
          },
          ...(Array.isArray(state.history) ? state.history : []),
        ].slice(0, MAX_HISTORY),
      })
      const result = {
        ok: failed.length === 0,
        previewId,
        jobId: job.id,
        applied,
        failed,
        removed,
        skipped,
        totalSelected: chosen.length,
        totalApplied: applied.length,
        totalRemoved: removed.length,
      }
      jobLog(
        job,
        failed.length === 0 ? 'info' : 'warn',
        `apply finished: ${applied.length} installed/enabled, ${removed.length} removed, ${failed.length} failed, ${skipped.length} skipped`,
      )
      jobs.finish(job.id, {
        result: {
          applied: applied.length,
          removed: removed.length,
          failed: failed.length,
          skipped: skipped.length,
        },
      })
      return result
    })
  }

  /**
   * Install the newest release of the selected bundles, ignoring what the Gist says.
   *
   * The manifest can lag the registry, so "update to latest" derives the target
   * spec from the live lookup (`target`) rather than from `state.remote`.
   */
  async function applyLatest(names, { signal } = {}) {
    return runExclusive('apply-latest', async () => {
      const selected = Array.isArray(names) ? names.filter((name) => typeof name === 'string' && name !== '') : []
      if (selected.length === 0) throw new Error('Select at least one bundle to update.')
      const checked = latestCache === null ? await checkLatest({ signal }) : latestCache.result
      const byName = new Map(checked.entries.map((entry) => [entry.name, entry]))
      const targeted = []
      const skipped = []
      for (const name of selected) {
        const entry = byName.get(name)
        if (entry === undefined) {
          skipped.push({ name, reason: 'not-installed' })
          continue
        }
        if (entry.outdated !== true) {
          skipped.push({ name, reason: entry.error ?? 'already-current' })
          continue
        }
        const target = typeof entry.target === 'string' && entry.target !== '' ? entry.target : buildLatestSpec(entry)
        if (target === '') {
          skipped.push({ name, reason: 'no-latest-spec' })
          continue
        }
        targeted.push({ entry, target })
      }

      const max = config.maxInstallsPerRun
      const allowed = targeted.slice(0, max)
      for (const item of targeted.slice(max)) skipped.push({ name: item.entry.name, reason: 'max-installs-per-run' })

      const job = jobs.start('apply-latest', { total: allowed.length })
      jobs.progress(job.id, 0, allowed.length)
      jobLog(job, 'info', `update-to-latest started with ${allowed.length} bundle(s)`)

      const applied = []
      const failed = []
      const fresh = await pluginManager.listBundles()
      const installed = new Map()
      for (const bundle of fresh) {
        if (bundle !== null && typeof bundle === 'object' && typeof bundle.name === 'string') {
          installed.set(bundle.name, bundle)
        }
      }

      let done = 0
      for (const { entry, target } of allowed) {
        done += 1
        jobs.progress(job.id, done, allowed.length)
        if (signal?.aborted) {
          jobs.finish(job.id, { error: 'operation was aborted' })
          throw new Error('operation was aborted')
        }
        const current = installed.get(entry.name) ?? null
        if (SELF_NAMES.has(entry.name)) {
          failed.push({
            name: entry.name,
            spec: target,
            error: 'This plugin cannot replace itself while it is running. Update it from the Plugins page instead.',
            code: 'self-update',
          })
          jobLog(job, 'warn', `${entry.name}: skipping self-update; update it from the Plugins page`)
          continue
        }
        jobLog(job, 'info', `${entry.name}: installing ${target} (latest)`)
        const summary = await installOrUpgrade({ name: entry.name, spec: target, previous: current, job })
        if (summary.status === 'failed') {
          failed.push({
            name: entry.name,
            spec: target,
            error: summary.error ?? 'install failed',
            ...(summary.code ? { code: summary.code } : {}),
            ...(summary.rollback ? { rollback: summary.rollback } : {}),
            ...(summary.reselected === true ? { reselected: true } : {}),
            ...(summary.manual === undefined ? {} : { hint: summary.hint, manual: summary.manual }),
          })
        } else {
          applied.push({ ...summary, kind: 'latest', latest: entry.latest })
          jobLog(
            job,
            'info',
            `${entry.name}: ${summary.rollback === 'restored' ? 'kept' : summary.upgraded === true ? 'upgraded' : 'installed'} to ${entry.latest}`,
          )
        }
      }

      latestCache = null
      const at = now().toISOString()
      const state = await getState()
      await persist({
        lastApplyAt: at,
        lastResults: [...applied, ...failed].slice(0, 50),
        history: [
          {
            at,
            action: 'apply-latest',
            ok: failed.length === 0,
            applied: applied.length,
            failed: failed.length,
            skipped: skipped.length,
          },
          ...(Array.isArray(state.history) ? state.history : []),
        ].slice(0, MAX_HISTORY),
      })
      jobLog(
        job,
        failed.length === 0 ? 'info' : 'warn',
        `update-to-latest finished: ${applied.length} updated, ${failed.length} failed, ${skipped.length} skipped`,
      )
      jobs.finish(job.id, { result: { applied: applied.length, failed: failed.length } })
      return {
        ok: failed.length === 0,
        jobId: job.id,
        applied,
        failed,
        skipped,
        updatedList: applied.map((item) => ({
          name: item.name,
          version: item.version,
          replaced: item.replaced,
          latest: item.latest,
        })),
        totalSelected: selected.length,
        totalApplied: applied.length,
      }
    })
  }

  async function push({ signal } = {}) {
    return runExclusive('push', async () => {
      const job = jobs.start('push')
      jobs.progress(job.id, 0, 2)
      try {
        const github = await getClient()
        jobLog(job, 'info', 'collecting local bundle inventory')
        const { bundles, entry } = await collectLocal()
        const local = localSummary(bundles, entry)
        jobLog(job, 'info', `${local.profileBundles} profile bundle(s), ${local.portableBundles} portable`)
        const gistId = await resolveGistId(github)
        jobs.progress(job.id, 1, 2)

        if (gistId === '') {
          jobLog(job, 'info', `creating secret Gist "${config.gistName}"`)
          const manifest = mergeHost(emptyManifest(now().toISOString()), config.hostId, entry, now().toISOString())
          const created = await github.createGist({
            description: config.gistName,
            fileName: config.fileName,
            manifest,
            extraSignal: signal,
          })
          const at = now().toISOString()
          const state = await getState()
          await persist({
            gistName: config.gistName,
            gistId: created.gistId,
            gistUrl: created.htmlUrl,
            lastPushAt: at,
            remote: summarizeManifest(manifest),
            history: [
              { at, action: 'push', ok: true, status: 'created', gistId: created.gistId },
              ...(Array.isArray(state.history) ? state.history : []),
            ].slice(0, MAX_HISTORY),
          })
          const result = {
            ok: true,
            created: true,
            status: 'created',
            jobId: job.id,
            gistName: config.gistName,
            gistId: created.gistId,
            gistUrl: created.htmlUrl,
            version: created.version,
            remote: summarizeManifest(manifest),
            local,
          }
          jobs.progress(job.id, 2, 2)
          jobLog(job, 'info', `secret Gist created (${created.gistId})`)
          jobs.finish(job.id, { result: { status: 'created', gistId: created.gistId } })
          return result
        }

        jobLog(job, 'info', `updating Gist ${gistId}`)
        const pushResult = await pushWithRetry(github, gistId, entry, signal)
        const summary = summarizeManifest(pushResult.manifest)
        const at = now().toISOString()
        const state = await getState()
        await persist({
          gistName: config.gistName,
          gistId,
          gistUrl: pushResult.htmlUrl ?? state.gistUrl ?? gistUrl(gistId),
          lastPushAt: pushResult.status === 'pushed' ? at : state.lastPushAt,
          remote: summary,
          history: [
            {
              at,
              action: 'push',
              ok: true,
              status: pushResult.status,
              version: pushResult.version,
            },
            ...(Array.isArray(state.history) ? state.history : []),
          ].slice(0, MAX_HISTORY),
        })
        jobs.progress(job.id, 2, 2)
        jobLog(
          job,
          'info',
          pushResult.status === 'pushed'
            ? `pushed in ${pushResult.attempts} attempt(s)`
            : 'manifest already up to date',
        )
        jobs.finish(job.id, { result: { status: pushResult.status } })
        return {
          ok: true,
          created: false,
          status: pushResult.status,
          attempts: pushResult.attempts,
          jobId: job.id,
          gistName: config.gistName,
          gistId,
          gistUrl: pushResult.htmlUrl ?? gistUrl(gistId),
          version: pushResult.version,
          remote: summary,
          local,
        }
      } catch (error) {
        const info = errorInfo(error)
        jobLog(job, 'error', `push failed: ${info.message}`)
        jobs.finish(job.id, { error: info.message })
        throw error
      }
    })
  }

  return {
    config,
    status,
    preview,
    apply,
    checkLatest,
    applyLatest,
    push,
    isBusy: () => operation !== null,
    hasPreview: () => previewCache !== null,
    statePath,
    job: (jobId) => jobs.get(jobId),
    latestJob: (kind) => jobs.latest(kind),
    jobs: (kind) => jobs.list(kind),
    publicConfig: () => ({
      gistName: config.gistName,
    }),
    log,
  }
}
