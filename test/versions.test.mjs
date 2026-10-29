import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVersionChecker,
  gitHubTargetOf,
  newestTag,
  registryNameOf,
} from '../lib/versions.js'

test('registryNameOf separates npm specs from other sources', () => {
  assert.deepEqual(registryNameOf('dsh-mnemon'), { name: 'dsh-mnemon', range: '' })
  assert.deepEqual(registryNameOf('dsh-mnemon@0.5.35'), { name: 'dsh-mnemon', range: '0.5.35' })
  assert.deepEqual(registryNameOf('@xmanrui/dsh-im@5.6.0'), { name: '@xmanrui/dsh-im', range: '5.6.0' })
  assert.deepEqual(registryNameOf('@scope/pkg'), { name: '@scope/pkg', range: '' })
  assert.equal(registryNameOf('github:owner/repo#abc'), null)
  assert.equal(registryNameOf('file:/tmp/x.tgz'), null)
  assert.equal(registryNameOf('https://example.com/x.tgz'), null)
  assert.equal(registryNameOf(''), null)
  assert.equal(registryNameOf(null), null)
})

test('gitHubTargetOf reads shorthand and full URLs', () => {
  assert.deepEqual(gitHubTargetOf('github:owner/repo#abc123'), { owner: 'owner', repo: 'repo', ref: 'abc123' })
  assert.deepEqual(gitHubTargetOf('github:owner/repo'), { owner: 'owner', repo: 'repo', ref: '' })
  assert.deepEqual(
    gitHubTargetOf('git+https://github.com/owner/repo.git#v1.2.3'),
    { owner: 'owner', repo: 'repo', ref: 'v1.2.3' },
  )
  assert.equal(gitHubTargetOf('dsh-mnemon@0.5.35'), null)
})

test('newestTag compares versions numerically, not lexically', () => {
  assert.equal(newestTag(['v3.4.2', 'v3.10.0', 'v2.9.9']), '3.10.0')
  assert.equal(newestTag(['1.0.0', 'latest', 'nope']), '1.0.0')
  assert.equal(newestTag([]), '')
  assert.equal(newestTag(null), '')
})

function fakeFetch(routes) {
  return async (url) => {
    const match = Object.keys(routes).find((key) => url.includes(key))
    if (match === undefined) return { ok: false, status: 404, json: async () => ({}) }
    const value = routes[match]
    return { ok: true, status: 200, json: async () => value }
  }
}

test('npm lookup uses dist-tags.latest', async () => {
  const checker = createVersionChecker({
    fetchImpl: fakeFetch({ '/dsh-mnemon': { 'dist-tags': { latest: '0.5.36' }, versions: { '0.5.35': {}, '0.5.36': {} } } }),
  })
  const found = await checker.latestFor('dsh-mnemon@0.5.35')
  assert.equal(found.kind, 'npm')
  assert.equal(found.latest, '0.5.36')
})

test('npm lookup falls back to the newest listed version', async () => {
  const checker = createVersionChecker({
    fetchImpl: fakeFetch({ '/dsh-x': { versions: { '1.0.0': {}, '1.12.0': {}, '1.9.0': {} } } }),
  })
  const found = await checker.latestFor('dsh-x')
  assert.equal(found.latest, '1.12.0')
})

test('github lookup prefers the newest version tag', async () => {
  const checker = createVersionChecker({
    fetchImpl: fakeFetch({
      '/repos/owner/repo/tags': [{ name: 'v3.4.1', commit: { sha: 'aaa' } }, { name: 'v3.10.0', commit: { sha: 'bbb' } }],
    }),
  })
  const found = await checker.latestFor('github:owner/repo#old')
  assert.equal(found.kind, 'github')
  assert.equal(found.latest, '3.10.0')
  assert.equal(found.sha, 'bbb')
})

test('an unsupported source is reported rather than guessed', async () => {
  const checker = createVersionChecker({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) })
  const found = await checker.latestFor('file:/tmp/pkg.tgz')
  assert.equal(found.latest, null)
  assert.equal(found.ok, false)
  assert.equal(found.code, 'unsupported')
})

test('checkAll marks outdated entries and keeps failures separate', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/dsh-old')) {
        return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '2.0.0' } }) }
      }
      if (url.includes('/dsh-now')) {
        return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '1.0.0' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const results = await checker.checkAll([
    { name: 'dsh-old', spec: 'dsh-old@1.0.0', version: '1.0.0' },
    { name: 'dsh-now', spec: 'dsh-now@1.0.0', version: '1.0.0' },
    { name: 'dsh-missing', spec: 'dsh-missing@1.0.0', version: '1.0.0' },
    { name: 'local', spec: 'file:/tmp/x.tgz', version: '1.0.0' },
  ])
  assert.equal(results[0].outdated, true)
  assert.equal(results[0].latest, '2.0.0')
  assert.equal(results[1].outdated, false)
  assert.equal(results[2].error, 'not-found')
  assert.equal(results[3].error, 'unsupported')
})

test('a network failure is reported, not thrown', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => {
      throw new Error('boom')
    },
  })
  const found = await checker.latestFor('dsh-mnemon')
  assert.equal(found.ok, false)
  assert.equal(found.code, 'network')
})
