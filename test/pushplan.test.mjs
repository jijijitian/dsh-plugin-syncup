import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPushPlan, applyPushPlan } from '../lib/pushplan.js'
import { normalizeManifest } from '../lib/manifest.js'

function manifestWith(hosts) {
  return normalizeManifest({ schemaVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z', hosts })
}

function host(hostId, bundles) {
  return { hostId, updatedAt: '2026-01-01T00:00:00.000Z', bundles }
}

function localEntry(bundles) {
  return {
    hostId: 'self',
    updatedAt: '2026-01-02T00:00:00.000Z',
    platform: 'win32',
    bundles,
  }
}

test('both sides present is a conflict that defaults to the newest version', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'pkg', spec: 'pkg@2.0.0', version: '2.0.0', enabled: true }]),
  })
  const plan = buildPushPlan({
    manifest,
    hostEntry: localEntry([{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }]),
    hostId: 'self',
  })
  const entry = plan.entries.find((item) => item.name === 'pkg')
  assert.equal(entry.kind, 'conflict')
  assert.equal(entry.newest, 'remote')
  assert.equal(entry.defaultChoice, 'newest')
  assert.equal(entry.resolution, 'remote')
  assert.deepEqual(entry.choices, ['newest', 'local', 'remote'])
})

test('a locally newer conflict defaults to local', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }]),
  })
  const plan = buildPushPlan({
    manifest,
    hostEntry: localEntry([{ name: 'pkg', spec: 'pkg@3.0.0', version: '3.0.0', enabled: true }]),
    hostId: 'self',
  })
  const entry = plan.entries.find((item) => item.name === 'pkg')
  assert.equal(entry.newest, 'local')
  assert.equal(entry.resolution, 'local')
})

test('remote-only bundles default to keep and can be dropped', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'remote-pkg', spec: 'remote-pkg@1.0.0', version: '1.0.0', enabled: true }]),
  })
  const plan = buildPushPlan({ manifest, hostEntry: localEntry([]), hostId: 'self' })
  const entry = plan.entries.find((item) => item.name === 'remote-pkg')
  assert.equal(entry.kind, 'remote-only')
  assert.deepEqual(entry.choices, ['keep', 'drop'])
  assert.equal(entry.defaultChoice, 'keep')
  assert.equal(plan.counts.needsChoice, 1)
})

test('local-only bundles are pushed without asking', () => {
  const manifest = manifestWith({ other: host('other', []) })
  const plan = buildPushPlan({
    manifest,
    hostEntry: localEntry([{ name: 'new-pkg', spec: 'new-pkg@1.0.0', version: '1.0.0', enabled: true }]),
    hostId: 'self',
  })
  const entry = plan.entries.find((item) => item.name === 'new-pkg')
  assert.equal(entry.kind, 'local-only')
  assert.deepEqual(entry.choices, ['push'])
  assert.equal(entry.defaultChoice, 'push')
})

test('identical bundles are reported as same', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }]),
  })
  const plan = buildPushPlan({
    manifest,
    hostEntry: localEntry([{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }]),
    hostId: 'self',
  })
  assert.equal(plan.entries[0].kind, 'same')
  assert.equal(plan.counts.same, 1)
})

test('the local host record is excluded from the remote comparison', () => {
  const manifest = manifestWith({
    self: host('self', [{ name: 'pkg', spec: 'pkg@9.0.0', version: '9.0.0', enabled: true }]),
  })
  const plan = buildPushPlan({
    manifest,
    hostEntry: localEntry([{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }]),
    hostId: 'self',
  })
  // Its own previous record must not look like a remote conflict.
  assert.equal(plan.entries[0].kind, 'local-only')
})

test('applyPushPlan resolves a conflict to the chosen side', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'pkg', spec: 'pkg@2.0.0', version: '2.0.0', enabled: true }]),
  })
  const hostEntry = localEntry([{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }])
  const plan = buildPushPlan({ manifest, hostEntry, hostId: 'self' })

  const remoteWins = applyPushPlan({ manifest, hostEntry, hostId: 'self', plan, selections: {} })
  assert.equal(remoteWins.manifest.hosts.self.bundles[0].version, '2.0.0')
  assert.equal(remoteWins.report.conflicts[0].side, 'remote')

  const localWins = applyPushPlan({ manifest, hostEntry, hostId: 'self', plan, selections: { pkg: 'local' } })
  assert.equal(localWins.manifest.hosts.self.bundles[0].version, '1.0.0')
  assert.equal(localWins.report.conflicts[0].side, 'local')
})

test('applyPushPlan keeps or drops a remote-only bundle', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'keep-me', spec: 'keep-me@1.0.0', version: '1.0.0', enabled: true }]),
    extra: host('extra', [{ name: 'drop-me', spec: 'drop-me@1.0.0', version: '1.0.0', enabled: true }]),
  })
  const hostEntry = localEntry([])
  const plan = buildPushPlan({ manifest, hostEntry, hostId: 'self' })

  const kept = applyPushPlan({ manifest, hostEntry, hostId: 'self', plan, selections: {} })
  assert.equal(kept.manifest.hosts.other.bundles.length, 1)
  assert.deepEqual(kept.report.kept.sort(), ['drop-me', 'keep-me'])

  const dropped = applyPushPlan({ manifest, hostEntry, hostId: 'self', plan, selections: { 'drop-me': 'drop' } })
  assert.equal(dropped.manifest.hosts.extra.bundles.length, 0)
  assert.equal(dropped.manifest.hosts.other.bundles.length, 1)
  assert.deepEqual(dropped.report.dropped, ['drop-me'])
})

test('applyPushPlan pushes local-only bundles into the host record', () => {
  const manifest = manifestWith({ other: host('other', []) })
  const hostEntry = localEntry([{ name: 'new-pkg', spec: 'new-pkg@1.0.0', version: '1.0.0', enabled: true }])
  const plan = buildPushPlan({ manifest, hostEntry, hostId: 'self' })
  const applied = applyPushPlan({ manifest, hostEntry, hostId: 'self', plan })
  assert.deepEqual(applied.manifest.hosts.self.bundles.map((bundle) => bundle.name), ['new-pkg'])
  assert.deepEqual(applied.report.pushed, ['new-pkg'])
  assert.equal(applied.manifest.lastWriter, 'self')
})

test('an empty plan leaves other hosts untouched', () => {
  const manifest = manifestWith({
    other: host('other', [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }]),
  })
  const hostEntry = localEntry([{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }])
  const plan = buildPushPlan({ manifest, hostEntry, hostId: 'self' })
  const applied = applyPushPlan({ manifest, hostEntry, hostId: 'self', plan })
  assert.deepEqual(applied.manifest.hosts.other.bundles.map((bundle) => bundle.spec), ['pkg@1.0.0'])
})
