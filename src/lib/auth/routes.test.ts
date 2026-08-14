import { describe, expect, it } from 'vitest'
import { isPublicPath, safeRedirect } from './routes'

describe('isPublicPath', () => {
  it('lets the marketing site and sign-in through', () => {
    expect(isPublicPath('/')).toBe(true)
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/demo')).toBe(true)
  })

  it('lets framework assets through', () => {
    expect(isPublicPath('/_next/static/chunk.js')).toBe(true)
    expect(isPublicPath('/favicon.ico')).toBe(true)
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
