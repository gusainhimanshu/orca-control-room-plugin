// Live-site pings: the only network requests this plugin makes, and only to URLs the user lists.
// Pure parsing and classification, plus `ping`, which takes the fetch function so tests stay offline.
import type { Alarm } from './model'

export type Site = { name: string; url: string }
export type SiteState = 'up' | 'degraded' | 'down'
/** `status` 0 means no HTTP answer (timeout, DNS or connection error); `error` then says why. */
export type PingResult = { status: number; ms: number; error?: string }
export type SiteRow = Site & {
  state: SiteState
  status: number
  ms: number
  error: string | null
  /** When it entered `state` (first reading counts). */
  since: number
  /** The state before the last change, or null when it has not changed since the worker started. */
  was: SiteState | null
}

export const TIMEOUT_MS = 5_000
export const SLOW_MS = 2_000
const MAX_REDIRECTS = 3

/** `Name=https://url` entries separated by commas or new lines. Bad entries come back as errors. */
export function parseSites(text: string): { sites: Site[]; errors: string[] } {
  const sites: Site[] = []
  const errors: string[] = []
  // shortcut: a comma inside a URL splits it; switch to newline-only if anyone needs commas in URLs.
  for (const raw of text.split(/[,\r\n]+/)) {
    const entry = raw.trim()
    if (!entry) continue
    const eq = entry.indexOf('=')
    const name = entry.slice(0, Math.max(eq, 0)).trim()
    if (!name) {
      errors.push(`"${entry}": write it as Name=https://url`)
      continue
    }
    let url: URL | null = null
    try {
      url = new URL(entry.slice(eq + 1).trim())
    } catch {
      url = null
    }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      errors.push(`"${entry}": only http:// and https:// URLs`)
    } else if (url.username || url.password) {
      errors.push(`"${entry}": no user name or password in the URL`)
    } else if (sites.some((s) => s.name === name)) {
      errors.push(`"${entry}": the name ${name} is used twice`)
    } else {
      sites.push({ name, url: url.href })
    }
  }
  return { sites, errors }
}

export function classify(r: PingResult): SiteState {
  if (r.error || r.status === 0 || r.status >= 500) return 'down'
  if (r.status >= 400 || r.ms > SLOW_MS) return 'degraded'
  return 'up'
}

/** The subset of `fetch` that `ping` uses. */
export type FetchLike = (
  url: string,
  init: { method: 'HEAD' | 'GET'; redirect: 'manual'; credentials: 'omit'; signal: AbortSignal }
) => Promise<{ status: number; headers: { get(name: string): string | null }; body?: { cancel(): Promise<void> } | null }>

/**
 * One request: HEAD (GET when the server refuses HEAD), no cookies or credentials, up to 3 redirects,
 * 5 s for the whole thing. The body is never read: it is cancelled as soon as the status is known.
 */
export async function ping(url: string, fetchFn: FetchLike, now: () => number = Date.now): Promise<PingResult> {
  const start = now()
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const call = async (target: string, method: 'HEAD' | 'GET') => {
    const res = await fetchFn(target, { method, redirect: 'manual', credentials: 'omit', signal })
    await res.body?.cancel().catch(() => undefined)
    return res
  }
  try {
    let target = url
    for (let hop = 0; ; hop++) {
      let res = await call(target, 'HEAD')
      if (res.status === 405 || res.status === 501) res = await call(target, 'GET')
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) {
        const next = new URL(location, target)
        if (next.protocol !== 'https:' && next.protocol !== 'http:') throw new Error(`redirect to ${next.protocol}`)
        target = next.href
        continue
      }
      return { status: res.status, ms: now() - start }
    }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    // Node's fetch says only "fetch failed"; the cause has the useful part (ENOTFOUND, ECONNREFUSED...).
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause
    const error = timedOut ? 'timed out' : cause?.code || cause?.message || (e instanceof Error ? e.message : String(e))
    return { status: 0, ms: now() - start, error }
  }
}

/** New rows from this round's results; `since` and `was` carry over from the previous rows. */
export function nextSiteRows(prev: SiteRow[], sites: Site[], results: PingResult[], now: number): SiteRow[] {
  return sites.map((site, i) => {
    const r = results[i]
    const state = classify(r)
    const p = prev.find((x) => x.name === site.name && x.url === site.url)
    const same = p?.state === state
    return {
      ...site,
      state,
      status: r.status,
      ms: r.ms,
      error: r.error ?? null,
      since: same ? p.since : now,
      was: !p ? null : same ? p.was : p.state
    }
  })
}

/**
 * A site that is down, or just came back from down. Keys carry no time, so with `freshAlarms` each
 * is announced once per outage: the key stays remembered while the state lasts.
 */
export function siteAlarms(rows: SiteRow[]): Alarm[] {
  const out: Alarm[] = []
  for (const r of rows) {
    if (r.state === 'down') out.push({ key: `site:${r.url}:down`, text: `${r.name} is down (${r.error ?? `HTTP ${r.status}`})` })
    else if (r.was === 'down') out.push({ key: `site:${r.url}:back`, text: `${r.name} is back ${r.state === 'up' ? 'up' : '(degraded)'}` })
  }
  return out
}

export function siteNotice(fresh: Alarm[]): { title: string; body: string } | null {
  if (!fresh.length) return null
  return { title: fresh.length === 1 ? 'Site status changed' : `${fresh.length} sites changed status`, body: fresh.map((a) => a.text).join('\n') }
}
