import { net, shell } from 'electron'
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { createLogger } from '../logger'
import { TokenStore, type TokenRecord } from './tokenStore'

const log = createLogger('spotify-auth')

export const REDIRECT_PORT = 53682
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`
const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const LOGIN_TIMEOUT_MS = 3 * 60_000

export const SCOPES = [
  'user-read-private', // needed to read account product (premium/free)
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-library-modify'
]

export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: 'cancelled' | 'denied' | 'network' | 'port-busy' | 'invalid-client' | 'revoked' | 'unknown'
  ) {
    super(message)
  }
}

const b64url = (b: Buffer): string => b.toString('base64url')

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  error?: string
  error_description?: string
}

const page = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Lyra</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f5f5f5;font-family:Segoe UI,system-ui,sans-serif"><div style="text-align:center"><h1 style="font-weight:600;font-size:22px;margin:0 0 8px">${title}</h1><p style="color:#8a8a8a;margin:0">${body}</p></div>`

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export class SpotifyAuth {
  private server: Server | null = null
  private refreshing: Promise<TokenRecord> | null = null
  private abortPending: (() => void) | null = null

  constructor(private readonly tokens: TokenStore) {}

  isSignedIn(clientId: string): boolean {
    const t = this.tokens.load()
    return !!t && t.clientId === clientId
  }

  signOut(): void {
    this.abortPending?.()
    this.cancelPending()
    this.tokens.clear()
  }

  cancelPending(): void {
    this.server?.close()
    this.server = null
  }

  /** Authorization Code + PKCE (no client secret). Resolves once tokens are stored. */
  async authorize(clientId: string): Promise<void> {
    this.abortPending?.()
    this.cancelPending()
    const verifier = b64url(randomBytes(64))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(16))

    const url = new URL(AUTH_URL)
    url.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(' '),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state
    }).toString()

    const code = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cancelPending()
        reject(new AuthError('Sign-in timed out. Try again.', 'cancelled'))
      }, LOGIN_TIMEOUT_MS)
      this.abortPending = () => {
        clearTimeout(timeout)
        this.abortPending = null
        reject(new AuthError('Sign-in cancelled.', 'cancelled'))
      }

      const server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', REDIRECT_URI)
        if (u.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const err = u.searchParams.get('error')
        const gotState = u.searchParams.get('state')
        const c = u.searchParams.get('code')
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (gotState !== state) {
          res.writeHead(400).end(page('Invalid request', 'State mismatch. Return to Lyra and try again.'))
          return
        }
        clearTimeout(timeout)
        if (err || !c) {
          res.writeHead(200).end(page('Access not granted', esc(err ?? 'No authorization code received.')))
          this.cancelPending()
          reject(new AuthError(err === 'access_denied' ? 'You declined access in Spotify.' : `Spotify returned: ${err ?? 'no code'}`, 'denied'))
          return
        }
        res.writeHead(200).end(page('Connected to Lyra', 'You can close this tab and return to the app.'))
        this.cancelPending()
        resolve(c)
      })
      server.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timeout)
        this.server = null
        reject(
          e.code === 'EADDRINUSE'
            ? new AuthError(`Port ${REDIRECT_PORT} is in use by another program. Close it and retry.`, 'port-busy')
            : new AuthError(e.message, 'unknown')
        )
      })
      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        this.server = server
        void shell.openExternal(url.toString())
      })
    })

    const rec = await this.tokenRequest(
      clientId,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier })
    )
    this.tokens.save(rec)
    log.info('signed in')
  }

  /** Returns a valid access token, refreshing 60s before expiry. */
  async getAccessToken(clientId: string, forceRefresh = false): Promise<string> {
    const t = this.tokens.load()
    if (!t || t.clientId !== clientId) throw new AuthError('Not signed in.', 'revoked')
    if (!forceRefresh && t.expiresAt - Date.now() > 60_000) return t.accessToken
    this.refreshing ??= this.tokenRequest(
      clientId,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }),
      t.refreshToken
    )
      .then((rec) => {
        this.tokens.save(rec)
        return rec
      })
      .finally(() => {
        this.refreshing = null
      })
    return (await this.refreshing).accessToken
  }

  private async tokenRequest(clientId: string, body: URLSearchParams, prevRefresh?: string): Promise<TokenRecord> {
    body.set('client_id', clientId)
    let res: Response
    try {
      res = await net.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15_000)
      })
    } catch (e) {
      throw new AuthError(`Could not reach Spotify: ${(e as Error).message}`, 'network')
    }
    const json = (await res.json().catch(() => ({}))) as TokenResponse
    if (!res.ok || !json.access_token) {
      const kind = json.error === 'invalid_client' ? 'invalid-client' : json.error === 'invalid_grant' ? 'revoked' : 'unknown'
      if (kind === 'revoked') this.tokens.clear()
      throw new AuthError(json.error_description ?? json.error ?? `Token request failed (${res.status})`, kind)
    }
    const refreshToken = json.refresh_token ?? prevRefresh
    if (!refreshToken) throw new AuthError('Spotify did not return a refresh token.', 'unknown')
    return { accessToken: json.access_token, refreshToken, expiresAt: Date.now() + json.expires_in * 1000, clientId }
  }
}
