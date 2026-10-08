export class ApiError extends Error {
  constructor(status, code, details) {
    super(code)
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function api(method, url, body) {
  const res = await fetch(`/api/v1${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `http_${res.status}`, data.details)
  return data
}
