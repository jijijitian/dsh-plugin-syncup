import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

// ---------------------------------------------------------------------------
// These tests render the REAL `ConfigPage` out of client.js in a tiny React
// implementation instead of asserting on the module's source text. Static
// regexes cannot distinguish "the list is rendered" from "the list is rendered
// but empty", which is exactly the regression the PM reported.
// ---------------------------------------------------------------------------
function createMiniReact() {
  const FRAGMENT = Symbol('Fragment')
  const runtime = { instances: new Map(), instanceList: [], current: null, hookIndex: 0 }
  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const slot = (index) => {
    const instance = runtime.current
    if (!(index in instance.hooks)) instance.hooks[index] = { kind: null }
    return instance.hooks[index]
  }
  const React = {
    Fragment: FRAGMENT,
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
      return { type, props: merged, __el: true }
    },
    useState(initial) {
      const index = runtime.hookIndex++
      const state = slot(index)
      if (state.kind === null) {
        state.kind = 'state'
        state.value = typeof initial === 'function' ? initial() : initial
      }
      return [state.value, (next) => {
        const value = typeof next === 'function' ? next(state.value) : next
        if (!Object.is(value, state.value)) {
          state.value = value
          runtime.dirty = true
        }
      }]
    },
    useRef(initial) {
      const index = runtime.hookIndex++
      const state = slot(index)
      if (state.kind === null) { state.kind = 'ref'; state.value = { current: initial } }
      return state.value
    },
    useCallback(fn, deps) {
      const index = runtime.hookIndex++
      const state = slot(index)
      if (state.kind === 'memo' && (deps === undefined || sameDeps(state.deps, deps))) return state.value
      state.kind = 'memo'; state.deps = deps; state.value = fn
      return fn
    },
    useEffect(fn, deps) {
      const index = runtime.hookIndex++
      const state = slot(index)
      if (state.kind === 'effect' && deps !== undefined && sameDeps(state.deps, deps)) return
      state.kind = 'effect'; state.deps = deps; state.fn = fn; state.dirty = true
      runtime.current.effectIndexes.push(index)
    },
  }

  function callComponent(type, props) {
    const parent = runtime.current
    let instance = runtime.instances.get(type)
    if (instance === undefined) {
      instance = { hooks: [], effectIndexes: [] }
      runtime.instances.set(type, instance)
      runtime.instanceList.push(instance)
    }
    const previousIndex = runtime.hookIndex
    runtime.current = instance
    runtime.hookIndex = 0
    instance.effectIndexes = []
    try {
      return type(props, {})
    } finally {
      runtime.current = parent
      runtime.hookIndex = previousIndex
    }
  }

  function render(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (Array.isArray(node)) return node.map(render)
    if (typeof node === 'string' || typeof node === 'number') return node
    if (!node.__el) return node
    if (node.type === FRAGMENT) return render(node.props.children)
    if (typeof node.type === 'function') return render(callComponent(node.type, node.props))
    return { type: node.type, props: { ...node.props, children: render(node.props.children) } }
  }

  function runEffects() {
    for (const instance of runtime.instanceList) {
      for (const index of instance.effectIndexes) {
        const state = instance.hooks[index]
        if (!state || state.kind !== 'effect' || state.dirty !== true) continue
        state.dirty = false
        state.cleanup = state.fn()
      }
    }
  }

  return { React, render, runEffects }
}

// Load client.js in a vm whose `fetch` records the exact URLs the page asks
// for, so a test can prove which host route was hit.
function mountPage(root, handlers) {
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const mini = createMiniReact()
  const requests = []
  let loaded = null
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = String(rawUrl)
    const path = url.replace(/^.*\/api\/v2\//, '')
    const name = path.replace(/\?.*$/, '')
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : ''
    const method = options.method ?? 'GET'
    requests.push({ url, name, query, method, body: options.body })
    // A handler key may be qualified by method, so one route can answer both
    // GET (check) and POST (apply the updates).
    const handler = handlers[`${method} ${name}${query}`]
      ?? handlers[`${name}${query}`]
      ?? handlers[`${method} ${name}`]
      ?? handlers[name]
    if (handler === undefined) return { ok: true, status: 200, json: async () => ({ ok: true }) }
    const result = await handler()
    if (result === undefined || result === null) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (result.__fail) {
      return {
        ok: false,
        status: result.__fail.status ?? 500,
        json: async () => ({ ok: false, error: { message: result.__fail.message } }),
      }
    }
    return { ok: true, status: 200, json: async () => result }
  }

  const context = vm.createContext({
    window: { __ModuleLoader__: { load(entry) { loaded = entry } } },
    URL,
    document: { baseURI: 'http://127.0.0.1:1234/' },
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
    // Mini React never runs effect cleanups, so a polling interval would keep
    // the process alive forever. These tests advance time by awaiting instead.
    setInterval: (fn, ms) => {
      const timer = setInterval(fn, ms)
      timer.unref?.()
      return timer
    },
    clearInterval,
    require(name) {
      if (name === 'react') return mini.React
      throw new Error(`unexpected require: ${name}`)
    },
  })
  vm.runInContext(source, context, { filename: 'client.js' })

  let dictionaries = null
  let component = null
  const factory = loaded.factory((name) => {
    if (name === 'react') return mini.React
    throw new Error(name)
  })
  factory.apply({
    locale: {
      bind: () => (key) => key,
      register(ns, value) { dictionaries = value; return () => {} },
    },
    slots: {
      inject(name, callback) { callback() },
      register(options, registered) { component = registered; return () => {} },
    },
    effect(callback) { callback() },
  })

  return { mini, component, dictionaries, requests }
}

function translatorOf(dictionary) {
  return (key, params) => {
    let text = dictionary[key] ?? key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
    }
    return text
  }
}

function flatten(node) {
  const out = []
  const visit = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (typeof current === 'object' && current.type !== undefined) {
      out.push(current)
      visit(current.props?.children)
    }
  }
  visit(node)
  return out
}

function textOf(node) {
  const parts = []
  const visit = (current) => {
    if (current === null || current === undefined || typeof current === 'boolean') return
    if (Array.isArray(current)) { current.forEach(visit); return }
    if (typeof current === 'string' || typeof current === 'number') { parts.push(String(current)); return }
    if (typeof current === 'object' && current.props) visit(current.props.children)
  }
  visit(node)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function byClass(flat, className) {
  return flat.filter((el) => typeof el.props?.className === 'string'
    && el.props.className.split(/\s+/).includes(className))
}

function checkboxCount(flat) {
  return flat.filter((el) => el.type === 'input' && el.props?.type === 'checkbox').length
}

function buttonByText(flat, text) {
  return byClass(flat, 'dsh-ps-btn').find((el) => textOf(el) === text)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const STATUS = {
  ok: true,
  gistName: 'dsh-plugin-sync',
  gistId: '0123456789abcdef',
  gistUrl: 'https://gist.github.com/0123456789abcdef',
  token: { configured: true, source: 'gist' },
  configSnapshot: { editable: true, values: { gistName: 'dsh-plugin-sync' } },
  local: { profileBundles: 2, portableBundles: 1 },
  state: { lastPreviewAt: null, remote: null, lastResults: [] },
  busy: false,
  latestCheckedAt: null,
}

function entry(name, localVersion, latestVersion, outdated) {
  return {
    name,
    local: { version: localVersion },
    latest: latestVersion,
    outdated,
    channels: { npm: latestVersion, github: latestVersion },
  }
}

function payloadOf(entries) {
  const outdated = entries.filter((item) => item.outdated === true).length
  return {
    ok: true,
    action: 'latest',
    cached: true,
    at: '2026-01-01T00:00:00.000Z',
    entries,
    counts: { entries: entries.length, outdated, current: entries.length - outdated, unsupported: 0 },
  }
}

// Render, let every settled promise land, render again, and return the tree.
async function settle(mini, component, t, rounds = 4) {
  const page = () => mini.render(mini.React.createElement(component, { t, view: 'full' }))
  let tree = page()
  mini.runEffects()
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 30))
    tree = page()
    mini.runEffects()
  }
  return tree
}

async function openLatestTab(mini, component, t) {
  let tree = await settle(mini, component, t)
  const tab = byClass(flatten(tree), 'dsh-ps-tab').find((el) => textOf(el) === 'Plugin updates')
  assert.ok(tab !== undefined, 'the plugin updates tab is rendered')
  tab.props.onClick()
  return settle(mini, component, t)
}

async function pressCheck(mini, component, t) {
  const tree = await openLatestTab(mini, component, t)
  const button = buttonByText(flatten(tree), 'Check latest versions')
  assert.ok(button !== undefined, 'the check button is rendered')
  await button.props.onClick()
  return settle(mini, component, t)
}

// ===========================================================================
// P0 root cause: `endpoint()` used `new URL(...).pathname`, dropping the query.
//
// `call('latest?cached=1')` therefore asked for the FULL check route. On mount
// that started a hidden ~19s check holding the exclusive operation lock, so the
// user's own click collided with it and `setLatest` never ran — the panel kept
// saying "no results yet" while the log claimed the check had finished.
// ===========================================================================
test('endpoint() keeps the query string so the restore hits the cached route', () => {
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const start = source.indexOf('function endpoint(name)')
  assert.ok(start > 0, 'endpoint() is present')
  const body = source.slice(start, source.indexOf('async function call(', start))
  assert.doesNotMatch(body, /^\s*return new URL\(.*\)\.pathname\s*$/m,
    'endpoint() must not return a bare .pathname: that drops ?cached=1')
  assert.match(body, /\.search\b/, 'endpoint() folds the query string back into the request URL')
})

test('the cached restore request keeps its ?cached=1 query', async () => {
  const entries = [entry('bundle-a', '1.0.0', '2.0.0', true), entry('bundle-b', '3.0.0', '3.0.0', false)]
  const { mini, component, dictionaries, requests } = mountPage(root, {
    status: async () => ({ ...STATUS, latestCheckedAt: '2026-01-01T00:00:00.000Z' }),
    'latest?cached=1': async () => payloadOf(entries),
    latest: async () => payloadOf(entries),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  await settle(mini, component, t)

  const restores = requests.filter((request) => request.name === 'latest')
  assert.ok(restores.length > 0, 'mounting with a past check restores the cached result')
  assert.ok(
    restores.some((request) => request.query === '?cached=1'),
    'the restore must request ?cached=1; without it the page fires a hidden full check',
  )
})

test('a mounted page with a past check never triggers a full check', async () => {
  const entries = [entry('bundle-a', '1.0.0', '2.0.0', true)]
  const { mini, component, dictionaries, requests } = mountPage(root, {
    status: async () => ({ ...STATUS, latestCheckedAt: '2026-01-01T00:00:00.000Z' }),
    'latest?cached=1': async () => payloadOf(entries),
    latest: async () => payloadOf(entries),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  await settle(mini, component, t)

  const fullChecks = requests.filter((request) => request.name === 'latest' && request.query === '')
  assert.deepEqual(fullChecks, [],
    'simply opening the page must not run the expensive check that takes the operation lock')
})

// ===========================================================================
// Success path: the list the user came for must be visible and actionable.
// ===========================================================================
test('a finished check renders a select and a checkbox for every outdated row', async () => {
  const outdated = Array.from({ length: 8 }, (_, index) => entry(`outdated-${index}`, '1.0.0', '2.0.0', true))
  const current = Array.from({ length: 6 }, (_, index) => entry(`current-${index}`, '1.0.0', '1.0.0', false))
  const payload = { ...payloadOf([...outdated, ...current]), cached: false }
  const { mini, component, dictionaries } = mountPage(root, {
    status: async () => STATUS,
    latest: async () => payload,
    'latest?cached=1': async () => payloadOf([...outdated, ...current]),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  const tree = await pressCheck(mini, component, t)
  const flat = flatten(tree)

  assert.equal(byClass(flat, 'dsh-ps-entry').length, 14, 'every checked bundle is listed')
  assert.equal(byClass(flat, 'dsh-ps-select').length, 8, 'each outdated row offers a channel')
  assert.equal(checkboxCount(flat), 8, 'each outdated row has a checkbox')
  assert.ok(buttonByText(flat, 'Select all') !== undefined, 'the select-all button is offered')
  const update = buttonByText(flat, 'Update selected')
  assert.ok(update !== undefined, 'the update button is offered')
  assert.notEqual(update.props.disabled, true, 'outdated rows start selected, so update is enabled')
})

test('a finished check does not leave the "no results yet" placeholder behind', async () => {
  const payload = { ...payloadOf([entry('bundle-a', '1.0.0', '2.0.0', true)]), cached: false }
  const { mini, component, dictionaries } = mountPage(root, {
    status: async () => STATUS,
    latest: async () => payload,
    'latest?cached=1': async () => payloadOf(payload.entries),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  const tree = await pressCheck(mini, component, t)
  assert.doesNotMatch(textOf(tree), /No results yet/,
    'a finished check must replace the empty-state text with the result list')
})

// ===========================================================================
// Failure path: a timed-out check must not blank the panel.
// 14 registry lookups take ~19s, so timeouts are a realistic outcome.
// ===========================================================================
test('a failed check falls back to the cached result instead of showing nothing', async () => {
  const entries = [entry('bundle-a', '1.0.0', '2.0.0', true), entry('bundle-b', '1.0.0', '2.0.0', true)]
  const { mini, component, dictionaries } = mountPage(root, {
    status: async () => STATUS,
    latest: async () => ({ __fail: { status: 504, message: 'check timed out' } }),
    'latest?cached=1': async () => payloadOf(entries),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  const tree = await pressCheck(mini, component, t)
  const flat = flatten(tree)

  assert.equal(byClass(flat, 'dsh-ps-entry').length, 2, 'the cached rows are still rendered')
  assert.equal(byClass(flat, 'dsh-ps-select').length, 2, 'the channel pickers survive the failure')
  assert.equal(checkboxCount(flat), 2, 'the row checkboxes survive the failure')
  assert.ok(buttonByText(flat, 'Update selected') !== undefined, 'the update button survives the failure')
})

test('a failed check with no cached result still reports the failure', async () => {
  const { mini, component, dictionaries } = mountPage(root, {
    status: async () => STATUS,
    latest: async () => ({ __fail: { status: 504, message: 'check timed out' } }),
    'latest?cached=1': async () => ({ ...payloadOf([]), entries: [] }),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  const tree = await pressCheck(mini, component, t)
  const flat = flatten(tree)
  const alerts = byClass(flat, 'dsh-ps-alert').map((el) => textOf(el)).join(' ')
  assert.match(alerts, /timed out/,
    'the failure is shown as an alert; the finally-block status refresh must not wipe it')
})

// ===========================================================================
// After a successful update the rows are refreshed in place, so the panel must
// not collapse to an empty list (the pre-4.4.0 `setLatest(null)` behaviour).
// ===========================================================================
test('a finished update keeps the rows and clears their outdated flag', async () => {
  const entries = [entry('bundle-a', '1.0.0', '2.0.0', true), entry('bundle-b', '1.0.0', '2.0.0', true)]
  const payload = { ...payloadOf(entries), cached: false }
  const { mini, component, dictionaries } = mountPage(root, {
    status: async () => STATUS,
    latest: async () => payload,
    'GET latest': async () => payload,
    // The page posts the picked names and expects a per-bundle outcome list.
    'POST latest': async () => ({
      ok: true,
      totalSelected: 2,
      totalApplied: 2,
      applied: [
        { name: 'bundle-a', version: '2.0.0', replaced: '1.0.0', latest: '2.0.0', channel: 'npm' },
        { name: 'bundle-b', version: '2.0.0', replaced: '1.0.0', latest: '2.0.0', channel: 'npm' },
      ],
      updatedList: [
        { name: 'bundle-a', version: '2.0.0', latest: '2.0.0', channel: 'npm' },
        { name: 'bundle-b', version: '2.0.0', latest: '2.0.0', channel: 'npm' },
      ],
      failed: [],
      skipped: [],
    }),
    'latest?cached=1': async () => payloadOf(entries),
    jobs: async () => ({ ok: true, latest: null }),
  })
  const t = translatorOf(dictionaries.en)
  let tree = await pressCheck(mini, component, t)
  let flat = flatten(tree)
  assert.equal(byClass(flat, 'dsh-ps-select').length, 2, 'both outdated rows are selectable before the update')

  const update = buttonByText(flat, 'Update selected')
  assert.ok(update !== undefined, 'the update button is rendered after a check')
  await update.props.onClick()
  tree = await settle(mini, component, t)
  flat = flatten(tree)

  // The pre-4.4.0 code called setLatest(null) here, which emptied the panel.
  assert.equal(byClass(flat, 'dsh-ps-entry').length, 2, 'the rows survive the update instead of collapsing')
  assert.equal(byClass(flat, 'dsh-ps-select').length, 0, 'updated rows are no longer updatable')
  assert.equal(checkboxCount(flat), 0, 'updated rows lose their checkbox')
  assert.match(textOf(tree), /Updated 2 bundle\(s\)/, 'the run reports what it applied')
})
