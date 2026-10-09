export const WIDGET_TYPES = {
  clock: { sources: [], fields: [] },
  text: { sources: [], fields: [{ key: 'text', type: 'textarea' }] },
  kpi: {
    sources: ['static', 'rest_json', 'home_assistant'],
    fields: [
      { key: 'value', type: 'text', static: true },
      { key: 'path', type: 'text', for: ['rest_json'] },
      { key: 'entity_id', type: 'text', for: ['home_assistant'] },
      { key: 'unit', type: 'text' },
      { key: 'decimals', type: 'number' },
      { key: 'color', type: 'color' },
    ],
  },
  gauge: {
    sources: ['static', 'rest_json', 'home_assistant'],
    fields: [
      { key: 'value', type: 'number', static: true },
      { key: 'path', type: 'text', for: ['rest_json'] },
      { key: 'entity_id', type: 'text', for: ['home_assistant'] },
      { key: 'min', type: 'number' },
      { key: 'max', type: 'number' },
      { key: 'unit', type: 'text' },
      { key: 'color', type: 'color' },
    ],
  },
  chart: {
    sources: ['static', 'rest_json'],
    fields: [
      { key: 'values', type: 'list', static: true },
      { key: 'path', type: 'text', for: ['rest_json'] },
      { key: 'style', type: 'select', options: ['line', 'wave', 'bar', 'spectrum'] },
      { key: 'unit', type: 'text' },
      { key: 'color', type: 'color' },
    ],
  },
  calendar: { sources: ['ical'], fields: [{ key: 'limit', type: 'number' }] },
  switch: { sources: ['home_assistant'], fields: [{ key: 'entity_id', type: 'text', for: ['home_assistant'] }] },
  iframe: { sources: [], fields: [{ key: 'url', type: 'url' }] },
  device: { sources: [], fields: [{ key: 'device_id', type: 'device' }] },
  room: { sources: [], fields: [{ key: 'room_id', type: 'room' }] },
  plugin: { sources: [], fields: [{ key: 'plugin_widget', type: 'plugin_widget' }] },
  camera: { sources: [], fields: [{ key: 'camera_id', type: 'camera' }] },
}

export const DASHBOARD_STYLES = ['seamless', 'tiles', 'glass']

export const LOCALES = ['de', 'en', 'fr', 'es', 'it', 'nl']
