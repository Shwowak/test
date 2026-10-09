import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decode } from '../src/devices/adapters/modbus.js'
import { parseGa, encodeDpt, decodeDpt } from '../src/devices/adapters/knx.js'
import { mapExposes } from '../src/devices/adapters/zigbee2mqtt.js'
import { mapNode as mapZwave } from '../src/devices/adapters/zwavejs.js'
import { mapNode as mapMatter } from '../src/devices/adapters/matter.js'
import { siteDevices } from '../src/devices/adapters/evcc.js'
import { parseAlarm } from '../src/modules/alarm.js'
import { validateCommand, cap } from '../src/devices/model.js'

test('modbus decode', () => {
  assert.equal(decode([0xfff6], 'int16'), -10)
  assert.equal(decode([0x43e1, 0x8000], 'float32'), 451)
  assert.equal(decode([0x8000, 0x43e1], 'float32', 'little'), 451)
  assert.equal(decode([1, 0], 'uint32'), 65536)
})

test('knx group address and DPT roundtrip', () => {
  assert.equal(parseGa('1/2/3'), 2563)
  assert.equal(parseGa('x'), null)
  for (const v of [21.5, -30.2, 0, 670.4]) assert.ok(Math.abs(decodeDpt('9', 0, encodeDpt('9', v).data) - v) <= Math.abs(v) * 0.001)
  assert.equal(decodeDpt('5.001', 0, encodeDpt('5.001', 50).data), 50)
  assert.equal(decodeDpt('1', encodeDpt('1', true).small, Buffer.alloc(0)), true)
})

test('zigbee2mqtt exposes', () => {
  const m = mapExposes([{ type: 'light', features: [{ type: 'binary', property: 'state', access: 7 }, { type: 'numeric', property: 'brightness', access: 7 }] }, { type: 'numeric', property: 'linkquality', access: 1 }])
  assert.equal(m.type, 'light')
  assert.deepEqual(m.capabilities.map(c => c.id), ['onoff', 'brightness'])
})

test('zwave and matter node mapping', () => {
  assert.deepEqual(mapZwave({ values: [{ commandClass: 37, property: 'currentValue', value: true }] }).capabilities.map(c => c.id), ['onoff'])
  const eps = mapMatter({ node_id: 1, attributes: { '1/6/0': true, '2/1026/0': 2150 } })
  assert.equal(eps[0].type, 'switch')
  assert.equal(eps[1].state.temperature, 21.5)
})

test('evcc site devices', () => {
  const d = Object.fromEntries(siteDevices({ pvPower: 5000, gridPower: -100, batterySoc: 80.4, loadpoints: [{ title: 'Garage', mode: 'pv', chargePower: 3700, charging: true }] }).map(([id, def, s]) => [id, { def, s }]))
  assert.equal(d.pv.s.power, 5000)
  assert.equal(d.battery.s.battery, 80)
  assert.equal(d.lp1.s.mode, 'pv')
  assert.equal(validateCommand({ capabilities: d.lp1.def.capabilities }, 'mode', 'now'), null)
  assert.ok(validateCommand({ capabilities: d.lp1.def.capabilities }, 'mode', 'turbo'))
})

test('alarm payload parsing', () => {
  assert.deepEqual(parseAlarm({ keyword: 'B3', message: 'Rauch', address: 'Hauptstr. 1' }), { title: 'B3', text: 'Rauch', address: 'Hauptstr. 1', units: '' })
  assert.equal(parseAlarm('nur Text').text, 'nur Text')
  assert.equal(parseAlarm({ alarm: { title: 'THL' } }).title, 'THL')
})

test('command validation', () => {
  const caps = [cap('onoff', 'onoff'), cap('brightness', 'brightness')]
  assert.equal(validateCommand({ capabilities: caps }, 'onoff', true), null)
  assert.ok(validateCommand({ capabilities: caps }, 'brightness', 150))
})
