/**
 * The page's side of the Android bridge. Everything the phone has to do (read playback, press play, fetch a URL
 * without CORS limits) goes through `AndroidRpc`, which the app injects only into Lyra's own page.
 */

interface AndroidRpcChannel {
  postMessage(message: string): void
  onmessage: ((event: { data: string }) => void) | null
}

declare global {
  interface Window {
    AndroidRpc?: AndroidRpcChannel
    __lyraNative?: {
      /** called by the app when playback or permission state changes (JSON strings) */
      push(snapshotJson: string, statusJson: string): void
      /** called by the app on Back; return true if the UI handled it */
      back(): boolean
    }
  }
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void }
const pending = new Map<string, Pending>()
let seq = 0
let wired = false

function wire(): AndroidRpcChannel {
  const ch = window.AndroidRpc
  if (!ch) throw new Error('Lyra must run inside the Android app')
  if (!wired) {
    wired = true
    ch.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as { id: string; ok: boolean; result?: unknown; error?: string }
        const p = pending.get(m.id)
        if (!p) return
        pending.delete(m.id)
        if (m.ok) p.resolve(m.result)
        else p.reject(new Error(m.error ?? 'native call failed'))
      } catch {
        /* ignore malformed replies */
      }
    }
  }
  return ch
}

export function rpc<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const ch = wire()
  const id = String(++seq)
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    ch.postMessage(JSON.stringify({ id, method, args }))
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`))
    }, 45_000)
  })
}

/** fetch() that runs natively (no CORS), returning a normal Response. */
export async function nativeFetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response> {
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const call = rpc<{ status: number; headers: Record<string, string>; body: string }>('fetch', url, init?.headers ?? {})
  const abort = init?.signal
    ? new Promise<never>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    : null
  const r = await (abort ? Promise.race([call, abort]) : call)
  const bytes = Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0))
  const noBody = r.status === 204 || r.status === 205 || r.status === 304
  return new Response(noBody ? null : bytes, { status: r.status, headers: r.headers })
}
