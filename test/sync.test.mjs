import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSyncRuntime } from '../lib/sync.js'

function startMock(initial) {
  let state = initial === null
    ? null
    : {
        id: '0123456789abcdef',
        text: typeof initial === 'string' ? initial : `${JSON.stringify(initial, null, 2)}\n`,
        version: 'version-1',
      }
  let versionCounter = 1
  let writes = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/gists') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(state === null ? [] : [{
        id: state.id,
        description: 'dsh-plugin-sync',
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-02T00:00:00.000Z',
        history: [{ version: state.version }],
      }]))
      return
    }
    if (req.method === 'GET' && url.pathname === '/gists/0123456789abcdef') {
      if (state === null) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'Not Found' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', etag: `"${state.version}"` })
      res.end(JSON.stringify({
        id: state.id,
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-01T00:00:00.000Z',
        history: [{ version: state.version }],
        files: {
          'dsh-plugins.json': { filename: 'dsh-plugins.json', content: state.text, truncated: false },
        },
      }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/gists') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      state = {
        id: '0123456789abcdef',
        text: body.files['dsh-plugins.json'].content,
        version: 'version-1',
      }
      writes += 1
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: state.id,
        public: body.public,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-01T00:00:00.000Z',
        history: [{ version: state.version }],
      }))
      return
    }
    if (req.method === 'PATCH' && url.pathname === '/gists/0123456789abcdef') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      if (req.headers['if-match'] !== undefined && req.headers['if-match'] !== `"${state.version}"`) {
        res.writeHead(412, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'etag does not match' }))
        return
      }
      versionCounter += 1
      state = {
        ...state,
        text: body.files['dsh-plugins.json'].content,
        version: `version-${versionCounter}`,
      }
      writes += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        id: state.id,
        public: false,
        html_url: 'https://gist.github.com/0123456789abcdef',
        updated_at: '2026-01-02T00:00:00.000Z',
        history: [{ version: state.version }],
      }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'Not Found' }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        apiBaseUrl: `http://127.0.0.1:${address.port}`,
        readState: () => (state === null ? null : { ...state, parsed: JSON.parse(state.text) }),
        writes: () => writes,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

function makeConfig(overrides = {}) {
  return {
    gistName: 'dsh-plugin-sync',
    fileName: 'dsh-plugins.json',
    description: 'DSH plugin inventory',
    apiBaseUrl: 'http://127.0.0.1:1',
    token: 'x',
    tokenEnv: 'GITHUB_TOKEN',
    tokenFile: '',
    hostId: 'host-local',
    stateFile: '',
    profile: 'desktop',
    dshHome: '',
    maxInstallsPerRun: 20,
    requestTimeoutMs: 5000,
    allowInsecureHttp: true,
    excludeBundles: [],
    configError: undefined,
    ...overrides,
  }
}

class FakeManager {
  constructor(bundles, { hmr = false, failInstall = null, stuck = [] } = {}) {
    this.bundles = bundles
    this.calls = []
    this.hmr = hmr
    this.failInstall = failInstall
    this.stuck = new Set(stuck)
    this.present = new Set(bundles.map((bundle) => bundle.name))
    this.selected = new Set(bundles.map((bundle) => bundle.name))
  }

  async listBundles() {
    return this.bundles.map((bundle) => ({ ...bundle }))
  }

  async installBundle(spec, options) {
    this.calls.push({ spec, options })
    const at = spec.lastIndexOf('@')
    const name = spec.startsWith('@') && at === 0 ? spec : at > 0 ? spec.slice(0, at) : spec
    // dsh 0.2.1 rejects re-adding an existing dependency outright while hmr is live.
    if (this.hmr && this.present.has(name)) {
      return { changed: false, application: 'failed', stage: 'install', target: name, error: { code: 'already-installed' } }
    }
    if (this.failInstall !== null && this.failInstall(name, spec) === true) {
      return { changed: false, application: 'failed', stage: 'install', target: name, error: { code: 'incompatible-version' } }
    }
    this.bundles.push({
      name,
      version: '9.9.9',
      availability: 'profile',
      installed: true,
      enabled: true,
      removable: true,
      // The real manager reports the installed spec through installTarget,
      // not a top-level `spec`; mirror that so a regression is caught here.
      installTarget: { spec },
      source: spec,
    })
    this.present.add(name)
    return { changed: true, application: 'applied', version: '9.9.9', warnings: [] }
  }

  async setBundleEnabled(name, enabled) {
    // Mirror the real manager: selection is persisted, but HMR may refuse to
    // actually unload a module, which is what removeBundle then reports.
    this.calls.push({ enabled: name, value: enabled })
    const bundle = this.bundles.find((item) => item.name === name)
    if (bundle === undefined) {
      return { changed: false, application: 'failed', stage: 'enable', target: name, error: { code: 'unknown-plugin' } }
    }
    if (enabled === false && this.stuck.has(name)) {
      return { changed: true, application: 'applied', stage: 'enable', target: name, enabled: false }
    }
    bundle.enabled = enabled
    return { changed: true, application: 'applied', stage: 'enable', target: name, enabled }
  }

  async removeBundle(name) {
    this.calls.push({ removed: name })
    const bundle = this.bundles.find((item) => item.name === name)
    // The real manager deselects first, then refuses; the deselection sticks.
    if (bundle !== undefined && this.stuck.has(name)) {
      bundle.enabled = false
      this.selected.delete(name)
      return { changed: true, application: 'failed', stage: 'remove', target: name, error: { code: 'bundle-in-use' } }
    }
    this.bundles = this.bundles.filter((item) => item.name !== name)
    this.present.delete(name)
    return { changed: true, application: 'applied', stage: 'remove', target: name, warnings: [] }
  }

  isSelected(name) {
    return this.selected.has(name)
  }
}

function findEntry(preview, name) {
  return preview.entries.find((entry) => entry.name === name)
}

test('preview reads a Gist and applies only selected entries', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': {
        hostId: 'host-a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [
          { name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', enabled: true },
          { name: 'dsh-conflict', spec: 'dsh-conflict@1.0.0', version: '1.0.0', enabled: true },
        ],
      },
      'host-b': {
        hostId: 'host-b',
        updatedAt: '2026-01-02T00:00:00.000Z',
        bundles: [
          { name: 'dsh-conflict', spec: 'dsh-conflict@2.0.0', version: '2.0.0', enabled: true },
        ],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  assert.equal(preview.ok, true)
  assert.equal(typeof preview.previewId, 'string')
  assert.equal(preview.gistId, '0123456789abcdef')
  assert.equal(findEntry(preview, 'dsh-conflict').conflict.type, 'host-disagreement')
  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote', 'dsh-conflict': 'skip' })
  assert.equal(result.ok, true)
  assert.equal(manager.calls.length, 1)
  assert.equal(manager.calls[0].spec, 'dsh-extra@1.0.0')
  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(state.gistId, '0123456789abcdef')
  assert.equal(typeof state.lastPreviewAt, 'string')
})

test('planPush reports the three remote/local cases without writing', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': {
        hostId: 'host-a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [
          { name: 'dsh-shared', spec: 'dsh-shared@9.0.0', version: '9.0.0', enabled: true },
          { name: 'dsh-remote', spec: 'dsh-remote@1.0.0', version: '1.0.0', enabled: true },
        ],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-shared', spec: 'dsh-shared@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
    { name: 'dsh-local', spec: 'dsh-local@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const plan = await runtime.planPush()
  const byName = new Map(plan.entries.map((entry) => [entry.name, entry]))

  assert.equal(byName.get('dsh-shared').kind, 'conflict')
  assert.equal(byName.get('dsh-shared').defaultChoice, 'newest')
  assert.equal(byName.get('dsh-shared').resolution, 'remote')
  assert.equal(byName.get('dsh-remote').kind, 'remote-only')
  assert.equal(byName.get('dsh-remote').defaultChoice, 'keep')
  assert.equal(byName.get('dsh-local').kind, 'local-only')
  assert.equal(byName.get('dsh-local').defaultChoice, 'push')
  assert.equal(plan.counts.needsChoice, 1)
  // Planning alone must not write to the Gist.
  assert.equal(mock.writes(), 0)
})

test('push with a plan resolves conflicts to the newer side and honours drops', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': {
        hostId: 'host-a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [
          { name: 'dsh-newer-remote', spec: 'dsh-newer-remote@5.0.0', version: '5.0.0', enabled: true },
          { name: 'dsh-older-remote', spec: 'dsh-older-remote@1.0.0', version: '1.0.0', enabled: true },
          { name: 'dsh-remote', spec: 'dsh-remote@1.0.0', version: '1.0.0', enabled: true },
        ],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-newer-remote', spec: 'dsh-newer-remote@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
    { name: 'dsh-older-remote', spec: 'dsh-older-remote@9.0.0', version: '9.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
    { name: 'dsh-local', spec: 'dsh-local@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const plan = await runtime.planPush()
  const result = await runtime.push({
    planId: plan.planId,
    selections: { 'dsh-remote': 'drop' },
  })

  assert.equal(result.status, 'pushed')
  const written = mock.readState().parsed
  const mine = new Map(written.hosts['host-local'].bundles.map((bundle) => [bundle.name, bundle]))
  // Remote 5.0.0 beats local 1.0.0.
  assert.equal(mine.get('dsh-newer-remote').version, '5.0.0')
  // Local 9.0.0 beats remote 1.0.0.
  assert.equal(mine.get('dsh-older-remote').version, '9.0.0')
  // Local-only is pushed as-is.
  assert.equal(mine.has('dsh-local'), true)
  // The dropped remote-only entry disappears from every other host record.
  const others = written.hosts['host-a'].bundles.map((bundle) => bundle.name)
  assert.equal(others.includes('dsh-remote'), false)
  assert.equal(others.includes('dsh-newer-remote'), true)
  assert.deepEqual(result.report.dropped, ['dsh-remote'])
})

test('push with a plan keeps a remote-only bundle by default', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      'host-a': {
        hostId: 'host-a',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bundles: [{ name: 'dsh-remote', spec: 'dsh-remote@1.0.0', version: '1.0.0', enabled: true }],
      },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const plan = await runtime.planPush()
  await runtime.push({ planId: plan.planId, selections: {} })
  assert.equal(mock.readState().parsed.hosts['host-a'].bundles.length, 1)
})

test('push updates an existing Gist and skips unchanged content', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { 'host-a': { hostId: 'host-a', bundles: [] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-local', spec: 'dsh-local@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true, source: 'dsh-local@1.0.0' },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const first = await runtime.push()
  assert.equal(first.status, 'pushed')
  assert.equal(first.created, false)
  assert.equal(mock.writes(), 1)
  assert.deepEqual(mock.readState().parsed.hosts['host-local'].bundles.map((bundle) => bundle.name), ['dsh-local'])
  const second = await runtime.push()
  assert.equal(second.status, 'unchanged')
  assert.equal(mock.writes(), 1)
})

test('push with no Gist id creates a secret Gist and remembers it', async (t) => {
  const mock = await startMock(null)
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const result = await runtime.push()
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
  assert.equal(result.gistId, '0123456789abcdef')
  assert.equal(mock.readState().parsed.schemaVersion, 1)
  assert.equal(mock.writes(), 1)
  const status = await runtime.status()
  assert.equal(status.gistId, '0123456789abcdef')
  assert.equal(status.gistUrl, 'https://gist.github.com/0123456789abcdef')
})

test('apply removes a local-only bundle when the user chooses remove', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-orphan', spec: 'dsh-orphan@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true, source: 'dsh-orphan@1.0.0' },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  const entry = findEntry(preview, 'dsh-orphan')
  assert.equal(entry.kind, 'local-only')
  assert.equal(entry.defaultChoice, 'local')
  assert.deepEqual(entry.choices, ['local', 'remove'])

  const kept = await runtime.apply(preview.previewId, {})
  assert.equal(kept.totalRemoved, 0)
  assert.equal(manager.bundles.length, 1)

  const preview2 = await runtime.preview()
  const removed = await runtime.apply(preview2.previewId, { 'dsh-orphan': 'remove' })
  assert.equal(removed.ok, true)
  assert.equal(removed.removed.length, 1)
  assert.equal(removed.removed[0].name, 'dsh-orphan')
  assert.equal(manager.bundles.length, 0)
})

test('apply records a job log with per-item progress', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', enabled: true }] },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  assert.equal(typeof preview.jobId, 'string')
  const previewJob = runtime.job(preview.jobId)
  assert.equal(previewJob.kind, 'preview')
  assert.equal(previewJob.status, 'done')
  assert.ok(previewJob.lines.length > 0)

  const applied = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote' })
  assert.equal(typeof applied.jobId, 'string')
  const job = runtime.job(applied.jobId)
  assert.equal(job.kind, 'apply')
  assert.equal(job.status, 'done')
  assert.deepEqual(job.progress, { done: 1, total: 1 })
  assert.ok(job.lines.some((line) => /installing dsh-extra/.test(line.message)))
  assert.ok(job.lines.some((line) => /dsh-extra: installed/.test(line.message)))
  assert.equal(runtime.latestJob('apply').id, applied.jobId)
})

test('an upgrade removes the installed copy first when the manager refuses a re-add', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@2.0.0', version: '2.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  assert.equal(findEntry(preview, 'dsh-extra').kind, 'upgrade')

  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote' })
  assert.equal(result.ok, true, JSON.stringify(result.failed))
  assert.equal(result.applied.length, 1)
  assert.equal(result.applied[0].upgraded, true)
  assert.equal(result.applied[0].replaced, '1.0.0')
  assert.equal(manager.calls.some((call) => call.removed === 'dsh-extra'), true)
  assert.equal(manager.bundles.find((bundle) => bundle.name === 'dsh-extra').installTarget.spec, 'dsh-extra@2.0.0')
  const job = runtime.job(result.jobId)
  assert.ok(job.lines.some((line) => /already installed; replacing/.test(line.message)))
  assert.ok(job.lines.some((line) => /dsh-extra: upgraded/.test(line.message)))
})

test('a failed upgrade restores the previous version', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@2.0.0', version: '2.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true, failInstall: (name, spec) => spec === 'dsh-extra@2.0.0' })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote' })

  assert.equal(result.ok, false)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].rollback, 'restored')
  assert.match(result.failed[0].error, /different DSH version/)
  assert.match(result.failed[0].error, /Restored the previous copy/)
  const restored = manager.bundles.find((bundle) => bundle.name === 'dsh-extra')
  assert.equal(restored.installTarget.spec, 'dsh-extra@1.0.0')
  const status = await runtime.status()
  assert.equal(status.state.pendingUpgrades, undefined)
})

test('the plugin refuses to update or remove itself', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-plugin-sync', spec: 'dsh-plugin-sync@3.0.0', version: '3.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-plugin-sync', spec: 'dsh-plugin-sync@2.5.1', version: '2.5.1', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  assert.equal(findEntry(preview, 'dsh-plugin-sync').kind, 'upgrade')
  const result = await runtime.apply(preview.previewId, { 'dsh-plugin-sync': 'remote' })

  assert.equal(result.ok, false)
  assert.equal(result.failed[0].code, 'self-update')
  assert.equal(manager.calls.length, 0)
  assert.equal(manager.bundles[0].spec, 'dsh-plugin-sync@2.5.1')
})

test('a refusal without a message is reported as readable text', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([], {})
  manager.installBundle = async () => ({
    changed: false,
    application: 'failed',
    stage: 'install',
    target: 'dsh-extra',
    error: { code: 'not-bundle' },
  })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote' })
  assert.equal(result.failed.length, 1)
  assert.doesNotMatch(result.failed[0].error, /\[object Object\]/)
  assert.match(result.failed[0].error, /does not provide a bundle patch/)
  const job = runtime.job(result.jobId)
  assert.ok(job.lines.every((line) => !line.message.includes('[object Object]')))
})

test('a bundle HMR cannot unload keeps its profile selection and is remembered', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-stuck', spec: 'dsh-stuck@2.0.0', version: '2.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-stuck', spec: 'dsh-stuck@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true, stuck: ['dsh-stuck'] })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  const result = await runtime.apply(preview.previewId, { 'dsh-stuck': 'remote' })

  assert.equal(result.ok, false)
  assert.equal(result.failed[0].code, 'manual-update')
  assert.match(result.failed[0].error, /cannot unload this bundle/)
  // The critical part: the bundle is still selected, so it keeps running.
  assert.equal(manager.isSelected('dsh-stuck'), true)
  assert.equal(manager.bundles[0].enabled, true)
  assert.equal(manager.bundles[0].spec, 'dsh-stuck@1.0.0')
  const status = await runtime.status()
  assert.equal(status.state.manualUpdates.length, 1)
  assert.equal(status.state.manualUpdates[0].name, 'dsh-stuck')
})

test('a remembered bundle is skipped and marked on the next preview', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-stuck', spec: 'dsh-stuck@2.0.0', version: '2.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-stuck', spec: 'dsh-stuck@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true, stuck: ['dsh-stuck'] })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })

  const first = await runtime.preview()
  await runtime.apply(first.previewId, { 'dsh-stuck': 'remote' })
  const removalsAfterFirst = manager.calls.filter((call) => call.removed === 'dsh-stuck').length

  const second = await runtime.preview()
  assert.equal(findEntry(second, 'dsh-stuck').manualUpdate, true)
  const retry = await runtime.apply(second.previewId, { 'dsh-stuck': 'remote' })

  assert.equal(retry.failed[0].code, 'manual-update')
  assert.match(retry.failed[0].error, /could not be unloaded by HMR before/i)
  // It must not attempt another removal.
  assert.equal(manager.calls.filter((call) => call.removed === 'dsh-stuck').length, removalsAfterFirst)
})

test('a successful upgrade clears the manual-update record', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@2.0.0', version: '2.0.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  await runtime.apply((await runtime.preview()).previewId, { 'dsh-extra': 'remote' })
  const status = await runtime.status()
  assert.equal(status.state.manualUpdates, undefined)
  assert.equal(status.state.pendingUpgrades, undefined)
})

test('checkLatest reports outdated bundles from the source, not the manifest', async (t) => {
  const mock = await startMock({ schemaVersion: 1, hosts: { remote: { bundles: [] } } })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-old', spec: 'dsh-old@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
    { name: 'dsh-now', spec: 'dsh-now@2.0.0', version: '2.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
    fetchImpl: async (url) => {
      if (url.includes('/dsh-old')) return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '1.5.0' } }) }
      if (url.includes('/dsh-now')) return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '2.0.0' } }) }
      return { ok: false, status: 404, json: async () => ({}) }
    },
  })
  const result = await runtime.checkLatest()
  assert.equal(result.ok, true)
  assert.equal(result.counts.outdated, 1)
  const old = result.entries.find((entry) => entry.name === 'dsh-old')
  assert.equal(old.outdated, true)
  assert.equal(old.latest, '1.5.0')
  assert.equal(old.target, 'dsh-old@1.5.0')
  const now = result.entries.find((entry) => entry.name === 'dsh-now')
  assert.equal(now.outdated, false)
})

test('applyLatest installs the newest release instead of the manifest version', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: { remote: { bundles: [{ name: 'dsh-old', spec: 'dsh-old@1.1.0', version: '1.1.0', enabled: true }] } },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-old', spec: 'dsh-old@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
    // The registry is ahead of the manifest on purpose.
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '1.9.0' } }) }),
  })
  const result = await runtime.applyLatest(['dsh-old'])
  assert.equal(result.ok, true, JSON.stringify(result.failed))
  assert.equal(result.applied.length, 1)
  assert.equal(result.applied[0].latest, '1.9.0')
  const installed = manager.bundles.find((bundle) => bundle.name === 'dsh-old')
  assert.equal(installed.installTarget.spec, 'dsh-old@1.9.0')
  assert.equal(result.updatedList[0].latest, '1.9.0')
})

test('applyLatest skips bundles that are already current', async (t) => {
  const mock = await startMock({ schemaVersion: 1, hosts: { remote: { bundles: [] } } })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([
      { name: 'dsh-now', spec: 'dsh-now@2.0.0', version: '2.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
    ]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '2.0.0' } }) }),
  })
  const result = await runtime.applyLatest(['dsh-now'])
  assert.equal(result.totalApplied, 0)
  assert.equal(result.skipped[0].reason, 'already-current')
})

test('a cold applyLatest checks versions itself instead of tripping its own lock', async (t) => {
  const mock = await startMock({ schemaVersion: 1, hosts: { remote: { bundles: [] } } })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-old', spec: 'dsh-old@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ], { hmr: true })
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '3.0.0' } }) }),
  })
  // No prior check: the runtime must run one while already holding the lock.
  const result = await runtime.applyLatest(['dsh-old'])
  assert.equal(result.ok, true, JSON.stringify(result.failed))
  assert.equal(result.totalApplied, 1)
})

test('a version check logs each bundle as it resolves', async (t) => {
  const mock = await startMock({ schemaVersion: 1, hosts: { remote: { bundles: [] } } })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([
    { name: 'dsh-a', spec: 'dsh-a@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
    { name: 'dsh-b', spec: 'dsh-b@1.0.0', version: '1.0.0', availability: 'profile', installed: true, enabled: true, removable: true },
  ])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest: '2.0.0' } }) }
    },
  })
  const pending = runtime.checkLatest()
  await new Promise((resolve) => setTimeout(resolve, 40))
  const midway = runtime.latestJob('check')

  assert.equal(midway.status, 'running')
  assert.ok(midway.lines.length >= 1, 'the first line appears before the check ends')
  assert.ok(midway.progress.done < midway.progress.total, 'progress advances per bundle')

  const result = await pending
  assert.equal(result.counts.outdated, 2)
  const lines = runtime.job(result.jobId).lines.map((line) => line.message)
  assert.ok(lines.some((line) => /^dsh-a: 1\.0\.0 -> 2\.0\.0$/.test(line)))
  assert.ok(lines.some((line) => /^dsh-b: 1\.0\.0 -> 2\.0\.0$/.test(line)))
})

test('preview without a Gist id asks for one', async (t) => {
  const mock = await startMock(null)
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  await assert.rejects(() => runtime.preview(), /No Gist named/)
})

test('without a token preview and apply still work but push fails', async (t) => {
  const mock = await startMock({
    schemaVersion: 1,
    hosts: {
      remote: { bundles: [{ name: 'dsh-extra', spec: 'dsh-extra@1.0.0', version: '1.0.0', enabled: true }] },
    },
  })
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = new FakeManager([])
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl, token: '', tokenEnv: 'NOT_SET' }),
    pluginManager: manager,
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  const preview = await runtime.preview()
  const result = await runtime.apply(preview.previewId, { 'dsh-extra': 'remote' })
  assert.equal(result.ok, true)
  assert.equal(manager.calls.length, 1)
  await assert.rejects(() => runtime.push(), (error) => error.code === 'no-token')
})

test('invalid Gist JSON is rejected without a write', async (t) => {
  const mock = await startMock('{not json')
  t.after(() => mock.close())
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-sync-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const runtime = createSyncRuntime({
    config: makeConfig({ apiBaseUrl: mock.apiBaseUrl }),
    pluginManager: new FakeManager([]),
    logger: { info() {}, warn() {} },
    statePath: join(dir, 'state.json'),
    env: {},
  })
  await assert.rejects(() => runtime.preview(), /not valid JSON/)
  await assert.rejects(() => runtime.push(), /not valid JSON/)
  assert.equal(mock.writes(), 0)
})
