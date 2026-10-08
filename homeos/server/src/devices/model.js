export const DEVICE_TYPES = [
  'light', 'switch', 'outlet', 'thermostat', 'heating', 'cover', 'blind', 'door', 'window', 'lock',
  'camera', 'sensor', 'smoke', 'motion', 'energy_meter', 'pv', 'battery', 'wallbox', 'vehicle', 'media', 'other',
]

export const CAPABILITY_KINDS = {
  onoff: { writable: true, value: 'boolean' },
  brightness: { writable: true, value: 'number', min: 0, max: 100, unit: '%' },
  color: { writable: true, value: 'hs' },
  position: { writable: true, value: 'number', min: 0, max: 100, unit: '%' },
  cover: { writable: true, value: 'enum', options: ['open', 'close', 'stop'] },
  target_temperature: { writable: true, value: 'number' },
  lock: { writable: true, value: 'boolean' },
  measurement: { writable: false, value: 'number' },
  binary: { writable: false, value: 'boolean' },
  text: { writable: false, value: 'string' },
}

export function cap(id, kind, extra = {}) {
  return { id, kind, ...CAPABILITY_KINDS[kind], ...extra }
}

export function validateCommand(device, capId, value) {
  const c = device.capabilities.find(x => x.id === capId)
  if (!c) return 'device.capability_unknown'
  if (!c.writable) return 'device.capability_readonly'
  if (c.value === 'boolean' && typeof value !== 'boolean') return 'device.value_invalid'
  if (c.value === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'device.value_invalid'
    if (c.min !== undefined && value < c.min) return 'device.value_invalid'
    if (c.max !== undefined && value > c.max) return 'device.value_invalid'
  }
  if (c.value === 'enum' && !c.options.includes(value)) return 'device.value_invalid'
  if (c.value === 'hs' && (typeof value?.h !== 'number' || typeof value?.s !== 'number')) return 'device.value_invalid'
  return null
}

const QUANTITY_UNITS = {
  temperature: '°C', humidity: '%', power: 'W', energy: 'kWh', voltage: 'V', current: 'A',
  illuminance: 'lx', co2: 'ppm', pressure: 'hPa', battery: '%', signal_strength: 'dBm',
}

export function measurement(quantity, unit) {
  return cap(quantity || 'value', 'measurement', { quantity: quantity || 'value', unit: unit ?? QUANTITY_UNITS[quantity] ?? '' })
}

export function typeForSensor(quantity) {
  if (quantity === 'power' || quantity === 'energy') return 'energy_meter'
  if (quantity === 'battery') return 'battery'
  return 'sensor'
}

export function typeForBinary(deviceClass) {
  if (['door', 'garage_door', 'opening'].includes(deviceClass)) return { type: 'door', id: 'contact' }
  if (deviceClass === 'window') return { type: 'window', id: 'contact' }
  if (['motion', 'occupancy', 'presence'].includes(deviceClass)) return { type: 'motion', id: 'motion' }
  if (['smoke', 'gas', 'carbon_monoxide'].includes(deviceClass)) return { type: 'smoke', id: 'smoke' }
  if (deviceClass === 'moisture') return { type: 'sensor', id: 'moisture' }
  return { type: 'sensor', id: deviceClass || 'state' }
}

export function primaryCapability(d) {
  const order = ['onoff', 'lock', 'position', 'target_temperature']
  for (const id of order) if (d.capabilities.some(c => c.id === id)) return id
  return d.capabilities.find(c => c.kind === 'measurement' || c.kind === 'binary')?.id ?? d.capabilities[0]?.id ?? null
}
