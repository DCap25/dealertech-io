import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isPublicPath } from '@/lib/auth/routes'

/**
 * The tripwire under the cookie policy.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM THIS PROTECTS
 * ---------------------------------------------------------------------------
 * `/legal/cookies` tells the world that an anonymous visitor to this site
 * receives zero cookies, that there are no analytics, no pixels, no tag
 * manager and no third-party scripts, and that adding any non-essential cookie
 * means adding real consent first. The homepage footer says the short version.
 * Both are true today.
 *
 * The failure mode is not somebody deciding to lie. It is somebody adding
 * Plausible on a Tuesday because it is four lines and nobody remembers that a
 * published page in the footer now contradicts the site. That is exactly the
 * shape of mistake a test catches and a code review does not.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST HONESTLY IS, AND IS NOT
 * ---------------------------------------------------------------------------
 * It is a static assertion over the source of the public surface: no module
 * that renders a marketing or trust page may reach for the cookie jar, write
 * `document.cookie`, mount a script tag, pull in an external subresource, or
 * name any of the usual analytics globals.
 *
 * The surface is the pages *plus the two files every one of them inherits* —
 * the root layout, which wraps all of them, and the global stylesheet it
 * imports. Both were blind spots for a while, and both are the natural place
 * for the mistake this test exists to catch: a tag manager goes in a layout,
 * not in a page, and a font or icon set arrives as one line of CSS. A
 * `@import url(https://…)` in globals.css would have made every claim on the
 * cookie page false without touching a single file the walk below visited.
 *
 * It is NOT a runtime assertion that a response carries no `Set-Cookie`
 * header. That would need a real request through the middleware and the
 * framework's render pipeline, which this suite has no seam for — vitest here
 * runs in a bare node environment with no server. Rather than mock the whole
 * pipeline and end up asserting the behaviour of the mock, this asserts the
 * property one level down: the marketing layer does not import the tools that
 * could set a cookie, so it cannot have set one.
 *
 * Three known limits, stated rather than papered over:
 *   - Middleware runs on these paths and refreshes a Supabase session. With no
 *     cookies present there is no session to refresh and nothing is written;
 *     that behaviour lives in src/middleware.ts and is outside this file.
 *   - A dependency could in principle set a cookie without any of these
 *     strings appearing. The dependency list is twelve packages long and none
 *     of them is an analytics SDK, which is a fact about package.json rather
 *     than one this test can hold.
 *   - Tailwind is a build step, and globals.css is scanned as written rather
 *     than as compiled. A remote URL introduced by a plugin in the Tailwind
 *     pipeline would not appear here; no such plugin is configured.
 *
 * If this test is ever edited to let an analytics tag through, the cookie
 * policy, the footer line and the privacy policy all become false in the same
 * moment. Change them in the same commit or do not change this.
 */

const SRC = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Every directory whose source renders something a signed-out visitor sees.
 *
 * `request-demo` is here even though it has no page of its own — it holds the
 * form component the homepage mounts, and a tracking pixel would be just as at
 * home in a form as in a page.
 */
const PUBLIC_SOURCE_DIRS = [
  'app/demo',
  'app/request-demo',
  'app/legal',
  'app/security',
  'app/compliance',
  'app/responsible-ai',
  'app/status',
  'app/press',
  'components/marketing',
]

/**
 * Standalone files that are part of the same surface.
 *
 * `app/layout.tsx` is the root layout — it wraps every marketing and trust
 * page, so anything mounted in it is mounted on all of them at once. It is
 * held to the same rules as the pages, with one thing it is allowed to do that
 * looks superficially like a violation: it imports two typefaces from
 * `next/font/google`. That import downloads the font files at build time and
 * serves them from this origin; a visitor's browser never contacts Google, and
 * no cookie is set. The forbidden list below distinguishes the two by catching
 * the Google Fonts *hostnames*, which are what a hand-written `<link>` to a
 * stylesheet would contain and what `next/font` demonstrably does not leave in
 * the source.
 */
const PUBLIC_SOURCE_FILES = [
  'app/layout.tsx',
  'app/page.tsx',
  /*
    The gated tour's door: the page an anonymous visitor loads, and the form
    component it mounts.
    ---------------------------------------------------------------------------
    NAMED FILE BY FILE, BECAUSE app/tour/actions.ts IS DELIBERATELY NOT HERE
    ---------------------------------------------------------------------------
    Sweeping `app/tour` as a directory would pull in the server actions, which
    read `next/headers` for the rate limiter and end in a Supabase sign-in that
    writes the session cookie. Both would trip the list below, and both are
    exactly what the cookie policy already describes: "signing in sets one
    strictly necessary cookie". A redemption *is* a sign-in.
    So the tripwire is kept over the part the promise is about — what a visitor
    receives before they act. The page and the form must stay as cookie-free and
    script-free as any other marketing surface; the action they submit to is a
    sign-in and is held to the sign-in's rules instead.
    That split is also why the code a visitor types is carried in a hidden form
    field rather than a short-lived cookie. See the note at the top of
    src/app/tour/actions.ts — a cookie there would have made
    "an anonymous visitor receives zero cookies" false.
  */
  'app/tour/page.tsx',
  'app/tour/tour-gate.tsx',
]

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

function publicSources(): { path: string; source: string }[] {
  const paths = [
    ...PUBLIC_SOURCE_FILES.map((f) => join(SRC, f)),
    ...PUBLIC_SOURCE_DIRS.flatMap((d) => filesUnder(join(SRC, d))),
  ]
  return paths.map((path) => ({
    path: path.slice(SRC.length).replace(/\\/g, '/'),
    source: readFileSync(path, 'utf8'),
  }))
}

/**
 * Things that would make the cookie policy false.
 *
 * Each entry is a pattern and the sentence it would contradict, so a failure
 * message tells the next person which published claim they just broke rather
 * than only which regex matched.
 *
 * The patterns match *code* rather than words. An earlier draft banned the
 * bare token `plausible` and immediately failed on the Responsible AI page,
 * which uses the English word — a test that cannot tell a tracker from a
 * sentence gets softened the first time it cries wolf, and a softened tripwire
 * is no tripwire. So an analytics vendor is caught by its import path, its
 * hostname, or its global being called, all three of which are unambiguous.
 */
const FORBIDDEN: { pattern: RegExp; breaks: string }[] = [
  {
    pattern: /from\s+['"]next\/headers['"]/,
    breaks: '"no cookies until you sign in" — next/headers is the cookie jar',
  },
  {
    pattern: /document\s*\.\s*cookie/,
    breaks: '"no cookies until you sign in" — a cookie written in the browser',
  },
  {
    pattern: /from\s+['"]next\/script['"]/,
    breaks: '"no third-party scripts on any page"',
  },
  {
    pattern: /<script\b/i,
    breaks: '"no third-party scripts on any page"',
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    breaks: '"no third-party scripts" — the usual way a tag gets injected',
  },
  {
    /*
      Anything the browser is told to go and fetch from another origin: a
      `<script src>`, an `<iframe src>`, an image served from somebody else's
      CDN. Each one hands that host the visitor's IP, user agent and referring
      page, and lets it set a cookie of its own — which is the promise, not
      just the script tag.

      Case-sensitive on the attribute is not enough, so this matches the
      absolute URL rather than the tag; a relative `src="/logo.svg"` has no
      scheme and is untouched.
    */
    pattern: /\bsrc\s*=\s*["'{\s]*https?:\/\//i,
    breaks: '"no third-party scripts on any page" — a subresource from another origin',
  },
  {
    /*
      The same thing in stylesheet form. Lowercase `link` only, and
      deliberately so: `<Link>` is next/link, which renders an anchor and
      fetches nothing at render time. Matching case-insensitively here would
      fail on every internal navigation link on the site.
    */
    pattern: /<link\b[^>]*\bhref\s*=\s*["'{\s]*https?:\/\//,
    breaks: '"no third-party scripts on any page" — a stylesheet or preconnect to another host',
  },
  {
    /*
      A call out to another origin at render or hydration time. Own-origin
      fetches are relative paths and do not match; `new URL('https://…')` for
      metadataBase is not a request and does not match either.
    */
    pattern: /\bfetch\s*\(\s*["'`]?\s*https?:\/\//i,
    breaks: '"no third-party scripts on any page" — a request to another origin',
  },
  {
    /*
      Google Fonts by hostname. This is the line between the two ways to load
      the same typeface: `next/font/google` in app/layout.tsx downloads Geist
      at build time and serves it from this origin, leaving no hostname behind,
      while the copy-paste `<link href="https://fonts.googleapis.com/…">` makes
      every visitor's browser call Google on every page load. The first is
      allowed and in use; the second would quietly add a fifth subprocessor.
    */
    pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i,
    breaks: '"no third-party scripts" — next/font self-hosts the typeface, a <link> would not',
  },
  {
    // An analytics package, imported.
    pattern:
      /from\s+['"][^'"]*(analytics|plausible|posthog|mixpanel|hotjar|amplitude|segment|matomo|umami|@vercel\/speed-insights)/i,
    breaks: '"no analytics, no pixels, no tag manager"',
  },
  {
    // A tracker's global, called or indexed.
    pattern: /\b(gtag|dataLayer|fbq|_paq|ttq|snaptr|clarity)\s*[(.[]/,
    breaks: '"no analytics, no pixels, no tag manager"',
  },
  {
    // A third-party host, however it got referenced.
    pattern:
      /googletagmanager|google-analytics|doubleclick|facebook\.net|plausible\.io|posthog\.com|hotjar\.com|segment\.com|mxpnl\.com|clarity\.ms/i,
    breaks: '"no analytics, no pixels, no tag manager"',
  },
]

describe('the public surface sets no cookies and loads no third-party scripts', () => {
  const sources = publicSources()

  it('found the source at all', () => {
    // Guards the guard. A walk that returned nothing would pass every
    // assertion below while checking exactly nothing.
    expect(sources.length).toBeGreaterThan(10)
    expect(sources.map((s) => s.path)).toContain('app/page.tsx')
    expect(sources.map((s) => s.path)).toContain('app/legal/cookies/page.tsx')
    // The root layout is the highest-leverage file on the list and the easiest
    // to drop by accident, since it is named individually rather than swept up
    // by a directory walk.
    expect(sources.map((s) => s.path)).toContain('app/layout.tsx')
  })

  it('still loads its typefaces through next/font rather than a stylesheet', () => {
    /*
      The positive half of the Google Fonts rule above. That one only says the
      hostnames are absent, which would also be true of a layout that had
      dropped web fonts entirely — or one where somebody replaced the import
      with something else on the way to adding a `<link>`. This says the
      self-hosting mechanism is actually the one in place, so the allowance
      granted in PUBLIC_SOURCE_FILES is still describing reality.
    */
    const layout = sources.find((s) => s.path === 'app/layout.tsx')!
    expect(layout.source).toMatch(/from\s+['"]next\/font\/google['"]/)
  })

  for (const { pattern, breaks } of FORBIDDEN) {
    it(`nothing public matches ${pattern} — that would break ${breaks}`, () => {
      const offenders = sources
        // The cookie policy names things it promises not to use. Excluding it
        // by path rather than softening the patterns: the page whose whole
        // subject is the list of forbidden trackers is the one file allowed to
        // write their names down.
        .filter((s) => s.path !== 'app/legal/cookies/page.tsx')
        .filter((s) => pattern.test(s.source))
        .map((s) => s.path)
      expect(offenders).toEqual([])
    })
  }
})

/**
 * The stylesheet the root layout imports, and therefore every page has.
 *
 * CSS is the quiet route to a third-party request: `@import url(https://…)`
 * and a `url(…)` pointing at another host both make the browser go and fetch
 * something, and neither looks like a script to anyone reading a diff. A font
 * service reached this way sees the visitor's IP on every page load, which is
 * precisely what the cookie page says does not happen.
 *
 * Checked as written rather than as compiled — see the limits at the top.
 */
describe('globals.css reaches no other origin', () => {
  const source = readFileSync(join(SRC, 'app/globals.css'), 'utf8')

  it('was read', () => {
    // Guards the guard, as above: an empty string passes both assertions.
    expect(source).toContain('@import "tailwindcss"')
  })

  it('imports nothing remote', () => {
    /*
      The one `@import` in this file names a package, not a URL. Tailwind
      resolves it from node_modules at build time and it never reaches a
      browser as an import at all.
    */
    expect(source).not.toMatch(/@import\s+(url\s*\(\s*)?["'(]?\s*https?:\/\//i)
    expect(source).not.toMatch(/@import\s+url\s*\(\s*["']?\s*\/\//i)
  })

  it('references no remote asset', () => {
    // Covers url() wherever it appears — background-image, src, mask, cursor.
    // Protocol-relative `url(//host/…)` is a remote fetch too, so it is here.
    const offenders = source.match(/url\s*\(\s*["']?\s*(https?:)?\/\/[^)]*\)/gi) ?? []
    expect(offenders).toEqual([])
  })
})

/**
 * The second half of the routes.ts comment.
 *
 * Those routes are on the public allowlist on the stated grounds that they are
 * static text about the company — no session, no database, nothing
 * tenant-specific. Deny-by-default is the repository's most load-bearing
 * security habit, and the way an allowlist entry turns into a leak is that
 * somebody later adds a real query to a page that was listed when it was
 * static.
 */
describe('the trust pages stay static', () => {
  const TRUST_DIRS = [
    'app/legal',
    'app/security',
    'app/compliance',
    'app/responsible-ai',
    'app/status',
    'app/press',
  ]

  const sources = TRUST_DIRS.flatMap((d) =>
    filesUnder(join(SRC, d)).map((path) => ({
      path: path.slice(SRC.length).replace(/\\/g, '/'),
      source: readFileSync(path, 'utf8'),
    })),
  )

  it('found them', () => {
    // Nine pages today. A floor rather than an equality, so adding a tenth
    // does not fail here — the assertions below are the ones that matter.
    expect(sources.length).toBeGreaterThanOrEqual(9)
  })

  it('reads no session and touches no database', () => {
    const reachesForState =
      /from\s+['"]@\/(db\/client|lib\/auth\/session|lib\/supabase\/[a-z-]+)['"]|getCurrentUser|withCurrentUserScope/
    const offenders = sources.filter((s) => reachesForState.test(s.source)).map((s) => s.path)
    expect(offenders).toEqual([])
  })

  it('every one of them is on the public allowlist', () => {
    /*
      The other direction, and the one that actually bites: a trust page added
      later without a routes.ts entry renders perfectly in development, where
      the author is signed in, and redirects every anonymous visitor to /login
      in production. Derived from the directory walk so a new page is covered
      the day it is written.
    */
    const routes = new Set(
      sources
        .filter((s) => s.path.endsWith('/page.tsx'))
        .map((s) => `/${s.path.slice('app/'.length, -'/page.tsx'.length)}`),
    )
    for (const route of routes) {
      expect(isPublicPath(route), route).toBe(true)
    }
  })
})

/**
 * `security.txt` is a published contract with security researchers, and the
 * one field that rots is `Expires`: RFC 9116 says a file past its expiry
 * should not be trusted, so an unattended date quietly turns the disclosure
 * address into one nobody is claiming to read.
 */
describe('security.txt', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../../public/.well-known/security.txt', import.meta.url)),
    'utf8',
  )

  it('names the contact address and the policy', () => {
    expect(source).toContain('Contact: mailto:info@dealertech.io')
    expect(source).toMatch(/^Policy: https:\/\/dealertech\.io\/security$/m)
  })

  it('has not expired', () => {
    const line = /^Expires:\s*(\S+)$/m.exec(source)
    expect(line, 'security.txt must carry an Expires line — RFC 9116 requires it').not.toBeNull()
    expect(new Date(line![1]!).getTime()).toBeGreaterThan(Date.now())
  })
})

/**
 * The badge wall's proof links.
 *
 * ---------------------------------------------------------------------------
 * WHAT ROTS, AND WHY A TEST IS THE ONLY THING THAT CATCHES IT
 * ---------------------------------------------------------------------------
 * `components/marketing/trust-badges.tsx` is the honest answer to a
 * competitor's wall of certification logos: eight seals, none of them issued
 * by anybody, each one a link into the section of this site that describes the
 * mechanism it claims. That link is the entire justification for showing a
 * badge at all — remove it and the wall is exactly the thing it was designed
 * not to be.
 *
 * Links do not rot loudly. Somebody renames "Tenancy isolation" or moves the
 * data-residency answer to another page, the badge keeps its confident
 * sentence, and `/security#tenancy` quietly lands at the top of the page with
 * the reader left to hunt for the paragraph that was supposed to back the
 * claim. Nothing throws, nothing 404s, and the wall goes on asserting eight
 * things whose proofs are no longer where it says they are.
 *
 * So: read the hrefs out of the badge list, and for each one require both that
 * the page exists and that the id is still in its source.
 *
 * Also checked here, because they are the same promise: that both pages
 * mounting the wall carry `id="not-held"` — the strip's closing line points at
 * `#not-held` on whichever page it is rendered into, so the anchor has to
 * exist on both — and that the four rows of the attribution strip point at
 * their vendors' own pages rather than borrowing anything.
 */
describe('every trust badge links to a section that still exists', () => {
  const source = readFileSync(join(SRC, 'components/marketing/trust-badges.tsx'), 'utf8')

  /*
    `href:` with a colon is the object-literal key in TRUST_BADGES, and it is
    the only place in the file that shape appears — the JSX uses `href={…}` and
    the vendor rows use `trustPage:`. So this collects the badge targets and
    nothing else.
  */
  const hrefs = [...source.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]!)

  it('found all eight', () => {
    // Guards the guard: a regex that matched nothing would pass every
    // assertion in the loop below by never entering it.
    expect(hrefs).toHaveLength(8)
    expect(new Set(hrefs).size, 'two badges pointing at the same section').toBe(8)
  })

  for (const href of hrefs) {
    it(`${href} resolves to a real page and a real anchor`, () => {
      const [route, anchor] = href.split('#')
      expect(anchor, `${href} has no fragment — a badge must land on its section`).toBeTruthy()

      const page = join(SRC, 'app', route!.replace(/^\//, ''), 'page.tsx')
      const pageSource = readFileSync(page, 'utf8')
      expect(pageSource, `${route} does not carry id="${anchor}"`).toContain(`id="${anchor}"`)
    })
  }

  it('the closing line’s #not-held anchor exists on both pages that mount the wall', () => {
    for (const page of ['app/compliance/page.tsx', 'app/security/page.tsx']) {
      const pageSource = readFileSync(join(SRC, page), 'utf8')
      expect(pageSource, `${page} does not mount the wall`).toContain('<TrustBadges />')
      expect(pageSource, `${page} has no id="not-held" for the strip to point at`).toContain(
        'id="not-held"',
      )
    }
  })

  it('mounts the wall nowhere else', () => {
    /*
      Deliberately not on the homepage and not inside a legal document. On the
      homepage a badge grid reads as sales decoration, which is the reading the
      whole design spends its effort avoiding; in a document somebody may one
      day have to enforce, a decorated grid sits oddly against the text.
    */
    const offenders = publicSources()
      .filter((s) => s.path !== 'components/marketing/trust-badges.tsx')
      .filter((s) => s.source.includes('<TrustBadges />'))
      .map((s) => s.path)
      .sort()
    expect(offenders).toEqual(['app/compliance/page.tsx', 'app/security/page.tsx'])
  })

  it('attributes every subprocessor’s certifications to a link on their own site', () => {
    /*
      The strip states what Supabase, Stripe, Anthropic and Netlify hold. Every
      such row must carry the vendor's own trust page, because we cannot verify
      anybody's certificate and the only honest form of the claim is "go and
      look at theirs". Four names, four outbound links.
    */
    for (const vendor of ['Supabase', 'Stripe', 'Anthropic', 'Netlify']) {
      expect(source, `${vendor} has no row in the attribution strip`).toContain(`${vendor}: {`)
    }
    const trustPages = [...source.matchAll(/trustPage:\s*'([^']+)'/g)].map((m) => m[1]!)
    expect(trustPages).toHaveLength(4)
    for (const url of trustPages) expect(url).toMatch(/^https:\/\//)
  })
})

/**
 * Not part of the cookie claim, but the same class of published fact: the
 * privacy, compliance and security pages all state that there are exactly four
 * subprocessors. That list is only true while the dependency list stays free
 * of anything that phones a fifth company.
 */
describe('the subprocessor list stays at four', () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ) as { dependencies: Record<string, string> }

  it('ships no runtime dependency belonging to a vendor we do not name', () => {
    /*
      Runtime dependencies only. A dev dependency does not reach production and
      is not a subprocessor; a runtime one that talks to a service we have not
      listed makes three published pages wrong at once.

      The allowlist is by package, not by pattern, so a new dependency is a
      deliberate decision here rather than something that slips in under a
      prefix somebody already approved.
    */
    const NAMED = new Set([
      '@anthropic-ai/sdk', // Anthropic
      '@supabase/ssr', // Supabase
      '@supabase/supabase-js', // Supabase
      'stripe', // Stripe
      // The rest touch no third party at runtime.
      'date-fns', 'drizzle-orm', 'next', 'postgres', 'react', 'react-dom',
      'server-only', 'zod',
    ])
    const unknown = Object.keys(pkg.dependencies).filter((d) => !NAMED.has(d))
    expect(unknown).toEqual([])
  })
})
