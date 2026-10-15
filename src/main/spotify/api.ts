import { net } from 'electron'
import { createLogger } from '../logger'
import { AuthError, type SpotifyAuth } from './auth'

const log = createLogger('spotify-api')
const BASE = 'https://api.spotify.com/v1'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Spotify's machine reason, e.g. PREMIUM_REQUIRED, NO_ACTIVE_DEVICE */
    readonly reason?: string,
    readonly retryAfterSec?: number
  ) {
    super(message)
  }
}

export class NetworkError extends Error {}

export interface ApiResponse<T> {
  status: number
  data: T | null
}

export class SpotifyApi {
  constructor(
    private readonly auth: SpotifyAuth,
    private readonly clientId: () => string
  ) {}

  async request<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, opts?: { json?: unknown }): Promise<ApiResponse<T>> {
    const send = async (force: boolean): Promise<Response> => {
      const token = await this.auth.getAccessToken(this.clientId(), force)
      try {
        return await net.fetch(`${BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(opts?.json ? { 'Content-Type': 'application/json' } : {})
          },
          body: opts?.json ? JSON.stringify(opts.json) : undefined,
          signal: AbortSignal.timeout(10_000)
        })
      } catch (e) {
        throw new NetworkError((e as Error).message)
      }
    }

    let res = await send(false)
    if (res.status === 401) res = await send(true) // token revoked/expired early: refresh once

    if (res.status === 204) return { status: 204, data: null }
    if (res.ok) {
      const text = await res.text()
      return { status: res.status, data: text ? (JSON.parse(text) as T) : null }
    }

    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; reason?: string } }
    const retry = Number(res.headers.get('retry-after') ?? '')
    const err = new ApiError(
      body.error?.message ?? `Spotify API ${res.status}`,
      res.status,
      body.error?.reason,
      Number.isFinite(retry) && retry > 0 ? retry : undefined
    )
    if (res.status === 401) throw new AuthError('Spotify session expired. Sign in again.', 'revoked')
    if (res.status !== 429) log.warn(method, path.split('?')[0], res.status, err.reason ?? err.message)
    throw err
  }
}
