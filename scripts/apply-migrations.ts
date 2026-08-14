/**
 * Apply the hand-written SQL migrations in src/db/migrations, in order.
 *
 *   npm run db:apply
 *
 * Why this exists rather than `drizzle-kit push`:
 *
 * The row-level-security policies in this database were applied as raw SQL and
 * are not declared in the Drizzle schema. `push` diffs the schema against the
 * live database, sees policies it does not know about, and proposes DROP
 * POLICY for every one of them. Accepting that prompt would quietly remove the
 * tenant isolation from every table.
 *
 * Until the policies are declared in the schema, migrations here are written
 * by hand and are idempotent, so running this twice is a no-op.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import postgres from 'postgres'

const DIR = join(process.cwd(), 'src', 'db', 'migrations')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set.')
    process.exit(1)
  }

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) {
    console.log('No migrations found.')
    process.exit(0)
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} })

  /**
   * Record a file as applied without running it.
   *
   *   npm run db:apply -- --mark 0000_init_crm_schema.sql
   *
   * For adopting a database that was built before this ledger existed. The
   * original init migration is not idempotent and replaying it fails on the
   * first type it tries to create twice.
   */
  const markIndex = process.argv.indexOf('--mark')
  const toMark = markIndex >= 0 ? process.argv[markIndex + 1] : null

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _applied_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    if (toMark) {
      await sql`
        INSERT INTO _applied_migrations (filename) VALUES (${toMark})
        ON CONFLICT (filename) DO NOTHING
      `
      console.log(`marked ${toMark} as applied without running it`)
    }

    const applied = new Set(
      (await sql<{ filename: string }[]>`SELECT filename FROM _applied_migrations`).map(
        (r) => r.filename,
      ),
    )

    let ran = 0
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skipping ${file} (already applied)`)
        continue
      }
      const text = await readFile(join(DIR, file), 'utf8')
      process.stdout.write(`applying ${file} ... `)
      await sql.unsafe(text)
      await sql`INSERT INTO _applied_migrations (filename) VALUES (${file})`
      console.log('ok')
      ran++
    }

    console.log(`\n${ran} migration${ran === 1 ? '' : 's'} applied.`)
  } catch (error) {
    console.error('\nFAILED —', error instanceof Error ? error.message : error)
    process.exitCode = 1
  } finally {
    await sql.end()
  }
}

void main()
