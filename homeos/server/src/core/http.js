import { can } from './auth.js'

export class HttpError extends Error {
  constructor(statusCode, code, details) {
    super(code)
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export const requirePerm = perm => async req => {
  if (!can(req.user, perm)) throw new HttpError(403, 'forbidden', { permission: perm })
}

export const notFound = () => new HttpError(404, 'not_found')
export const badRequest = (code, details) => new HttpError(422, code, details)
