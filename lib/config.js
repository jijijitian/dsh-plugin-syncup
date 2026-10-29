import { hostname } from 'node:os'
import { expandHome } from './spec.js'

export const TOKEN_REF = 'GITHUB_TOKEN'
export const DEFAULT_GIST_NAME = 'dsh-plugin-sync'

export const DEFAULT_CONFIG = Object.freeze({
  gistName: DEFAULT_GIST_NAME,
  fileName: 'dsh-plugins.json',
  description: 'DSH plugin inventory',
  apiBaseUrl: 'https://api.github.com',
  token: '',
  tokenEnv: TOKEN_REF,
  tokenFile: '',
  hostId: '',
  stateFile: '',
  maxInstallsPerRun: 20,
  requestTimeoutMs: 30000,
  allowInsecureHttp: false,
  excludeBundles: [],
})

const UI_FIELDS = ['gistName']
const LEGACY_FIELDS = [
  'repo',
  'branch',
  'path',
  'autoSyncOnStart',
  'startupDelayMs',
  'syncIntervalMinutes',
  'syncOnPluginChange',
  'changeDebounceMs',
  'autoInstall',
  'dryRun',
  'includeDisabledBundles',
  'enableExistingBundles',
]

export class ConfigError extends Error {
  constructor(message, code = 'invalid-config') {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asInteger(value, fallback, minimum, maximum) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)))
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

export function defaultHostId() {
  const raw = hostname().trim().toLowerCase()
  const normalized = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
  return normalized === '' ? 'dsh-host' : normalized
}

function normalizeHostId(value) {
  const raw = asString(value)
  if (raw === '') return defaultHostId()
  const normalized = raw.replace(/[\u0000-\u001f\u007f]+/g, '-').replace(/\s+/g, '-').slice(0, 100)
  if (['__proto__', 'constructor', 'prototype'].includes(normalized)) return defaultHostId()
  return normalized
}

export function normalizeGistName(value) {
  if (typeof value !== 'string') return DEFAULT_GIST_NAME
  const name = value.trim()
  if (name === '' || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return DEFAULT_GIST_NAME
  return name
}

export function normalizeGistId(value) {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (text === '') return ''
  try {
    const url = new URL(text)
    const parts = url.pathname.split('/').filter((part) => part !== '')
    text = parts[parts.length - 1] ?? ''
  } catch {
    // A bare gist id is expected.
  }
  text = text.replace(/[?#].*$/, '')
  return /^[A-Za-z0-9]{8,64}$/.test(text) ? text : ''
}

export function normalizeGistFileName(value) {
  if (typeof value !== 'string') return DEFAULT_CONFIG.fileName
  const name = value.trim()
  if (name === '' || name.length > 200) return DEFAULT_CONFIG.fileName
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return DEFAULT_CONFIG.fileName
  if (/[\u0000-\u001f\u007f]/.test(name)) return DEFAULT_CONFIG.fileName
  return name
}

export function gistUrl(gistId) {
  return typeof gistId === 'string' && gistId !== '' ? `https://gist.github.com/${gistId}` : null
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function normalizeApiBaseUrl(value, allowInsecureHttp) {
  const fallback = DEFAULT_CONFIG.apiBaseUrl
  if (typeof value !== 'string' || value.trim() === '') return { value: fallback, error: null }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return { value: fallback, error: 'config.apiBaseUrl is not a valid URL; using api.github.com' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { value: fallback, error: 'config.apiBaseUrl must use http or https' }
  }
  if (url.protocol === 'http:' && !allowInsecureHttp && !isLoopbackHost(url.hostname)) {
    return {
      value: fallback,
      error: 'config.apiBaseUrl uses plain HTTP; set allowInsecureHttp only for a trusted local mock',
    }
  }
  url.search = ''
  url.hash = ''
  return { value: url.toString().replace(/\/+$/, ''), error: null }
}

function normalizeExclude(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const name = entry.trim()
    if (name === '') continue
    seen.add(name)
  }
  return [...seen].slice(0, 500)
}

export function normalizeConfig(raw) {
  const input = isRecord(raw) ? raw : {}
  const allowInsecureHttp = asBoolean(input.allowInsecureHttp, DEFAULT_CONFIG.allowInsecureHttp)
  const apiBase = normalizeApiBaseUrl(input.apiBaseUrl, allowInsecureHttp)
  const gistNameText = asString(input.gistName) || asString(input.description) || DEFAULT_GIST_NAME
  const gistName = normalizeGistName(gistNameText)
  const config = {
    gistName,
    fileName: normalizeGistFileName(input.fileName),
    description: asString(input.description, DEFAULT_CONFIG.description).slice(0, 200)
      || DEFAULT_CONFIG.description,
    apiBaseUrl: apiBase.value,
    token: asString(input.token),
    tokenEnv: asString(input.tokenEnv, DEFAULT_CONFIG.tokenEnv),
    tokenFile: expandHome(asString(input.tokenFile)),
    hostId: normalizeHostId(input.hostId),
    stateFile: expandHome(asString(input.stateFile)),
    profile: process.env.DSH_PROFILE || '',
    profileDir: process.env.DSH_PROFILE_DIR || '',
    dshHome: process.env.DSH_HOME || '',
    packHome: asString(input.packHome),
    maxInstallsPerRun: asInteger(input.maxInstallsPerRun, DEFAULT_CONFIG.maxInstallsPerRun, 1, 50),
    requestTimeoutMs: asInteger(input.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, 1_000, 120_000),
    allowInsecureHttp,
    excludeBundles: normalizeExclude(input.excludeBundles),
    configError: undefined,
  }
  if (apiBase.error !== null) {
    config.configError = apiBase.error
  }
  return config
}

export function publicConfig(config) {
  return {
    gistName: config.gistName,
    defaultGistName: DEFAULT_GIST_NAME,
  }
}

export function serializeConfig(config, currentRaw = {}) {
  const raw = isRecord(currentRaw) ? currentRaw : {}
  const rawHostId = asString(raw.hostId)
  return {
    gistName: config.gistName,
    ...(config.fileName === DEFAULT_CONFIG.fileName ? {} : { fileName: config.fileName }),
    ...(config.description === DEFAULT_CONFIG.description ? {} : { description: config.description }),
    ...(rawHostId === '' && config.hostId === defaultHostId() ? {} : { hostId: config.hostId }),
    ...(config.tokenEnv === TOKEN_REF ? {} : { tokenEnv: config.tokenEnv }),
    ...(config.tokenFile === '' ? {} : { tokenFile: config.tokenFile }),
    ...(config.maxInstallsPerRun === DEFAULT_CONFIG.maxInstallsPerRun
      ? {}
      : { maxInstallsPerRun: config.maxInstallsPerRun }),
    ...(config.apiBaseUrl === DEFAULT_CONFIG.apiBaseUrl ? {} : { apiBaseUrl: config.apiBaseUrl }),
    ...(config.requestTimeoutMs === DEFAULT_CONFIG.requestTimeoutMs
      ? {}
      : { requestTimeoutMs: config.requestTimeoutMs }),
    ...(config.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    ...(config.excludeBundles.length === 0 ? {} : { excludeBundles: config.excludeBundles }),
    ...(config.stateFile === '' ? {} : { stateFile: config.stateFile }),
  }
}

function findConfigEntry(editor) {
  const entries = editor.configuration()
  if (!Array.isArray(entries)) return null
  return entries.find((item) => item?.entry?.options?.id === 'dsh-plugin-sync') ?? null
}

export function readConfigSnapshot(ctx, fallbackConfig) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.configuration !== 'function') {
    return {
      editable: false,
      reason: 'config-editor-unavailable',
      values: publicConfig(fallbackConfig),
    }
  }
  let item
  try {
    item = findConfigEntry(editor)
  } catch (error) {
    return {
      editable: false,
      reason: 'config-read-failed',
      message: error instanceof Error ? error.message : String(error),
      values: publicConfig(fallbackConfig),
    }
  }
  if (item === null) {
    return {
      editable: false,
      reason: 'entry-not-found',
      values: publicConfig(fallbackConfig),
    }
  }
  const effective = normalizeConfig(item.entry?.options?.config ?? item.inherited ?? {})
  const inherited = normalizeConfig(item.inherited ?? {})
  return {
    editable: true,
    entryId: item.entry.options.id,
    values: publicConfig(effective),
    inherited: publicConfig(inherited),
    overridden: isRecord(item.override) && Object.keys(item.override).length > 0,
  }
}

export function sanitizeConfigPatch(values) {
  const input = isRecord(values) ? values : {}
  const patch = {}
  for (const key of UI_FIELDS) {
    if (!Object.hasOwn(input, key)) continue
    patch[key] = asString(input[key])
  }
  return patch
}

export async function describeCredential(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.describe !== 'function') {
    return { available: false, configured: false, writable: false, source: null }
  }
  try {
    const info = await credentials.describe(TOKEN_REF)
    return {
      available: true,
      configured: info.configured === true,
      writable: info.writable === true,
      source: typeof info.source === 'string' ? info.source : null,
    }
  } catch (error) {
    return {
      available: false,
      configured: false,
      writable: false,
      source: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function setCredential(ctx, token) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.set !== 'function') {
    throw new ConfigError('Credential storage is unavailable on this Host', 'credentials-unavailable')
  }
  const value = asString(token)
  if (value === '') throw new ConfigError('Token must not be empty', 'invalid-token')
  await credentials.set(TOKEN_REF, value)
}

export async function clearCredential(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.unset !== 'function') {
    throw new ConfigError('Credential storage is unavailable on this Host', 'credentials-unavailable')
  }
  await credentials.unset(TOKEN_REF)
}

export async function writeConfigValues(ctx, values, fallbackConfig) {
  const editor = ctx.get('configEditor')
  if (editor === undefined || typeof editor.edit !== 'function') {
    throw new ConfigError('Configuration editing is unavailable on this Host', 'config-editor-unavailable')
  }
  const item = findConfigEntry(editor)
  if (item === null) throw new ConfigError('The plugin row cannot be located in the active profile', 'entry-not-found')
  const currentRaw = isRecord(item.entry?.options?.config) ? item.entry.options.config : {}
  const patch = sanitizeConfigPatch(values)
  const nextRaw = { ...currentRaw, ...patch }
  for (const key of LEGACY_FIELDS) Reflect.deleteProperty(nextRaw, key)
  const normalized = normalizeConfig(nextRaw)
  if (normalized.configError !== undefined) {
    throw new ConfigError(normalized.configError, 'invalid-config')
  }
  const serialized = serializeConfig(normalized, currentRaw)
  await editor.edit(item.entry, () => serialized)
  return publicConfig(normalized)
}
