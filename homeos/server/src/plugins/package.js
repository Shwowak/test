import { createHash, createPublicKey, verify } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { unzipSync } from 'fflate'

export const PLUGIN_PERMISSIONS = ['internet', 'location', 'storage', 'notifications', 'devices:read', 'devices:control', 'calendar']
export const CONFIG_FIELD_TYPES = ['text', 'password', 'number', 'bool', 'select', 'device', 'devices', 'list']

const MAX_ARCHIVE = 20 * 1024 * 1024
const MAX_TOTAL = 50 * 1024 * 1024
const ID_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/
const PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

export class PackageError extends Error {
  constructor(code, details) { super(code); this.code = code; this.details = details }
}

export function validateManifest(m, files) {
  const fail = (msg) => { throw new PackageError('plugin.invalid_manifest', { message: msg }) }
  if (!m || typeof m !== 'object') fail('manifest.json missing')
  if (typeof m.id !== 'string' || !ID_RE.test(m.id) || m.id.length > 64) fail('id must look like vendor.name')
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(m.version)) fail('version must be semver')
  if (!m.name || (typeof m.name !== 'string' && typeof m.name !== 'object')) fail('name required')
  for (const p of m.permissions ?? []) if (!PLUGIN_PERMISSIONS.includes(p)) fail(`unknown permission ${p}`)
  for (const f of m.config ?? []) {
    if (!f.key || !/^\w+$/.test(f.key)) fail('config key invalid')
    if (!CONFIG_FIELD_TYPES.includes(f.type)) fail(`config type ${f.type} unknown`)
  }
  for (const w of m.widgets ?? []) {
    if (!w.id || !/^[\w-]+$/.test(w.id)) fail('widget id invalid')
    if (!w.ui || !PATH_RE.test(w.ui) || (files && !files.has(w.ui))) fail(`widget ui ${w.ui} missing`)
  }
  if (m.backend && (!PATH_RE.test(m.backend) || (files && !files.has(m.backend)))) fail('backend file missing')
  return m
}

export function digest(files) {
  const h = createHash('sha256')
  for (const name of [...files.keys()].filter(n => n !== 'SIGNATURE').sort()) {
    h.update(name + '\0' + createHash('sha256').update(files.get(name)).digest('hex') + '\n')
  }
  return h.digest()
}

export function checkSignature(files, trustedKeys = []) {
  const raw = files.get('SIGNATURE')
  if (!raw) return { signed: false, verified: false, signer: null }
  let sig
  try { sig = JSON.parse(Buffer.from(raw).toString('utf8')) } catch { throw new PackageError('plugin.bad_signature') }
  let ok = false
  try {
    const key = createPublicKey({ key: Buffer.from(sig.key, 'base64'), format: 'der', type: 'spki' })
    ok = verify(null, digest(files), key, Buffer.from(sig.sig, 'base64'))
  } catch { ok = false }
  if (!ok) throw new PackageError('plugin.bad_signature')
  return { signed: true, verified: trustedKeys.includes(sig.key), signer: sig.signer ?? sig.key.slice(-16) }
}

export function unpack(buf) {
  if (buf.length > MAX_ARCHIVE) throw new PackageError('plugin.too_large')
  let entries
  try { entries = unzipSync(new Uint8Array(buf)) } catch { throw new PackageError('plugin.bad_archive') }
  const files = new Map()
  let total = 0
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue
    if (!PATH_RE.test(name) || name.split('/').includes('..')) throw new PackageError('plugin.bad_archive', { message: `bad path ${name}` })
    total += data.length
    if (total > MAX_TOTAL) throw new PackageError('plugin.too_large')
    files.set(name, Buffer.from(data))
  }
  let manifest
  try { manifest = JSON.parse(files.get('manifest.json')?.toString('utf8')) } catch { manifest = null }
  validateManifest(manifest, files)
  return { files, manifest }
}

export function readDir(dir) {
  const files = new Map()
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else files.set(relative(dir, p).split(sep).join('/'), readFileSync(p))
    }
  }
  walk(dir)
  return files
}
