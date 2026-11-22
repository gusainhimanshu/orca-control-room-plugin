// Site pings with invented URLs and a fake fetch: no real request is ever made.
import { assert, test } from 'orca/testing'
import { freshAlarms } from './model'
import { classify, nextSiteRows, parseSites, ping, siteAlarms, siteGroup, siteNotice, type FetchLike, type SiteRow } from './sites'

test('parses Name=url entries split by commas and new lines; bad entries come back as errors', () => {
  const r = parseSites(' Shop=https://shop.example.com ,\nDocs = http://docs.example.com/a?b=c\n\n')
  assert.deepEqual(r.sites, [
    { name: 'Shop', url: 'https://shop.example.com/' },
    { name: 'Docs', url: 'http://docs.example.com/a?b=c' }
  ])
  assert.deepEqual(r.errors, [])

  const bad = parseSites('https://example.com, =https://example.com, Ftp=ftp://example.com, X=not a url, Y=https://u:p@example.com, A=https://a.example.com, A=https://b.example.com')
  assert.deepEqual(bad.sites, [{ name: 'A', url: 'https://a.example.com/' }])
  assert.equal(bad.errors.length, 6)
  assert.match(bad.errors[0], /Name=https:\/\/url/)
  assert.match(bad.errors[2], /only http/)
  assert.match(bad.errors[4], /password/)
  assert.match(bad.errors[5], /used twice/)

  assert.deepEqual(parseSites(''), { sites: [], errors: [] })
})

test('Product:Name=url entries carry their product; plain Name=url still works', () => {
  const r = parseSites('Alpha:Shop=https://shop.example.com\nShop=https://other.example.com, beta : Docs = https://docs.example.com:8443/x')
  assert.deepEqual(r.sites, [
    { product: 'Alpha', name: 'Shop', url: 'https://shop.example.com/' },
    // Same name in another group is fine.
    { name: 'Shop', url: 'https://other.example.com/' },
    { product: 'beta', name: 'Docs', url: 'https://docs.example.com:8443/x' }
  ])
  assert.deepEqual(r.errors, [])
  const bad = parseSites(':Shop=https://a.example.com, Alpha:=https://b.example.com, Alpha:A=https://c.example.com, Alpha:A=https://d.example.com')
  assert.deepEqual(bad.sites, [{ product: 'Alpha', name: 'A', url: 'https://c.example.com/' }])
  assert.equal(bad.errors.length, 3)
  assert.match(bad.errors[0], /Product:Name=https:\/\/url/)
  assert.match(bad.errors[2], /used twice/)
})

test('a site joins the group of the Orca project its product names, else the Sites group', () => {
  const projects = ['Alpha', 'Beta']
  assert.equal(siteGroup({ product: 'alpha' }, projects), 'Alpha')
  assert.equal(siteGroup({ product: 'Gamma' }, projects), null)
  assert.equal(siteGroup({}, projects), null)
})

test('classifies up, degraded and down', () => {
  assert.equal(classify({ status: 200, ms: 120 }), 'up')
  assert.equal(classify({ status: 301, ms: 120 }), 'up')
  assert.equal(classify({ status: 200, ms: 2_500 }), 'degraded')
  assert.equal(classify({ status: 404, ms: 50 }), 'degraded')
  assert.equal(classify({ status: 503, ms: 50 }), 'down')
  assert.equal(classify({ status: 0, ms: 5_000, error: 'timed out' }), 'down')
})

type Call = { url: string; method: string; credentials: string }
const fake = (answers: Record<string, { status: number; location?: string } | Error>, calls: Call[]): FetchLike => async (url, init) => {
  calls.push({ url, method: init.method, credentials: init.credentials })
  const a = answers[`${init.method} ${url}`] ?? answers[url]
  if (!a) throw new Error(`unexpected ${init.method} ${url}`)
  if (a instanceof Error) throw a
  return { status: a.status, headers: { get: (n) => (n === 'location' ? a.location ?? null : null) }, body: null }
}
const clock = () => {
  let t = 1_000
  return () => (t += 100)
}

test('ping: HEAD, falls back to GET, follows up to 3 redirects, sends no credentials', async () => {
  const calls: Call[] = []
  const r = await ping(
    'https://a.example.com/',
    fake(
      {
        'https://a.example.com/': { status: 301, location: '/b' },
        'HEAD https://a.example.com/b': { status: 405 },
        'GET https://a.example.com/b': { status: 200 }
      },
      calls
    ),
    clock()
  )
  assert.deepEqual(r, { status: 200, ms: 100 })
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['HEAD https://a.example.com/', 'HEAD https://a.example.com/b', 'GET https://a.example.com/b'])
  assert.ok(calls.every((c) => c.credentials === 'omit'))

  // A redirect loop stops after 3 hops and reports the last answer.
  const loop: Call[] = []
  const l = await ping('https://loop.example.com/', fake({ 'https://loop.example.com/': { status: 302, location: '/' } }, loop))
  assert.equal(l.status, 302)
  assert.equal(loop.length, 4)
})

test('ping: errors and timeouts are down', async () => {
  const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' })
  const t = await ping('https://slow.example.com/', fake({ 'https://slow.example.com/': timeout }, []))
  assert.equal(t.error, 'timed out')
  assert.equal(classify(t), 'down')
  const d = await ping('https://nx.example.com/', fake({ 'https://nx.example.com/': new Error('getaddrinfo ENOTFOUND') }, []))
  assert.equal(d.status, 0)
  assert.match(d.error ?? '', /ENOTFOUND/)
  const wrapped = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  assert.equal((await ping('https://off.example.com/', fake({ 'https://off.example.com/': wrapped }, []))).error, 'ECONNREFUSED')
  const bad = await ping('https://a.example.com/', fake({ 'https://a.example.com/': { status: 302, location: 'file:///etc' } }, []))
  assert.equal(classify(bad), 'down')
})

test('rows keep since across same-state rounds and remember the state before a change', () => {
  const site = [{ name: 'Shop', url: 'https://shop.example.com/' }]
  const r1 = nextSiteRows([], site, [{ status: 200, ms: 10 }], 1)
  assert.deepEqual([r1[0].state, r1[0].since, r1[0].was], ['up', 1, null])
  const r2 = nextSiteRows(r1, site, [{ status: 200, ms: 30 }], 2)
  assert.deepEqual([r2[0].since, r2[0].ms], [1, 30])
  const r3 = nextSiteRows(r2, site, [{ status: 0, ms: 5000, error: 'timed out' }], 3)
  assert.deepEqual([r3[0].state, r3[0].since, r3[0].was], ['down', 3, 'up'])
})

test('announces a site going down once, and its recovery once', () => {
  const site = [{ name: 'Shop', url: 'https://shop.example.com/' }]
  let rows: SiteRow[] = []
  let seen: string[] = []
  const round = (status: number, now: number) => {
    rows = nextSiteRows(rows, site, [{ status, ms: 10 }], now)
    const { fresh, remember } = freshAlarms(siteAlarms(rows), seen)
    seen = remember
    return fresh.map((a) => a.text)
  }
  assert.deepEqual(round(200, 1), [])
  assert.deepEqual(round(503, 2), ['Shop is down (HTTP 503)'])
  assert.deepEqual(round(503, 3), [])
  assert.deepEqual(round(200, 4), ['Shop is back up'])
  assert.deepEqual(round(200, 5), [])
  assert.deepEqual(round(500, 6), ['Shop is down (HTTP 500)'])

  assert.equal(siteNotice([]), null)
  assert.deepEqual(siteNotice([{ key: 'k', text: 'Shop is down (timed out)' }]), { title: 'Site status changed', body: 'Shop is down (timed out)' })
})
