import { describe, expect, it } from 'vitest'
import { isPublicPath, landingPath, safeRedirect, signInDestination } from './routes'

describe('isPublicPath', () => {
  it('lets someone reach an invitation or a trial without an account', () => {
    // Both are reached by definition with no session. Gating them turned every
    // invitation link into a redirect to a sign-in page for an account that
    // does not exist yet — a dead end with no way out.
    expect(isPublicPath('/signup')).toBe(true)
    expect(isPublicPath('/invite')).toBe(true)
    expect(isPublicPath('/invite/J2wwmzr0HwYtP6lGL8gssSdFWq1ihxde')).toBe(true)
  })

  it('lets a customer open a menu link sent to their phone', () => {
    // They have no account and never will. Deny-by-default would send them to
    // a sign-in page for something they cannot have — the same dead end
    // invitations hit.
    expect(isPublicPath('/m/AzwlXR-y2xfGVS9iP')).toBe(true)
  })

  it('does not open every path beginning with m', () => {
    expect(isPublicPath('/manager')).toBe(false)
  })

  it('lets a scheduler reach the cron endpoints', () => {
    // A job firing at six in the morning has no session. Leaving these to
    // deny-by-default sent Netlify's cron to the sign-in page and the sync
    // silently never ran. The shared secret in the handler is the guard.
    expect(isPublicPath('/api/cron/pricing')).toBe(true)
  })

  it('lets Stripe reach the webhook endpoint', () => {
    // Same reasoning as the cron routes: Stripe carries no session cookie, so
    // deny-by-default would answer every delivery with a redirect and billing
    // would be silently broken in a way that looks like nobody has paid yet.
    // The signature is the guard, and it refuses when the secret is unset.
    expect(isPublicPath('/api/webhooks/stripe')).toBe(true)
  })

  it('does not open anything that merely starts with those words', () => {
    // Prefix matching on a bare startsWith would make /signups-report and
    // /invitees public too.
    expect(isPublicPath('/signup-admin')).toBe(false)
    expect(isPublicPath('/invitees')).toBe(false)
    expect(isPublicPath('/api/webhooks-debug')).toBe(false)
  })

  it('lets the marketing site and sign-in through', () => {
    expect(isPublicPath('/')).toBe(true)
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/demo')).toBe(true)
  })

  it('lets framework assets through', () => {
    expect(isPublicPath('/_next/static/chunk.js')).toBe(true)
    expect(isPublicPath('/favicon.ico')).toBe(true)
  })

  it('lets a load balancer reach the health check', () => {
    /*
      A probe carries no session and never will. Gated, it would get a redirect
      to the sign-in page — which is a 307, which most load balancers read as
      "not healthy", so the instance is pulled from rotation while being
      perfectly fine.

      Both forms, because monitoring calls the deep one with a query string.
    */
    expect(isPublicPath('/api/health')).toBe(true)
    expect(isPublicPath('/api/health/')).toBe(true)
  })

  it('protects every workspace surface', () => {
    for (const path of [
      '/drive',
      '/drive/abc-123',
      '/follow-up',
      '/advisor',
      '/advisor/scorecard',
      '/manager',
      '/customers',
      '/vehicles/abc',
      '/api/copilot',
    ]) {
      expect(isPublicPath(path), path).toBe(false)
    }
  })

  it('denies by default, so a new route is protected the day it is added', () => {
    expect(isPublicPath('/some-future-page')).toBe(false)
  })

  it('does not let a lookalike prefix through', () => {
    // "/loginner" is not "/login", and "/demo-data" is not "/demo".
    expect(isPublicPath('/loginner')).toBe(false)
    expect(isPublicPath('/demo-data')).toBe(false)
  })

  it('allows real sub-paths of a public prefix', () => {
    expect(isPublicPath('/auth/callback')).toBe(true)
  })

  it('lets the customer tablet through without a staff session', () => {
    // A tablet is not a person and carries no session cookie. Gating it would
    // send a device in a customer's hands to a dealership sign-in page. Both
    // surfaces authenticate the device by its own bearer token instead.
    expect(isPublicPath('/present')).toBe(true)
    expect(isPublicPath('/api/device')).toBe(true)
  })

  it('does not open the rest of the API alongside it', () => {
    expect(isPublicPath('/api/copilot')).toBe(false)
    expect(isPublicPath('/api/devices')).toBe(false)
  })
})

describe('safeRedirect', () => {
  it('keeps a same-origin path', () => {
    expect(safeRedirect('/follow-up?owner=BDC')).toBe('/follow-up?owner=BDC')
  })

  it('falls back when there is no target', () => {
    expect(safeRedirect(null)).toBe('/drive')
    expect(safeRedirect(undefined)).toBe('/drive')
    expect(safeRedirect('')).toBe('/drive')
  })

  it('refuses an absolute URL', () => {
    // An open redirect on a login form is a standard phishing primitive: sign
    // the user in, bounce them to a lookalike, harvest the next thing they type.
    expect(safeRedirect('https://evil.example/login')).toBe('/drive')
  })

  it('refuses a protocol-relative URL', () => {
    expect(safeRedirect('//evil.example')).toBe('/drive')
    expect(safeRedirect('/\\evil.example')).toBe('/drive')
  })

  it('honours a caller-supplied fallback', () => {
    expect(safeRedirect(null, '/follow-up')).toBe('/follow-up')
  })
})

describe('landingPath', () => {
  it('sends dealership staff to the drive', () => {
    expect(landingPath({ hasStore: true, isPlatformAdmin: false })).toBe('/drive')
  })

  it('sends DealerTech staff with no dealership to the console', () => {
    /*
      The bug this exists to prevent: a platform admin signed in successfully,
      was sent to /drive, and requireUser() turned them straight back to the
      sign-in form — indistinguishable from the password being wrong.
    */
    expect(landingPath({ hasStore: false, isPlatformAdmin: true })).toBe('/admin')
  })

  it('prefers the drive when somebody is both', () => {
    // A DealerTech employee who also works a rooftop is there to work it.
    // The console is one link away; the drive is their shift.
    expect(landingPath({ hasStore: true, isPlatformAdmin: true })).toBe('/drive')
  })

  it('sends an account with neither to the workspace, which explains itself', () => {
    // An invited user before anyone granted them a role. /drive bounces to the
    // sign-in page, which is the surface that says why.
    expect(landingPath({ hasStore: false, isPlatformAdmin: false })).toBe('/drive')
  })
})

describe('signInDestination', () => {
  const PLATFORM = { hasStore: false, isPlatformAdmin: true }
  const ADVISOR = { hasStore: true, isPlatformAdmin: false }

  it('lets the account decide when nothing was asked for', () => {
    expect(signInDestination('', PLATFORM)).toBe('/admin')
    expect(signInDestination(null, PLATFORM)).toBe('/admin')
    expect(signInDestination(undefined, ADVISOR)).toBe('/drive')
  })

  it('distinguishes "asked for nothing" from "asked for the drive"', () => {
    /*
      The regression this file exists for. The login page ran safeRedirect()
      on the query string before rendering the form, which turns an absent
      ?next= into "/drive" — so the action saw an explicit request every time
      and never looked at the account. Platform staff went to /drive and were
      bounced straight back to the sign-in form.

      These two calls must not agree.
    */
    expect(signInDestination('', PLATFORM)).toBe('/admin')
    expect(signInDestination('/drive', PLATFORM)).toBe('/drive')
  })

  it('honours a real destination somebody was headed to', () => {
    expect(signInDestination('/follow-up?owner=BDC', ADVISOR)).toBe('/follow-up?owner=BDC')
  })

  it('still refuses an off-origin destination', () => {
    // Passing the raw query string through must not have opened a redirect.
    expect(signInDestination('https://evil.example', ADVISOR)).toBe('/drive')
    expect(signInDestination('//evil.example', PLATFORM)).toBe('/drive')
  })
})
