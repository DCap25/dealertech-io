/**
 * Verifies environment configuration by actually exercising it.
 *
 *   npm run check:env
 *
 * Deliberately never prints a secret. Keys are shown masked so you can tell
 * WHICH key is loaded without the value ending up in a terminal scrollback,
 * a screen share, or a support ticket.
 */

type Result = { label: string; ok: boolean; detail: string }
const results: Result[] = []

function pass(label: string, detail: string) {
  results.push({ label, ok: true, detail })
}
function fail(label: string, detail: string) {
  results.push({ label, ok: false, detail })
}

/** Shows enough to identify a key, never enough to use one. */
function mask(value: string): string {
  if (value.length <= 16) return `${value.slice(0, 4)}…(${value.length} chars)`
  return `${value.slice(0, 14)}…${value.slice(-4)} (${value.length} chars)`
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
  const secret = process.env.SUPABASE_SECRET_KEY ?? ''
  const databaseUrl = process.env.DATABASE_URL ?? ''

  // ------------------------------------------------------------ project URL
  if (!url) {
    fail('Project URL', 'NEXT_PUBLIC_SUPABASE_URL is empty')
  } else if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    fail('Project URL', `"${url}" is not a https://<ref>.supabase.co URL`)
  } else {
    pass('Project URL', url)
  }

  // -------------------------------------------------------- key formats
  if (!publishable) {
    fail('Publishable key', 'empty')
  } else if (!publishable.startsWith('sb_publishable_')) {
    fail(
      'Publishable key',
      publishable.startsWith('sb_secret_')
        ? 'this is a SECRET key in the publishable slot — they are swapped'
        : publishable.startsWith('eyJ')
          ? 'this is a legacy anon JWT; use the new "Publishable key" instead'
          : `unexpected prefix (${mask(publishable)})`,
    )
  } else {
    pass('Publishable key format', mask(publishable))
  }

  if (!secret) {
    fail('Secret key', 'empty')
  } else if (!secret.startsWith('sb_secret_')) {
    fail(
      'Secret key',
      secret.startsWith('sb_publishable_')
        ? 'this is a PUBLISHABLE key in the secret slot — they are swapped'
        : secret.startsWith('eyJ')
          ? 'this is a legacy service_role JWT; use the new "Secret key" instead'
          : `unexpected prefix (${mask(secret)})`,
    )
  } else {
    pass('Secret key format', mask(secret))
  }

  // ------------------------------------------------- keys actually work
  const base = url.replace(/\/$/, '')

  if (url && publishable) {
    try {
      /**
       * Validated against the AUTH endpoint, not /rest/v1/.
       *
       * The Data API root only accepts secret keys — it answers a publishable
       * key with 401 "Secret API key required". Testing there reports a
       * perfectly good publishable key as broken, which is exactly the wrong
       * way round for a diagnostic.
       */
      const res = await fetch(`${base}/auth/v1/settings`, { headers: { apikey: publishable } })
      if (res.ok) pass('Publishable key accepted', `HTTP ${res.status} from the Auth API`)
      else if (res.status === 401) {
        fail(
          'Publishable key rejected',
          'HTTP 401 — key is wrong, truncated, or from a different project',
        )
      } else pass('Publishable key reached the API', `HTTP ${res.status}`)
    } catch (cause) {
      fail('Publishable key', `could not reach ${base} (${cause instanceof Error ? cause.message : 'network error'})`)
    }
  }

  if (url && secret) {
    try {
      // The Data API root requires a secret key, which makes it the right
      // place to prove this one is genuinely privileged and not a publishable
      // key that happened to be pasted into the wrong slot.
      const res = await fetch(`${base}/rest/v1/`, {
        headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      })
      if (res.ok) pass('Secret key accepted', `HTTP ${res.status} from the Data API`)
      else if (res.status === 401) fail('Secret key rejected', 'HTTP 401 — wrong key or wrong project')
      else pass('Secret key reached the API', `HTTP ${res.status}`)
    } catch (cause) {
      fail('Secret key', `could not reach ${base} (${cause instanceof Error ? cause.message : 'network error'})`)
    }
  }

  // ------------------------------------------------------------ database
  if (!databaseUrl) {
    fail('DATABASE_URL', 'empty — the app cannot start')
  } else if (databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')) {
    pass('DATABASE_URL', 'pointing at LOCAL Postgres (seeded demo data)')
  } else if (databaseUrl.includes('supabase')) {
    const port = /:(\d+)\//.exec(databaseUrl)?.[1]
    if (port === '6543') {
      fail(
        'DATABASE_URL',
        'this is the TRANSACTION pooler (6543). Migrations need the SESSION pooler on 5432.',
      )
    } else if (databaseUrl.includes('YOUR-PASSWORD') || databaseUrl.includes('[YOUR-PASSWORD]')) {
      fail('DATABASE_URL', 'the password placeholder was never replaced')
    } else {
      pass('DATABASE_URL', `pointing at Supabase, port ${port ?? 'unknown'}`)
    }
  } else {
    pass('DATABASE_URL', 'pointing at a non-Supabase, non-local host')
  }

  // ------------------------------------------------------------- report
  const width = Math.max(...results.map((r) => r.label.length))
  console.log('')
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'}  ${r.label.padEnd(width)}  ${r.detail}`)
  }
  const failures = results.filter((r) => !r.ok)
  console.log('')
  if (failures.length === 0) {
    console.log('  All checks passed.')
  } else {
    console.log(`  ${failures.length} problem${failures.length === 1 ? '' : 's'} to fix.`)
  }
  console.log('')
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
