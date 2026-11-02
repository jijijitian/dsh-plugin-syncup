import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVersionChecker,
  gitHubTargetOf,
  gitHubTargetOfRepository,
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

test('github lookup falls back to tags when the repo has no releases', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      // A successful, empty release list is the only thing that permits the fallback.
      if (url.includes('/releases')) return { ok: true, status: 200, json: async () => [] }
      if (url.includes('/tags')) {
        return { ok: true, status: 200, json: async () => [{ name: 'v3.4.1', commit: { sha: 'aaa' } }, { name: 'v3.10.0', commit: { sha: 'bbb' } }] }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const found = await checker.latestFor('github:owner/repo#old')
  assert.equal(found.kind, 'github')
  assert.equal(found.latest, '3.10.0')
  assert.equal(found.source, 'tag')
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

test('gitHubTargetOfRepository reads package metadata repository fields', () => {
  assert.deepEqual(
    gitHubTargetOfRepository({ url: 'git+https://github.com/dingminhua/dsh-connect-workbuddy.git', type: 'git' }),
    { owner: 'dingminhua', repo: 'dsh-connect-workbuddy', ref: '' },
  )
  assert.deepEqual(gitHubTargetOfRepository('git+https://github.com/o/r.git'), { owner: 'o', repo: 'r', ref: '' })
  assert.deepEqual(gitHubTargetOfRepository('o/r'), { owner: 'o', repo: 'r', ref: '' })
  assert.equal(gitHubTargetOfRepository('https://gitlab.com/o/r.git'), null)
  assert.equal(gitHubTargetOfRepository(null), null)
  assert.equal(gitHubTargetOfRepository(''), null)
})

test('an npm spec also consults the repository and keeps the newer release', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/releases')) {
        // The GitHub release is ahead of the published npm version.
        return { ok: true, status: 200, json: async () => [{ tag_name: 'v5.18.0', draft: false, prerelease: false }] }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          'dist-tags': { latest: '5.17.0' },
          repository: { url: 'git+https://github.com/dingminhua/dsh-connect-workbuddy.git' },
        }),
      }
    },
  })
  const found = await checker.latestFor('dsh-connect-workbuddy@5.17.0')
  assert.equal(found.latest, '5.18.0')
  assert.equal(found.source, 'release')
  assert.equal(found.npmLatest, '5.17.0')
  assert.equal(found.githubLatest, '5.18.0')
})

test('an npm spec keeps the npm version when it is the newer one', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/repos/')) {
        return { ok: true, status: 200, json: async () => [{ name: 'v1.2.0', commit: { sha: 'bbb' } }] }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          'dist-tags': { latest: '1.9.0' },
          repository: { url: 'git+https://github.com/o/r.git' },
        }),
      }
    },
  })
  const found = await checker.latestFor('pkg@1.0.0')
  assert.equal(found.latest, '1.9.0')
  assert.equal(found.source, 'npm')
})

test('an npm package without repository metadata reports only npm', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '2.0.0' } }) }),
  })
  const found = await checker.latestFor('pkg@1.0.0')
  assert.equal(found.latest, '2.0.0')
  assert.equal(found.kind, 'npm')
  assert.equal(found.githubLatest, undefined)
})

test('checkAll flags an npm package as outdated when only the git tag moved', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/repos/')) return { ok: true, status: 200, json: async () => [{ name: 'v5.18.0' }] }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          'dist-tags': { latest: '5.17.0' },
          repository: { url: 'git+https://github.com/dingminhua/dsh-connect-workbuddy.git' },
        }),
      }
    },
  })
  const [result] = await checker.checkAll([
    { name: 'dsh-connect-workbuddy', spec: 'dsh-connect-workbuddy@5.17.0', version: '5.17.0' },
  ])
  assert.equal(result.outdated, true)
  assert.equal(result.latest, '5.18.0')
})

test('a tag without a matching release is ignored', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/releases')) {
        // v5.18.0 is tagged but never released; the newest release is 5.17.0.
        return { ok: true, status: 200, json: async () => [{ tag_name: 'v5.17.0', draft: false, prerelease: false }] }
      }
      if (url.includes('/tags')) {
        return { ok: true, status: 200, json: async () => [{ name: 'v5.18.0' }, { name: 'v5.17.0' }] }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '5.17.0')
  assert.equal(found.source, 'release')
})

test('prereleases and drafts are skipped when a stable release exists', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: 'v6.0.0', draft: false, prerelease: true },
        { tag_name: 'v5.19.0', draft: true, prerelease: false },
        { tag_name: 'v5.18.0', draft: false, prerelease: false },
      ],
    }),
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '5.18.0')
  assert.equal(found.prerelease, false)
})

test('a -beta tag is skipped even when GitHub does not flag it', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: 'v5.20.0-beta.1', draft: false, prerelease: false },
        { tag_name: 'v5.18.0', draft: false, prerelease: false },
      ],
    }),
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '5.18.0')
})

test('a repository with no release falls back to tags', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/releases')) return { ok: true, status: 200, json: async () => [] }
      if (url.includes('/tags')) return { ok: true, status: 200, json: async () => [{ name: 'v2.3.0' }] }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '2.3.0')
  assert.equal(found.source, 'tag')
})

test('equal versions on both sides resolve to npm', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/releases')) {
        return { ok: true, status: 200, json: async () => [{ tag_name: 'v5.17.0', draft: false, prerelease: false }] }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          'dist-tags': { latest: '5.17.0' },
          repository: { url: 'git+https://github.com/o/r.git' },
        }),
      }
    },
  })
  const found = await checker.latestFor('pkg@5.17.0')
  assert.equal(found.latest, '5.17.0')
  assert.equal(found.source, 'npm')
  assert.equal(found.githubLatest, '5.17.0')
})

test('a failed release read does not silently fall back to tags', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      // Rate limit / auth failure: the release list is unknown, not empty.
      if (url.includes('/releases')) return { ok: false, status: 403, json: async () => ({}) }
      if (url.includes('/tags')) return { ok: true, status: 200, json: async () => [{ name: 'v9.9.9' }] }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, null)
  assert.equal(found.ok, false)
  assert.notEqual(found.latest, '9.9.9', 'a tag must not answer for an unreadable release list')
})

test('platform tags ahead of the newest release do not win', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/releases')) {
        return { ok: true, status: 200, json: async () => [{ tag_name: 'v0.4.2', draft: false, prerelease: false }] }
      }
      if (url.includes('/tags')) {
        return { ok: true, status: 200, json: async () => [{ name: 'v2.0.0+win' }, { name: 'v1.0.0' }, { name: 'v0.4.2' }] }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '0.4.2')
  assert.equal(found.source, 'release')
})

test('an alpha release is skipped in favour of the newest stable release', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: 'v0.5.0-alpha4', draft: false, prerelease: true },
        { tag_name: 'v0.5.0-alpha3', draft: false, prerelease: true },
        { tag_name: 'v0.4.4', draft: false, prerelease: false },
      ],
    }),
  })
  const found = await checker.latestFor('github:T-Auto/dsh-ops')
  assert.equal(found.latest, '0.4.4')
  assert.equal(found.prerelease, false)
})

test('an alpha tag is skipped even when GitHub forgets the prerelease flag', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: 'v0.5.0-alpha4', draft: false, prerelease: false },
        { tag_name: 'v0.4.4', draft: false, prerelease: false },
      ],
    }),
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '0.4.4')
})

test('the tag fallback is reported to the caller', async () => {
  const seen = []
  const checker = createVersionChecker({
    onReleaseFallback: (target, info) => seen.push([target.repo, info.reason]),
    fetchImpl: async (url) => {
      if (url.includes('/releases')) {
        return { ok: true, status: 200, json: async () => [{ tag_name: 'v1.0.0-beta.1', draft: false, prerelease: true }] }
      }
      if (url.includes('/tags')) return { ok: true, status: 200, json: async () => [{ name: 'v0.9.0' }] }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '0.9.0')
  assert.equal(found.source, 'tag')
  assert.deepEqual(seen, [['r', 'no-stable-release']])
})

test('a platform build is never picked even when its number is higher', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: 'v2.0.0+win', draft: false, prerelease: false, published_at: '2026-09-20T11:56:37Z' },
        { tag_name: 'v0.4.2', draft: false, prerelease: false, published_at: '2026-10-11T12:25:56Z' },
        { tag_name: 'v0.4.1', draft: false, prerelease: false, published_at: '2026-10-11T07:32:38Z' },
      ],
    }),
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '0.4.2')
  assert.notEqual(found.latest, '2.0.0')
})

test('the newest release is the one published last, not the highest number', async () => {
  const checker = createVersionChecker({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [
        // 0.9.0 was published after 1.0.0: the project went back to the 0.x line.
        { tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: '2026-01-10T00:00:00Z' },
        { tag_name: 'v0.9.0', draft: false, prerelease: false, published_at: '2026-06-01T00:00:00Z' },
      ],
    }),
  })
  const found = await checker.latestFor('github:o/r')
  assert.equal(found.latest, '0.9.0')
  assert.equal(found.publishedAt, '2026-06-01T00:00:00.000Z')
})

test('channels report what each source offers', async () => {
  const checker = createVersionChecker({
    fetchImpl: async (url) => {
      if (url.includes('/releases')) {
        return { ok: true, status: 200, json: async () => [{ tag_name: 'v2.0.0', draft: false, prerelease: false }] }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          'dist-tags': { latest: '1.0.0' },
          repository: { url: 'git+https://github.com/o/r.git' },
        }),
      }
    },
  })
  const found = await checker.latestFor('pkg@1.0.0')
  assert.deepEqual(found.channels, { npm: '1.0.0', github: '2.0.0' })
  assert.equal(found.latest, '2.0.0')
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
