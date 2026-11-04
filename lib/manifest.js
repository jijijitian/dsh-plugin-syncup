import { compareVersions, formatIso, isLocalSpec, isPortableSpec, isRecord } from './spec.js'

export const MANIFEST_SCHEMA_VERSION = 1
export const MANIFEST_GENERATOR = 'dsh-plugin-syncup'

const MAX_BUNDLES_PER_HOST = 2000

export function emptyManifest(now = new Date().toISOString()) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: MANIFEST_GENERATOR,
    updatedAt: now,
    hosts: {},
  }
}

function normalizePackageName(value) {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  if (name === '' || name.length > 214) return ''
  if (!/^(?:@[^/\s]+\/)?[^/\s]+$/.test(name)) return ''
  return name
}

function normalizeSpec(value) {
  if (typeof value !== 'string') return ''
  const spec = value.trim()
  return isPortableSpec(spec) ? spec : ''
}

function normalizeBundle(value) {
  if (!isRecord(value)) return null
  const name = normalizePackageName(value.name)
  if (name === '') return null
  const version = typeof value.version === 'string' ? value.version.trim() : ''
  const spec = normalizeSpec(value.spec) || (version === '' ? '' : normalizeSpec(`${name}@${version}`))
  if (spec === '') return null
  return {
    name,
    spec,
    version,
    enabled: value.enabled !== false,
    ...(typeof value.source === 'string' && value.source.trim() !== ''
      ? { source: value.source.trim() }
      : {}),
  }
}

export function normalizeHostEntry(value, hostId) {
  if (!isRecord(value)) return null
  if (['__proto__', 'constructor', 'prototype'].includes(hostId)) return null
  const bundles = []
  const seen = new Set()
  if (Array.isArray(value.bundles)) {
    for (const rawBundle of value.bundles) {
      const bundle = normalizeBundle(rawBundle)
      if (bundle === null || seen.has(bundle.name)) continue
      bundles.push(bundle)
      seen.add(bundle.name)
      if (bundles.length >= MAX_BUNDLES_PER_HOST) break
    }
  }
  bundles.sort((left, right) => left.name.localeCompare(right.name))
  return {
    hostId: typeof value.hostId === 'string' && value.hostId.trim() !== '' ? value.hostId.trim() : hostId,
    updatedAt: formatIso(value.updatedAt),
    ...(typeof value.dshVersion === 'string' && value.dshVersion.trim() !== ''
      ? { dshVersion: value.dshVersion.trim() }
      : {}),
    ...(typeof value.profile === 'string' && value.profile.trim() !== ''
      ? { profile: value.profile.trim() }
      : {}),
    ...(typeof value.platform === 'string' && value.platform.trim() !== ''
      ? { platform: value.platform.trim() }
      : {}),
    bundles,
  }
}

export function normalizeManifest(value, { source = 'manifest', requireShape = false } = {}) {
  if (value === null || value === undefined) return emptyManifest()
  if (!isRecord(value)) throw new Error(`${source} must be a JSON object`)
  if (
    requireShape
    && value.schemaVersion === undefined
    && value.hosts === undefined
    && value.generatedBy === undefined
  ) {
    throw new Error(`${source} does not look like a plugin-sync manifest; refusing to overwrite it`)
  }
  const schemaVersion = value.schemaVersion === undefined ? MANIFEST_SCHEMA_VERSION : value.schemaVersion
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`${source} has an invalid schemaVersion`)
  }
  if (schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `${source} uses schemaVersion ${schemaVersion}; this plugin supports up to ${MANIFEST_SCHEMA_VERSION}`,
    )
  }
  const hosts = {}
  if (value.hosts !== undefined) {
    if (!isRecord(value.hosts)) throw new Error(`${source}.hosts must be a JSON object`)
    for (const [hostId, rawHost] of Object.entries(value.hosts)) {
      const host = normalizeHostEntry(rawHost, hostId)
      if (host !== null) hosts[hostId] = host
    }
  }
  return {
    ...value,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: typeof value.generatedBy === 'string' ? value.generatedBy : MANIFEST_GENERATOR,
    updatedAt: formatIso(value.updatedAt),
    hosts,
  }
}

export function pickInstallSpec(bundle) {
  if (!isRecord(bundle)) return ''
  const target = isRecord(bundle.installTarget) ? bundle.installTarget.spec : undefined
  if (typeof target === 'string' && isPortableSpec(target)) return target.trim()
  const source = typeof bundle.source === 'string' ? bundle.source.trim() : ''
  if (source !== '') {
    if (isLocalSpec(source)) return ''
    if (/^(?:github:|git\+|https?:|npm:)/i.test(source) || /^git@[^:\s]+:[^ \t]+$/.test(source)) return source
    if (typeof bundle.version === 'string' && bundle.version.trim() !== '') {
      return `${bundle.name}@${bundle.version.trim()}`
    }
    if (isPortableSpec(source)) return source
  }
  if (typeof bundle.version === 'string' && bundle.version.trim() !== '') {
    return `${bundle.name}@${bundle.version.trim()}`
  }
  return ''
}

export function localHostEntry(bundles, {
  hostId,
  profile = '',
  platform = process.platform,
  now = new Date().toISOString(),
  exclude = [],
} = {}) {
  const excluded = new Set(exclude)
  const entries = []
  const seen = new Set()
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    if (!isRecord(bundle) || typeof bundle.name !== 'string') continue
    if (bundle.availability !== 'profile') continue
    if (bundle.installed !== true) continue
    if (bundle.removable === false) continue
    if (excluded.has(bundle.name) || seen.has(bundle.name)) continue
    const spec = pickInstallSpec(bundle)
    if (!isPortableSpec(spec)) continue
    seen.add(bundle.name)
    entries.push({
      name: bundle.name,
      spec,
      version: typeof bundle.version === 'string' ? bundle.version : '',
      enabled: bundle.enabled !== false,
      ...(typeof bundle.source === 'string' && bundle.source.trim() !== ''
        ? { source: bundle.source.trim() }
        : {}),
    })
    if (entries.length >= MAX_BUNDLES_PER_HOST) break
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const dshVersion = (Array.isArray(bundles) ? bundles : []).find(
    (bundle) => isRecord(bundle) && bundle.name === '@deepseek-ai/dsh-base' && typeof bundle.version === 'string',
  )?.version
  return {
    hostId,
    updatedAt: formatIso(now),
    ...(typeof dshVersion === 'string' && dshVersion !== '' ? { dshVersion } : {}),
    ...(profile !== '' ? { profile } : {}),
    platform,
    bundles: entries,
  }
}

export function mergeHost(manifest, hostId, hostEntry, now = new Date().toISOString()) {
  return {
    ...manifest,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: MANIFEST_GENERATOR,
    updatedAt: formatIso(now),
    lastWriter: hostId,
    hosts: {
      ...manifest.hosts,
      [hostId]: hostEntry,
    },
  }
}

function candidateOrder(left, right) {
  const versionCompared = compareVersions(left.version, right.version)
  if (versionCompared !== 0) return -versionCompared
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
}

export function desiredBundles(manifest, {
  includeDisabled = false,
  exclude = [],
  excludeHosts = [],
} = {}) {
  const excluded = new Set(exclude)
  const ignoredHosts = new Set(excludeHosts)
  const groups = new Map()
  for (const [hostId, host] of Object.entries(manifest.hosts ?? {})) {
    if (ignoredHosts.has(hostId)) continue
    for (const bundle of host.bundles ?? []) {
      if (excluded.has(bundle.name)) continue
      let group = groups.get(bundle.name)
      if (group === undefined) {
        group = []
        groups.set(bundle.name, group)
      }
      group.push({
        ...bundle,
        hostId,
        hostUpdatedAt: host.updatedAt,
      })
    }
  }
  const desired = []
  for (const [name, candidates] of groups) {
    const enabled = candidates.some((candidate) => candidate.enabled !== false)
    if (!enabled && !includeDisabled) continue
    candidates.sort(candidateOrder)
    const best = candidates[0]
    const variants = candidates.map((candidate) => ({
      hostId: candidate.hostId,
      spec: candidate.spec,
      version: candidate.version,
      enabled: candidate.enabled !== false,
      updatedAt: candidate.hostUpdatedAt,
    }))
    const distinctVariants = new Set(variants.map((variant) => `${variant.spec}\u0000${variant.version}`))
    desired.push({
      name,
      spec: best.spec,
      version: best.version,
      enabled,
      hostId: best.hostId,
      hostUpdatedAt: best.hostUpdatedAt,
      hosts: [...new Set(candidates.map((candidate) => candidate.hostId))].sort(),
      variants,
      hostConflict: distinctVariants.size > 1,
    })
  }
  desired.sort((left, right) => left.name.localeCompare(right.name))
  return desired
}

export function summarizeManifest(manifest) {
  const hosts = Object.values(manifest.hosts ?? {}).map((host) => ({
    hostId: host.hostId,
    updatedAt: host.updatedAt,
    ...(host.dshVersion === undefined ? {} : { dshVersion: host.dshVersion }),
    ...(host.profile === undefined ? {} : { profile: host.profile }),
    bundles: host.bundles.length,
    enabled: host.bundles.filter((bundle) => bundle.enabled).length,
  }))
  hosts.sort((left, right) => left.hostId.localeCompare(right.hostId))
  return {
    schemaVersion: manifest.schemaVersion,
    generatedBy: manifest.generatedBy,
    updatedAt: manifest.updatedAt,
    hostCount: hosts.length,
    bundleCount: hosts.reduce((total, host) => total + host.bundles, 0),
    hosts,
  }
}
