import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'index.js'), 'utf8')

test('the tool registration tolerates a pre-existing plugin_sync tool', async () => {
  // A stale row for the pre-rename id could register `plugin_sync` first, and the
  // whole bundle then failed to load with "tool is already registered". Loading
  // with a taken name must still leave the API and the settings page alive.
  const warnings = []
  const registered = []
  const effects = []

  const tools = {
    list: () => [{ name: 'plugin_sync' }],
    register: (definition) => {
      registered.push(definition)
      return () => {}
    },
  }

  const ctx = {
    logger: { info() {}, warn: (message) => warnings.push(message), error() {} },
    tools,
    pluginManager: { listBundles: async () => [] },
    get: (name) => (name === 'tools' ? tools : undefined),
    effect: (factory) => {
      const dispose = factory()
      effects.push(dispose)
      return () => {}
    },
    inject: (_services, callback) => callback(ctx),
    webServer: { register: () => () => {} },
  }

  const module = await import('../index.js')
  module.apply(ctx, { gistName: 'dsh-plugin-sync' })

  // The tool was skipped, with a warning naming the cause.
  assert.equal(registered.length, 0)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /already registered/)
  assert.match(warnings[0], /dsh-plugin-sync/)
  // The effect still returned a disposer, so nothing throws on unload.
  assert.ok(effects.every((dispose) => typeof dispose === 'function'))
  // The API routes were still mounted.
  assert.ok(source.includes("registerApiRoutes({ ctx, runtime, config })"))
})

test('the tool registers normally when the name is free', async () => {
  const warnings = []
  const registered = []
  const tools = {
    list: () => [],
    register: (definition) => {
      registered.push(definition)
      return () => {}
    },
  }
  const ctx = {
    logger: { info() {}, warn: (message) => warnings.push(message), error() {} },
    tools,
    pluginManager: { listBundles: async () => [] },
    get: (name) => (name === 'tools' ? tools : undefined),
    effect: (factory) => {
      factory()
      return () => {}
    },
    inject: (_services, callback) => callback(ctx),
    webServer: { register: () => () => {} },
  }
  const module = await import('../index.js')
  module.apply(ctx, { gistName: 'dsh-plugin-sync' })

  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'plugin_sync')
  assert.equal(warnings.length, 0)
})
