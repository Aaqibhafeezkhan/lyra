import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createLogger } from './logger'

const log = createLogger('store')

/** Tiny atomic, debounced JSON file store living in userData. */
export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  readonly path: string

  constructor(name: string, private readonly defaults: T) {
    this.path = join(app.getPath('userData'), name)
    this.data = this.load()
  }

  private load(): T {
    try {
      if (existsSync(this.path)) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<T>
        return Array.isArray(this.defaults) ? (parsed as T) : { ...this.defaults, ...parsed }
      }
    } catch (e) {
      log.warn(`could not read ${this.path}, using defaults`, e)
    }
    return structuredClone(this.defaults)
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.path)
    } catch (e) {
      log.error(`failed to write ${this.path}`, e)
    }
  }
}
