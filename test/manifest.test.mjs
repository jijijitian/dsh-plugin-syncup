import test from 'node:test'
import assert from 'node:assert/strict'
import {
  desiredBundles,
  localHostEntry,
  mergeHost,
  normalizeManifest,
  sameManifestContent,
  summarizeManifest,
} from '../lib/manifest.js'
import { compareVersions, isPortableSpec, normalizeRepo } from '../lib/spec.js'

test('normalizeRepo accepts GitHub URLs and owner/name', () => {
  assert.equal(normalizeRepo('owner/repo'), 'owner/repo')
  assert.equal(normalizeRepo('https://github.com/owner/repo.git'), 'owner/repo')
  assert.equal(normalizeRepo('git@github.com:owner/repo.git'), 'owner/repo')
  assert.equal(normalizeRepo('not a repo'), '')
})

test('isPortableSpec rejects local sources and accepts package sources', () => {
  assert.equal(isPortableSpec('dsh-context@0.74.0'), true)
  assert.equal(isPortableSpec('@scope/pkg@1.2.3'), true)
  assert.equal(isPortableSpec('github:owner/repo#abc'), true)
  assert.equal(isPortableSpec('https://example.com/pkg.tgz'), true)
  assert.equal(isPortableSpec('file:../pkg'), false)
  assert.equal(isPortableSpec('C:\\work\\pkg'), false)
  assert.equal(isPortableSpec('/home/me/pkg'), false)
  assert.equal(isPortableSpec('../pkg'), false)
  assert.equal(isPortableSpec('link:../pkg'), false)
})

test('localHostEntry keeps portable profile bundles only', () => {
  const bundles = [
    { name: 'dsh-context', availability: 'profile', installed: true, enabled: true, version: '0.74.0', source: 'dsh-context@^0.74.0' },
    { name: 'dsh-local', availability: 'profile', installed: true, enabled: true, version: '1.0.0', source: 'file:../dsh-local' },
    { name: 'official', availability: 'installation', installed: false, enabled: true, version: '0.2.1-rc.2' },
    { name: 'disabled', availability: 'profile', installed: true, enabled: false, version: '2.0.0', source: 'github:o/r#abc' },
  ]
  const entry = localHostEntry(bundles, { hostId: 'host-a', profile: 'desktop', now: '2026-01-01T00:00:00.000Z' })
  assert.equal(entry.hostId, 'host-a')
  assert.deepEqual(entry.bundles.map((bundle) => bundle.name), ['disabled', 'dsh-context'])
  assert.equal(entry.bundles[1].spec, 'dsh-context@0.74.0')
  assert.equal(entry.bundles[0].spec, 'github:o/r#abc')
  assert.equal(entry.bundles[0].enabled, false)
})

test('mergeHost replaces one host and preserves others', () => {
  const manifest = normalizeManifest({
    schemaVersion: 1,
    hosts: { a: { bundles: [{ name: 'a-pkg', spec: 'a-pkg@1.0.0' }] } },
  })
  const next = mergeHost(manifest, 'b', { hostId: 'b', updatedAt: '2026-01-02T00:00:00.000Z', bundles: [] }, '2026-01-02T00:00:00.000Z')
  assert.deepEqual(Object.keys(next.hosts).sort(), ['a', 'b'])
  assert.equal(next.lastWriter, 'b')
})

test('desiredBundles unions hosts and chooses the highest version', () => {
  const manifest = normalizeManifest({
    schemaVersion: 1,
    updatedAt: '2026-01-03T00:00:00.000Z',
    hosts: {
      a: {
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }],
      },
      b: {
        updatedAt: '2026-01-02T00:00:00.000Z',
        bundles: [{ name: 'pkg', spec: 'pkg@2.0.0', version: '2.0.0', enabled: true }],
      },
    },
  })
  const desired = desiredBundles(manifest)
  assert.equal(desired.length, 1)
  assert.equal(desired[0].spec, 'pkg@2.0.0')
  assert.deepEqual(desired[0].hosts, ['a', 'b'])
  assert.equal(desired[0].enabled, true)
})

test('desiredBundles skips bundles disabled everywhere unless requested', () => {
  const manifest = normalizeManifest({
    schemaVersion: 1,
    hosts: {
      a: { bundles: [{ name: 'pkg', spec: 'pkg@1.0.0', enabled: false }] },
    },
  })
  assert.equal(desiredBundles(manifest).length, 0)
  assert.equal(desiredBundles(manifest, { includeDisabled: true }).length, 1)
})

test('desiredBundles exposes host variants and can ignore the local host', () => {
  const manifest = normalizeManifest({
    schemaVersion: 1,
    hosts: {
      a: { bundles: [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0', enabled: true }] },
      b: { bundles: [{ name: 'pkg', spec: 'pkg@2.0.0', version: '2.0.0', enabled: true }] },
      self: { bundles: [{ name: 'self-only', spec: 'self-only@1.0.0', version: '1.0.0', enabled: true }] },
    },
  })
  const desired = desiredBundles(manifest, { excludeHosts: ['self'] })
  assert.equal(desired.length, 1)
  assert.equal(desired[0].hostConflict, true)
  assert.deepEqual(desired[0].hosts, ['a', 'b'])
  assert.equal(desired[0].variants.length, 2)
})

test('normalizeManifest rejects newer schemas and invalid shapes', () => {
  assert.throws(() => normalizeManifest({ schemaVersion: 2, hosts: {} }), /supports up to/)
  assert.throws(() => normalizeManifest([]), /JSON object/)
  assert.throws(() => normalizeManifest({ schemaVersion: 1, hosts: [] }), /hosts/)
  assert.throws(
    () => normalizeManifest({ name: 'some-other-json' }, { requireShape: true }),
    /refusing to overwrite/,
  )
})

test('compareVersions handles prereleases', () => {
  assert.ok(compareVersions('1.2.3', '1.2.2') > 0)
  assert.ok(compareVersions('1.2.3', '1.2.3-rc.2') > 0)
  assert.ok(compareVersions('1.2.3-rc.2', '1.2.3-rc.1') > 0)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
})

test('sameManifestContent ignores publish timestamps and the last writer', () => {
  const left = normalizeManifest({
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastWriter: 'a',
    hosts: {
      a: {
        hostId: 'a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0' }],
      },
    },
  })
  const republished = {
    ...left,
    updatedAt: '2026-02-02T00:00:00.000Z',
    lastWriter: 'a',
    hosts: { a: { ...left.hosts.a, updatedAt: '2026-02-02T00:00:00.000Z' } },
  }
  assert.equal(sameManifestContent(left, republished), true)
})

test('sameManifestContent still sees inventory changes', () => {
  const base = normalizeManifest({
    schemaVersion: 1,
    hosts: {
      a: { hostId: 'a', bundles: [{ name: 'pkg', spec: 'pkg@1.0.0', version: '1.0.0' }] },
      b: { hostId: 'b', bundles: [] },
    },
  })
  const bumped = {
    ...base,
    hosts: { ...base.hosts, a: { ...base.hosts.a, bundles: [{ name: 'pkg', spec: 'pkg@1.1.0', version: '1.1.0' }] } },
  }
  assert.equal(sameManifestContent(base, bumped), false)
  const reordered = {
    ...base,
    hosts: { b: base.hosts.b, a: base.hosts.a },
  }
  assert.equal(sameManifestContent(base, reordered), true)
})

test('summarizeManifest reports host and bundle counts', () => {
  const manifest = normalizeManifest({
    schemaVersion: 1,
    hosts: {
      a: { bundles: [{ name: 'a-pkg', spec: 'a-pkg@1.0.0' }, { name: 'b-pkg', spec: 'b-pkg@1.0.0' }] },
      b: { bundles: [] },
    },
  })
  const summary = summarizeManifest(manifest)
  assert.equal(summary.hostCount, 2)
  assert.equal(summary.bundleCount, 2)
})
