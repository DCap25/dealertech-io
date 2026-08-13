/**
 * Tests a Postgres connection string end to end.
 *
 *   npm run check:db                  tests whatever DATABASE_URL is active
 *   npm run check:db -- "<url>"       tests a specific string
 *
 * Never prints the password.
 */
import postgres from 'postgres'

function redact(url: string): string {
  return url.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/, '$1********$3')
}

async function main() {
  const url = process.argv[2] ?? process.env.DATABASE_URL ?? ''
  if (!url) {
    console.log('No connection string. Pass one as an argument or set DATABASE_URL.')
    process.exit(1)
  }

  console.log(`\n  Target: ${redact(url)}`)

  const host = /@([^:/]+)/.exec(url)?.[1] ?? ''
  const port = /:(\d+)\//.exec(url)?.[1] ?? ''

  if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
    console.log('  Type:   DIRECT connection (IPv6 only without the IPv4 add-on)')
  } else if (host.includes('pooler.supabase.com')) {
    console.log(`  Type:   ${port === '6543' ? 'TRANSACTION pooler — wrong for migrations' : 'SESSION pooler'}`)
  } else if (host === 'localhost' || host === '127.0.0.1') {
    console.log('  Type:   local Postgres')
  }

  const sql = postgres(url, {
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
    // Supabase requires TLS; the pooler presents a cert that does not match
    // the hostname, which is expected and why verification is relaxed here.
    ssl: host.includes('supabase') ? 'require' : false,
  })

  try {
    const [row] = await sql<{ version: string; db: string }[]>`
      SELECT version() AS version, current_database() AS db
    `
    console.log(`\n  ✓ Connected to "${row?.db}"`)
    console.log(`    ${row?.version?.split(',')[0]}`)

    const tables = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'
    `
    console.log(`    ${tables[0]?.count ?? 0} tables in the public schema\n`)
    await sql.end({ timeout: 5 })
    process.exit(0)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.log(`\n  ✗ Could not connect: ${message}`)

    if (/ENETUNREACH|EHOSTUNREACH|ENOTFOUND/i.test(message)) {
      console.log(
        '\n    That looks like an IPv6 / network reachability problem.\n' +
        '    The direct connection (db.<ref>.supabase.co) is IPv6-only unless you\n' +
        '    buy the IPv4 add-on. Use the SESSION POOLER instead — it is IPv4\n' +
        '    proxied and free:\n' +
        '      Supabase → Connect → Direct → Connection Method: Session pooler\n',
      )
    } else if (/password|authent/i.test(message)) {
      console.log(
        '\n    Authentication failed. Check the password, and percent-encode any\n' +
        '    special characters (@ -> %40, # -> %23, ? -> %3F).\n',
      )
    }
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
