import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearCredential,
  defaultHostId,
  describeCredential,
  normalizeConfig,
  normalizeGistId,
  publicConfig,
  readConfigSnapshot,
  serializeConfig,
  setCredential,
  writeConfigValues,
} from '../lib/config.js'

function fakeContext(currentRaw, inherited) {
  const state = { current: currentRaw, written: null }
  const editor = {
    configuration() {
      return [{
        entry: { options: { id: 'dsh-plugin-syncup', config: state.current } },
        inherited,
        override: {},
      }]
    },
    async edit(entry, change) {
      state.written = change(state.current, inherited)
      state.current = state.written
      entry.options.config = state.written
    },
  }
  return {
    state,
    ctx: { get: (name) => (name === 'configEditor' ? editor : undefined) },
  }
}

test('normalizeGistId accepts ids and gist URLs', () => {
  assert.equal(normalizeGistId('0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef')
  assert.equal(normalizeGistId('https://gist.github.com/user/0123456789abcdef'), '0123456789abcdef')
  assert.equal(normalizeGistId('https://gist.github.com/0123456789abcdef#file-x'), '0123456789abcdef')
  assert.equal(normalizeGistId('not an id'), '')
})

test('normalizeConfig keeps the default Gist name and accepts a custom one', () => {
  const valid = normalizeConfig({ gistName: 'team-sync', maxInstallsPerRun: 3 })
  assert.equal(valid.gistName, 'team-sync')
  assert.equal(valid.fileName, 'dsh-plugins.json')
  assert.equal(valid.maxInstallsPerRun, 3)
  assert.equal(valid.hostId, defaultHostId())
  const empty = normalizeConfig({ gistName: '   ' })
  assert.equal(empty.gistName, 'dsh-plugin-sync')
  assert.equal(publicConfig(valid).token, undefined)
})

test('readConfigSnapshot exposes only the Gist name', () => {
  const current = {
    gistName: 'team-sync',
    token: 'secret-token',
    tokenEnv: 'GITHUB_TOKEN',
    hostId: 'host-a',
    maxInstallsPerRun: 5,
  }
  const { ctx } = fakeContext(current, { gistName: '' })
  const snapshot = readConfigSnapshot(ctx, normalizeConfig(current))
  assert.equal(snapshot.editable, true)
  assert.equal(snapshot.values.gistName, 'team-sync')
  assert.equal(snapshot.values.hostId, undefined)
  assert.equal(snapshot.values.token, undefined)
  assert.equal(JSON.stringify(snapshot).includes('secret-token'), false)
})

test('writeConfigValues updates the Gist name and preserves hidden internal settings', async () => {
  const current = {
    gistName: 'dsh-plugin-sync',
    token: 'secret-token',
    fileName: 'inventory.json',
    maxInstallsPerRun: 7,
    hostId: 'work-pc',
  }
  const { ctx, state } = fakeContext(current, { gistName: '' })
  const values = await writeConfigValues(ctx, {
    gistName: 'team-sync',
  }, normalizeConfig(current))
  assert.equal(values.gistName, 'team-sync')
  assert.equal(values.fileName, undefined)
  assert.equal(state.written.gistName, 'team-sync')
  assert.equal(state.written.fileName, 'inventory.json')
  assert.equal(state.written.maxInstallsPerRun, 7)
  assert.equal(state.written.hostId, 'work-pc')
  assert.equal(state.written.token, undefined)
  assert.equal(state.written.repo, undefined)
})

test('writeConfigValues normalizes an empty Gist name to the default', async () => {
  const current = { gistName: 'dsh-plugin-sync' }
  const { ctx, state } = fakeContext(current, { gistName: '' })
  const values = await writeConfigValues(ctx, { gistName: '  ' }, normalizeConfig(current))
  assert.equal(values.gistName, 'dsh-plugin-sync')
  assert.equal(state.written.gistName, 'dsh-plugin-sync')
})

test('serializeConfig only includes non-default hidden settings', () => {
  const config = normalizeConfig({
    gistName: 'team-sync',
    token: 'abc',
    tokenEnv: 'GH',
    maxInstallsPerRun: 2,
  })
  const serialized = serializeConfig(config, {})
  assert.equal(serialized.gistName, 'team-sync')
  assert.equal(serialized.token, undefined)
  assert.equal(serialized.tokenEnv, 'GH')
  assert.equal(serialized.maxInstallsPerRun, 2)
  assert.equal(serialized.apiBaseUrl, undefined)
  assert.equal(serialized.requestTimeoutMs, undefined)
})

test('credential helpers use the DSH credential service', async () => {
  const store = { value: '' }
  const credentials = {
    async describe() {
      return { configured: store.value !== '', writable: true, source: store.value === '' ? undefined : 'file' }
    },
    async set(ref, value) {
      assert.equal(ref, 'GITHUB_TOKEN')
      store.value = value
    },
    async unset() {
      store.value = ''
    },
    async resolve() {
      return store.value === '' ? undefined : { value: store.value, source: 'file' }
    },
  }
  const ctx = { get: (name) => (name === 'credentials' ? credentials : undefined) }
  assert.equal((await describeCredential(ctx)).configured, false)
  await setCredential(ctx, 'ghp_test')
  const described = await describeCredential(ctx)
  assert.equal(described.configured, true)
  assert.equal(described.source, 'file')
  await clearCredential(ctx)
  assert.equal((await describeCredential(ctx)).configured, false)
})
