import { isAbsolute, join, resolve } from 'node:path'
import { expandHome } from './spec.js'

/**
 * Where the active profile lives on disk.
 *
 * DSH does not hand a plugin its profile directory, so this reconstructs the
 * conventional `<DSH_HOME>/profiles/<profile>` layout and only reports a path it
 * can actually build. `DSH_PROFILE_DIR` wins when the host sets it.
 */
export function resolveProfileDir(config = {}) {
  const explicit = typeof config.profileDir === 'string' ? config.profileDir.trim() : ''
  if (explicit !== '') return expandHome(explicit)
  const home = typeof config.dshHome === 'string' && config.dshHome.trim() !== ''
    ? expandHome(config.dshHome.trim())
    : ''
  const profile = typeof config.profile === 'string' ? config.profile.trim() : ''
  if (home === '' || profile === '') return ''
  return join(home, 'profiles', profile)
}

function quote(value) {
  return `"${value}"`
}

/**
 * Terminal instructions for updating a bundle that HMR refuses to unload.
 *
 * The command is deliberately `pnpm add` rather than a remove-then-add: with DSH
 * closed there is no live HMR to fight, and pnpm rewrites the dependency in one
 * step. `--config.registry` is omitted so the profile's own setting applies.
 */
export function manualUpdateInstructions({ name, spec, profileDir, packHome }) {
  const target = typeof spec === 'string' && spec.trim() !== '' ? spec.trim() : name
  const safeName = typeof name === 'string' && name !== '' ? name : target
  const steps = []
  const dir = typeof profileDir === 'string' ? profileDir : ''
  const pnpm = typeof packHome === 'string' && packHome !== ''
    ? join(packHome, 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')
    : ''
  const node = typeof packHome === 'string' && packHome !== ''
    ? join(packHome, 'dependencies', 'node', 'bin', 'node.exe')
    : ''

  steps.push({
    title: 'Quit DSH completely',
    detail: 'HMR keeps the old module loaded while DSH runs, so the update needs a closed host. Close the window and make sure no DSH process is left.',
  })
  steps.push({
    title: 'Open a terminal in the profile directory',
    detail: dir === ''
      ? 'Open the folder that holds this profile\'s package.json.'
      : `cd ${quote(dir)}`,
    command: dir === '' ? '' : `cd ${quote(dir)}`,
  })
  steps.push({
    title: 'Update the package',
    detail: 'Installs the newest release into the profile and rewrites its dependency entry.',
    command: pnpm !== '' && node !== ''
      ? `${quote(node)} ${quote(pnpm)} add ${target}`
      : `pnpm add ${target}`,
  })
  steps.push({
    title: 'Start DSH again',
    detail: `The new version loads on start. "${safeName}" stays installed and enabled throughout.`,
  })

  return {
    name: safeName,
    spec: target,
    profileDir: dir,
    steps,
  }
}

/** Relative-safe display path so the page never shows a bare absolute path twice. */
export function displayPath(value, base) {
  if (typeof value !== 'string' || value === '') return ''
  if (typeof base !== 'string' || base === '' || !isAbsolute(value)) return value
  const resolved = resolve(value)
  const resolvedBase = resolve(base)
  return resolved.startsWith(`${resolvedBase}\\`) || resolved.startsWith(`${resolvedBase}/`)
    ? `.${resolved.slice(resolvedBase.length)}`
    : resolved
}
