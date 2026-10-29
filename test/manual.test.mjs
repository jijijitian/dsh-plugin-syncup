import test from 'node:test'
import assert from 'node:assert/strict'
import { manualUpdateInstructions, resolveProfileDir } from '../lib/manual.js'

test('resolveProfileDir rebuilds the conventional profile path', () => {
  assert.equal(
    resolveProfileDir({ dshHome: 'C:/Users/x/.dsh', profile: 'desktop' }).replace(/\\/g, '/'),
    'C:/Users/x/.dsh/profiles/desktop',
  )
  assert.equal(
    resolveProfileDir({ dshHome: 'C:/Users/x/.dsh', profile: 'desktop', profileDir: 'D:/p' }).replace(/\\/g, '/'),
    'D:/p',
  )
  assert.equal(resolveProfileDir({ dshHome: '', profile: 'desktop' }), '')
  assert.equal(resolveProfileDir({}), '')
})

test('manual instructions name the exact commands a user runs', () => {
  const guide = manualUpdateInstructions({
    name: 'dsh-mnemon',
    spec: 'dsh-mnemon@0.5.36',
    profileDir: 'C:/Users/x/.dsh/profiles/desktop',
    packHome: 'C:/Users/x/.dsh/dsh-runtimes/dsh-primary-runtime',
  })
  assert.equal(guide.name, 'dsh-mnemon')
  assert.equal(guide.spec, 'dsh-mnemon@0.5.36')
  assert.equal(guide.steps.length, 4)
  const cd = guide.steps.find((step) => step.command?.startsWith('cd '))
  assert.ok(cd.command.includes('profiles'))
  const add = guide.steps.find((step) => step.command?.includes(' add '))
  assert.match(add.command, /pnpm\.cjs/)
  assert.match(add.command, /dsh-mnemon@0\.5\.36/)
  assert.equal(guide.steps[0].title, 'Quit DSH completely')
})

test('manual instructions fall back to a plain pnpm command', () => {
  const guide = manualUpdateInstructions({ name: 'pkg', spec: 'pkg@1.0.0' })
  const add = guide.steps.find((step) => step.command?.includes(' add '))
  assert.equal(add.command, 'pnpm add pkg@1.0.0')
  assert.equal(guide.profileDir, '')
})
