import { existsSync, readFileSync } from 'fs'

// Read and parse a JSON file, returning `fallback` if it's missing or unparseable.
// The whole on-disk store layer (snapshot/events/hidden/history/settings) reads
// through this single guarded path; writes stay inline (a plain writeFileSync).
export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}
