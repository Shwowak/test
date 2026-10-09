import { db } from './src/core/db.js'
import { hashSecret, passwordProblem } from './src/core/auth.js'

const [name = 'admin', password] = process.argv.slice(2)
if (!password) {
  console.log('Aufruf: node reset-password.mjs <benutzer> <neues-passwort>')
  console.log('Benutzer:', db.prepare('SELECT name, role FROM users ORDER BY id').all().map(u => `${u.name} (${u.role})`).join(', ') || '–')
  process.exit(1)
}
const problem = passwordProblem(password)
if (problem) { console.error('Passwort ungültig:', problem); process.exit(1) }
const user = db.prepare('SELECT id FROM users WHERE name = ?').get(name)
if (user) db.prepare('UPDATE users SET password = ?, disabled = 0 WHERE id = ?').run(hashSecret(password), user.id)
else db.prepare("INSERT INTO users (name, password, role) VALUES (?, ?, 'admin')").run(name, hashSecret(password))
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user?.id ?? -1)
console.log(`Passwort für „${name}“ ${user ? 'zurückgesetzt' : 'angelegt (Admin)'}.`)
