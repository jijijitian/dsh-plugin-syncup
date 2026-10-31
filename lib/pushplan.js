import { compareVersions } from './spec.js'
import { desiredBundles } from './manifest.js'

function versionOf(bundle) {
  return typeof bundle?.version === 'string' ? bundle.version.trim() : ''
}

function specOf(bundle) {
  return typeof bundle?.spec === 'string' ? bundle.spec.trim() : ''
}

function sameEntry(left, right) {
  return specOf(left) === specOf(right) && versionOf(left) === versionOf(right) && (left?.enabled !== false) === (right?.enabled !== false)
}

/**
 * Compare what the Gist already holds with what this host would publish.
 *
 * Three cases drive the decision, per the requested policy:
 *
 *   - both sides have the bundle      → `conflict`: keep the newest version by
 *     default, with an override per row;
 *   - only the remote side has it     → `remote-only`: the user decides whether
 *     to keep it in the Gist;
 *   - only the local side has it      → `local-only`: push it without asking.
 */
export function buildPushPlan({ manifest, hostEntry, hostId, now = new Date().toISOString() }) {
  const localBundles = Array.isArray(hostEntry?.bundles) ? hostEntry.bundles : []
  const remote = desiredBundles(manifest, { includeDisabled: true, excludeHosts: hostId === undefined ? [] : [hostId] })
  const remoteByName = new Map(remote.map((item) => [item.name, item]))
  const localByName = new Map(localBundles.map((bundle) => [bundle.name, bundle]))

  const entries = []
  for (const bundle of localBundles) {
    const counterpart = remoteByName.get(bundle.name) ?? null
    if (counterpart === null) {
      entries.push({
        id: bundle.name,
        name: bundle.name,
        kind: 'local-only',
        local: { spec: specOf(bundle), version: versionOf(bundle), enabled: bundle.enabled !== false },
        remote: null,
        choices: ['push'],
        defaultChoice: 'push',
        resolution: 'local',
      })
      continue
    }
    const localVersion = versionOf(bundle)
    const remoteVersion = versionOf(counterpart)
    const order = compareVersions(localVersion, remoteVersion)
    if (order === 0 && sameEntry(bundle, counterpart)) {
      entries.push({
        id: bundle.name,
        name: bundle.name,
        kind: 'same',
        local: { spec: specOf(bundle), version: localVersion, enabled: bundle.enabled !== false },
        remote: {
          spec: specOf(counterpart),
          version: remoteVersion,
          enabled: counterpart.enabled !== false,
          hosts: counterpart.variants?.map((variant) => variant.hostId) ?? [],
        },
        choices: ['local'],
        defaultChoice: 'local',
        resolution: 'local',
      })
      continue
    }
    // The newest side wins by default; a tie keeps the local source.
    const newest = order > 0 ? 'local' : order < 0 ? 'remote' : 'local'
    entries.push({
      id: bundle.name,
      name: bundle.name,
      kind: 'conflict',
      local: { spec: specOf(bundle), version: localVersion, enabled: bundle.enabled !== false },
      remote: {
        spec: specOf(counterpart),
        version: remoteVersion,
        enabled: counterpart.enabled !== false,
        hosts: counterpart.variants?.map((variant) => variant.hostId) ?? [],
      },
      newest,
      choices: ['newest', 'local', 'remote'],
      defaultChoice: 'newest',
      resolution: newest,
    })
  }

  for (const item of remote) {
    if (localByName.has(item.name)) continue
    entries.push({
      id: item.name,
      name: item.name,
      kind: 'remote-only',
      local: null,
      remote: {
        spec: item.spec,
        version: item.version,
        enabled: item.enabled !== false,
        hosts: item.variants?.map((variant) => variant.hostId) ?? [],
      },
      choices: ['keep', 'drop'],
      defaultChoice: 'keep',
      resolution: 'keep',
    })
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))
  const counts = {
    entries: entries.length,
    conflict: entries.filter((entry) => entry.kind === 'conflict').length,
    remoteOnly: entries.filter((entry) => entry.kind === 'remote-only').length,
    localOnly: entries.filter((entry) => entry.kind === 'local-only').length,
    same: entries.filter((entry) => entry.kind === 'same').length,
    needsChoice: entries.filter((entry) => entry.kind === 'remote-only').length,
    pushed: entries.filter((entry) => entry.kind === 'local-only' || entry.kind === 'conflict' || entry.kind === 'same').length,
  }
  return { generatedAt: now, hostId, entries, counts }
}

function chooseConflict(entry, choice) {
  const localNewest = entry.newest === 'local'
  if (choice === 'local') return 'local'
  if (choice === 'remote') return 'remote'
  return localNewest ? 'local' : 'remote'
}

/**
 * Turn a confirmed plan into the manifest to write.
 *
 * Conflict rows decide which spec/version the local host record publishes, so the
 * Gist converges on one answer. `remote-only` rows left as `keep` are untouched;
 * `drop` removes the bundle from every other host record.
 */
export function applyPushPlan({ manifest, hostEntry, hostId, plan, selections = {}, now = new Date().toISOString() }) {
  const chosen = (entry) => {
    const raw = selections?.[entry.id]
    return entry.choices.includes(raw) ? raw : entry.defaultChoice
  }
  const dropped = new Set()
  const published = []
  const kept = []
  const pushed = []
  const conflicts = []

  const bundles = []
  for (const bundle of Array.isArray(hostEntry?.bundles) ? hostEntry.bundles : []) {
    const entry = plan.entries.find((item) => item.id === bundle.name)
    if (entry === undefined || entry.kind === 'local-only') {
      bundles.push(bundle)
      pushed.push(bundle.name)
      continue
    }
    if (entry.kind === 'same') {
      bundles.push(bundle)
      continue
    }
    const side = chooseConflict(entry, chosen(entry))
    const source = side === 'remote' ? entry.remote : entry.local
    conflicts.push({ name: bundle.name, side, version: source?.version ?? '', spec: source?.spec ?? '' })
    const spec = source?.spec !== undefined && source.spec !== '' ? source.spec : bundle.spec
    bundles.push({
      ...bundle,
      spec,
      version: source?.version !== undefined && source.version !== '' ? source.version : bundle.version,
    })
  }

  for (const entry of plan.entries) {
    if (entry.kind !== 'remote-only') continue
    if (chosen(entry) === 'drop') dropped.add(entry.name)
    else kept.push(entry.name)
  }

  const hosts = {}
  for (const [id, host] of Object.entries(manifest.hosts ?? {})) {
    if (id === hostId) continue
    const list = Array.isArray(host.bundles) ? host.bundles.filter((bundle) => !dropped.has(bundle.name)) : []
    hosts[id] = { ...host, bundles: list }
  }
  hosts[hostId] = { ...hostEntry, bundles }

  return {
    manifest: {
      ...manifest,
      schemaVersion: manifest.schemaVersion,
      generatedBy: manifest.generatedBy,
      updatedAt: now,
      lastWriter: hostId,
      hosts,
    },
    report: {
      pushed,
      kept,
      dropped: [...dropped],
      conflicts,
    },
  }
}
