import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { decodeWords, parseFetch, fetchMail } from '../src/modules/imap.js'

test('decodeWords', () => {
  assert.equal(decodeWords('=?UTF-8?B?R3LDvMOfZQ==?='), 'Grüße')
  assert.equal(decodeWords('=?ISO-8859-1?Q?M=FCller_Hans?='), 'Müller Hans')
})

test('fetchMail against fake server', async () => {
  const srv = net.createServer(s => {
    s.write('* OK ready\r\n')
    s.on('data', d => {
      for (const line of d.toString().split('\r\n').filter(Boolean)) {
        const [tag, cmd] = line.split(' ')
        if (cmd === 'EXAMINE') s.write('* 2 EXISTS\r\n' + tag + ' OK done\r\n')
        else if (cmd === 'SEARCH') s.write('* SEARCH 2\r\n' + tag + ' OK done\r\n')
        else if (cmd === 'FETCH') {
          const h1 = 'From: "Anna" <a@x.de>\r\nSubject: Hallo\r\nDate: Mon, 26 Oct 2026 10:00:00 +0100\r\n\r\n'
          const h2 = 'From: =?UTF-8?B?SsO8cmdlbg==?= <j@x.de>\r\nSubject: =?UTF-8?Q?Pr=C3=BCfung?=\r\n\r\n'
          s.write(`* 1 FETCH (FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${h1.length}}\r\n${h1})\r\n* 2 FETCH (FLAGS () BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${h2.length}}\r\n${h2})\r\n${tag} OK done\r\n`)
        } else s.write(tag + ' OK done\r\n')
      }
    })
  })
  await new Promise(r => srv.listen(0, r))
  const r = await fetchMail({ host: '127.0.0.1', port: srv.address().port, user: 'u', password: 'p"w', tls: 'no' }, 5)
  srv.close()
  assert.equal(r.unread, 1)
  assert.equal(r.total, 2)
  assert.deepEqual(r.messages.map(m => [m.from, m.subject, m.unread]), [['Jürgen', 'Prüfung', true], ['Anna', 'Hallo', false]])
})

test('parseFetch empty', () => assert.deepEqual(parseFetch('a1 OK'), []))
