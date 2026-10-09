import { db } from '../core/db.js'
import {
  verifySecret, hashSecret, createSession, publicUser, loginBlocked, loginFailed, loginSucceeded,
  passwordProblem, pinProblem, SESSION_DAYS, can, userFromToken,
} from '../core/auth.js'
import { getSetting, isLanIp, isLocalIp } from '../core/settings.js'
import { setupAllowed } from '../system/setupnet.js'
import { HttpError, badRequest, requirePerm } from '../core/http.js'
import { log } from '../core/logger.js'
import { LOCALES } from './registry.js'

const secure = process.env.HOMEOS_SECURE_COOKIE === 'true'

export default async function authModule(app) {
  app.post('/auth/login', {
    schema: {
      tags: ['auth'], summary: 'Login with password or PIN',
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, password: { type: 'string' }, pin: { type: 'string' } } },
    },
    config: { public: true },
  }, async (req, reply) => {
    const { name, password, pin } = req.body
    const key = `${req.ip}:${String(name).toLowerCase()}`
    if (loginBlocked(key)) throw new HttpError(429, 'login.blocked')
    const user = db.prepare('SELECT * FROM users WHERE name = ? AND disabled = 0').get(String(name))
    const ok = user && (pin ? verifySecret(pin, user.pin) : verifySecret(password ?? '', user.password))
    if (!ok) {
      loginFailed(key, req.ip, name)
      await new Promise(r => setTimeout(r, 500))
      throw new HttpError(401, 'login.invalid')
    }
    loginSucceeded(key, user, req.ip, pin ? 'pin' : 'password')
    reply.setCookie('homeos_session', createSession(user.id), { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: SESSION_DAYS * 86400 })
    return publicUser(user)
  })

  const setupNeeded = () => db.prepare('SELECT COUNT(*) c FROM users').get().c === 0
  const local = isLocalIp

  app.get('/auth/setup', { schema: { tags: ['auth'], summary: 'First-run setup needed?' }, config: { public: true } },
    async req => ({ needed: setupNeeded(), local: local(req.ip), codeRequired: !local(req.ip) && process.env.SMARTBOARD_HAL === '1' }))

  app.post('/auth/setup', {
    schema: {
      tags: ['auth'], summary: 'First-run: create the admin (only on the device display, only once)',
      body: { type: 'object', required: ['name', 'password'], properties: { name: { type: 'string', minLength: 1, maxLength: 40 }, password: { type: 'string' }, pin: { type: 'string' }, code: { type: 'string' } } },
    },
    config: { public: true },
  }, async (req, reply) => {
    if (!setupNeeded()) throw new HttpError(409, 'setup.done')
    if (!setupAllowed(req)) throw new HttpError(403, local(req.ip) ? 'setup.local_only' : 'setup.code_required')
    const pwErr = passwordProblem(req.body.password)
    if (pwErr) throw badRequest(pwErr)
    if (req.body.pin) { const pinErr = pinProblem(req.body.pin); if (pinErr) throw badRequest(pinErr) }
    const id = db.prepare("INSERT INTO users (name, password, pin, role) VALUES (?, ?, ?, 'admin')")
      .run(req.body.name.trim(), hashSecret(req.body.password), req.body.pin ? hashSecret(req.body.pin) : null).lastInsertRowid
    log('users', 'info', 'user.created', { name: req.body.name, role: 'admin', setup: true })
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    reply.setCookie('homeos_session', createSession(user.id), { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: SESSION_DAYS * 86400 })
    return publicUser(user)
  })

  app.get('/auth/pin-users', { schema: { tags: ['auth'], summary: 'Users that can log in with PIN (names only)' }, config: { public: true } },
    async () => db.prepare('SELECT name, COALESCE(display_name, name) AS display_name FROM users WHERE pin IS NOT NULL AND disabled = 0 ORDER BY name').all())

  app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.homeos_session)
    reply.clearCookie('homeos_session', { path: '/' })
    log('security', 'info', 'logout', null, req.user.id)
    return { ok: true }
  })

  app.get('/auth/me', { schema: { tags: ['auth'], summary: 'Current user (or automatic login if enabled)' }, config: { public: true } }, async (req, reply) => {
    const session = userFromToken(req.cookies.homeos_session)
    if (session) return publicUser(session)
    const auto = getSetting('autologin')
    const allowed = auto?.user_id && (auto.scope === 'lan' ? isLanIp(req.ip) : isLocalIp(req.ip))
    const user = allowed && db.prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(auto.user_id)
    if (!user) throw new HttpError(401, 'unauthorized')
    reply.setCookie('homeos_session', createSession(user.id), { path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: SESSION_DAYS * 86400 })
    log('auth', 'info', 'login.auto', { name: user.name, ip: req.ip }, user.id)
    return publicUser(user)
  })

  app.put('/auth/me', {
    schema: {
      tags: ['auth'], summary: 'Update own profile',
      body: { type: 'object', properties: {
        display_name: { type: 'string', maxLength: 80 }, locale: { type: 'string' },
        current_password: { type: 'string' }, new_password: { type: 'string' }, pin: { type: ['string', 'null'] },
      } },
    },
    preHandler: requirePerm('profile.edit'),
  }, async req => {
    const u = req.user
    const b = req.body
    if (b.locale && !LOCALES.includes(b.locale)) throw badRequest('locale.invalid')
    if (b.new_password) {
      if (!verifySecret(b.current_password ?? '', u.password)) throw new HttpError(403, 'password.wrong')
      const p = passwordProblem(b.new_password)
      if (p) throw badRequest(p)
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashSecret(b.new_password), u.id)
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, req.cookies.homeos_session)
      log('security', 'info', 'password.changed', null, u.id)
    }
    if (b.pin !== undefined) {
      if (b.pin === null || b.pin === '') db.prepare('UPDATE users SET pin = NULL WHERE id = ?').run(u.id)
      else {
        const p = pinProblem(b.pin)
        if (p) throw badRequest(p)
        db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hashSecret(b.pin), u.id)
      }
      log('security', 'info', 'pin.changed', null, u.id)
    }
    db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), locale = COALESCE(?, locale) WHERE id = ?')
      .run(b.display_name ?? null, b.locale ?? null, u.id)
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id))
  })

  app.decorate('can', can)
}
