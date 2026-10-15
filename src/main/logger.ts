import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'
const MAX_BYTES = 1_000_000

let file: string | null = null

function logFile(): string | null {
  if (file) return file
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'lyra.log')
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'lyra.old.log'))
    } catch {
      /* no existing log */
    }
  } catch {
    file = null
  }
  return file
}

/** Strip anything that looks like a bearer/refresh token or auth code before logging. */
function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(/((?:access|refresh)_token["':=\s]+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]')
    .replace(/([?&](?:code|state|code_verifier)=)[^&\s]+/gi, '$1[redacted]')
}

function write(level: Level, scope: string, args: unknown[]): void {
  const msg = args
    .map((a) => (a instanceof Error ? `${a.message}${a.stack ? `\n${a.stack}` : ''}` : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(msg)}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (!app.isPackaged || level !== 'debug') console.log(line)
  const f = logFile()
  if (f && level !== 'debug') {
    try {
      appendFileSync(f, line + '\n')
    } catch {
      /* disk issues must never crash the app */
    }
  }
}

export function createLogger(scope: string) {
  return {
    debug: (...a: unknown[]) => write('debug', scope, a),
    info: (...a: unknown[]) => write('info', scope, a),
    warn: (...a: unknown[]) => write('warn', scope, a),
    error: (...a: unknown[]) => write('error', scope, a)
  }
}
