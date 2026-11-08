import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'client.js'), 'utf8')

function loadClient() {
  let loaded = null
  const window = {
    __ModuleLoader__: {
      load(entry) {
        loaded = entry
      },
    },
  }
  const React = {
    createElement() {},
    useState() {},
    useEffect() {},
    useCallback() {},
  }
  const context = vm.createContext({
    window,
    URL,
    document: { baseURI: 'http://127.0.0.1/' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    setTimeout,
    require(name) {
      if (name === 'react') return React
      throw new Error(`unexpected require: ${name}`)
    },
  })
  vm.runInContext(source, context, { filename: 'client.js' })
  assert.ok(loaded !== null)
  return loaded
}

test('client registers the bundle config page under the package key', () => {
  const loaded = loadClient()
  assert.equal(loaded.id, 'dsh-plugin-syncup')
  const module = loaded.factory((name) => {
    if (name === 'react') return { createElement() {}, useState() {}, useEffect() {}, useCallback() {} }
    throw new Error(name)
  })
  assert.deepEqual([...module.inject], ['slots', 'locale'])
  let registration = null
  const dictionaries = []
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: (ns, value) => {
        dictionaries.push({ ns, value })
        return () => {}
      },
    },
    slots: {
      inject: (name, callback) => {
        assert.equal(name, 'plugins.bundle.config')
        callback()
      },
      register: (options, component) => {
        registration = { options, component }
        return () => {}
      },
    },
    effect: (callback) => callback(),
  }
  module.apply(ctx)
  assert.ok(registration !== null)
  assert.equal(registration.options.name, 'plugins.bundle.config')
  assert.equal(registration.options.key, 'dsh-plugin-syncup')
  assert.equal(registration.options.locale, 'dsh-plugin-syncup')
  assert.equal(dictionaries.length, 1)
  assert.ok(dictionaries[0].value.zh.manualTitle)
  assert.ok(dictionaries[0].value.zh.tokenHelp)
  assert.equal(dictionaries[0].value.en.tokenHelpOpen, 'Open GitHub token page')
  assert.match(source, /settings\/tokens\/new\?description=DSH%20Plugin%20Sync&scopes=gist/)
  assert.ok(dictionaries[0].value.en.manualTitle)
})

test('the job-adoption effect can clear its flags, not only set them', () => {
  // A regression guard for a real "stuck on 检查中" bug: the effect used to call
  // setChecking(true) with no path that ever set it back to false, so the button
  // never recovered and the finished result was never rendered.
  const effect = source.slice(
    source.indexOf('React.useEffect(() => {', source.indexOf('pendingRef')),
    source.indexOf('}, [status?.busy, job?.status'),
  )
  assert.ok(effect.length > 0, 'the adoption effect is present')
  assert.match(effect, /setChecking\(false\)/, 'it clears the checking flag')
  assert.match(effect, /setLatestUpdating\(false\)/, 'it clears the updating flag')
  // ...and it must not clear a flag whose request this page still has in flight.
  assert.match(effect, /pendingRef\.current\.check !== true/)
  assert.match(effect, /pendingRef\.current\.update !== true/)
})

test('hostBusy requires a live job so a finished check does not dead-lock the buttons', () => {
  assert.match(source, /const hostBusy = status\?\.busy === true && job\?\.status === 'running'/)
  // The click handlers must clear their own pending flag in `finally`.
  assert.match(source, /pendingRef\.current\.check = false/)
  assert.match(source, /pendingRef\.current\.update = false/)
})

test('a finished check is not overwritten by the cached restore', () => {
  // Restoring must yield to a result the user already received.
  //
  // This used to pin the exact expression `setLatest((current) => (current === null
  // ? data : current))`, which forced the implementation to keep one literal
  // spelling and said nothing about behaviour. Assert the shape that matters
  // instead: the restore hands `setLatest` an updater (so it can see the current
  // value) and it keeps an existing result rather than replacing it.
  const restore = source.slice(
    source.indexOf('const restoredRef = React.useRef(false)'),
    source.indexOf('}, [status, call])'),
  )
  assert.ok(restore.length > 0, 'the cached-restore effect is present')
  assert.match(restore, /setLatest\(\(current\) =>/, 'the restore uses an updater so it can see the current result')
  assert.match(restore, /current === null \? data : current/, 'the cached copy only fills an empty slot')
})
