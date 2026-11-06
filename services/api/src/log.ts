/**
 * JSON-lines logger: one object per line on stdout (stderr for warnings and errors), so the
 * container log is parseable. Fields whose key looks like a credential are replaced, whatever
 * the caller passes.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error'
export type Fields = Record<string, unknown>
export type Logger = { readonly [L in Level]: (message: string, fields?: Fields) => void }
export type Sink = (line: string, level: Level) => void

const SENSITIVE = /token|key|secret|authorization|password|cookie|jwt/i
const MAX_DEPTH = 4

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[truncated]'
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE.test(key) ? '[redacted]' : redact(item, depth + 1),
      ]),
    )
  }
  return value
}

const stdSink: Sink = (line, level) => {
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export function createLogger(sink: Sink = stdSink): Logger {
  const write =
    (level: Level) =>
    (message: string, fields: Fields = {}) => {
      const entry = redact(fields, 0) as Fields
      sink(JSON.stringify({ time: new Date().toISOString(), level, message, ...entry }), level)
    }
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
}
