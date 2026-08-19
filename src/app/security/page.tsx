import Link from 'next/link'
import {
  Callout,
  DraftNotice,
  H2,
  P,
  Summary,
  Term,
  TrustPage,
  UL,
} from '@/components/marketing/trust-page'
import { CONTACT_EMAIL, PRODUCT_NAME, SUBPROCESSORS } from '@/lib/site/legal'

export const metadata = {
  title: 'Security',
  description:
    'How DealerTech.io isolates dealerships, handles credentials and customer documents, and what certifications it does not hold.',
}

/**
 * Written for a fixed-ops director's IT contact.
 *
 * ---------------------------------------------------------------------------
 * MECHANISM, NOT ADJECTIVES
 * ---------------------------------------------------------------------------
 * A vendor our size cannot win a security conversation on badges, and should
 * not try. What we can do is describe the controls precisely enough that
 * someone technical can judge them — which is what an auditor would look at
 * anyway, and what a rented logo is a proxy for.
 *
 * Every claim below is a claim about code in this repository:
 *   tenancy          src/db/scoped.ts, src/db/migrations/0001_rls_policies.sql
 *   route allowlist  src/lib/auth/routes.ts
 *   credentials      src/lib/invites/invite.ts, src/lib/presentation/link.ts,
 *                    src/lib/pairing/codes.ts
 *   documents        src/lib/contract-capture/store.ts, scripts/provision-storage.ts
 *   audit            src/lib/audit/events.ts, migration 0020
 * If one of those changes, this page changes in the same commit. A security
 * page that has drifted from the code is worse than no security page, because
 * it is a written record of a claim that stopped being true.
 */

export default function SecurityPage() {
  return (
    <TrustPage
      eyebrow="Trust"
      title="Security"
      lede="What actually protects your customers' data, described specifically enough to be checked."
      updated="security"
    >
      <Summary>
        <p>
          Dealership isolation is enforced by the database, not by our queries. A query that forgets
          to filter by store returns nothing — not another dealership&rsquo;s customers.
        </p>
        <p>
          Every page is private unless it is explicitly listed as public, so a new screen is
          protected the day it is written rather than the day someone remembers.
        </p>
        <p>
          Customer documents live in a private bucket and are only ever read through links that
          expire in ten minutes.
        </p>
        <p>
          We hold no security certifications. We describe the controls instead, and we say which ones
          we do not have.
        </p>
      </Summary>

      {/* ---------------------------------------------------------- tenancy */}
      <H2>Tenancy isolation</H2>
      <P>
        A dealer group&rsquo;s data being visible to another dealership is the failure that would end
        this company, so it is enforced at the lowest layer available rather than in application
        code.
      </P>
      <UL>
        <li>
          <strong className="text-[var(--ink)]">Row-level security is FORCED on every table</strong>,
          with policies keyed to the signed-in user&rsquo;s identity.
        </li>
        <li>
          Every request made on behalf of a person runs inside a transaction that drops to a
          restricted database role and carries that person&rsquo;s identity as a claim the policies
          read. The consequence is the one that matters:{' '}
          <strong className="text-[var(--ink)]">
            a query that forgets its store filter returns zero rows
          </strong>
          , rather than someone else&rsquo;s.
        </li>
        <li>
          The code paths that must run privileged — establishing who you are, the overnight jobs,
          billing operations, accepting an invitation before you have a role — are enumerated in
          the repository by category, each with a written reason it cannot run inside the fence.
        </li>
        <li>
          Both directions of the isolation are tested against a real Postgres: that a policy without
          a grant fails loudly, and that a grant without a policy silently writes nothing.
        </li>
        <li>
          The migration tool that would drop these policies is deliberately sabotaged in this
          repository so it cannot be run by accident.
        </li>
      </UL>

      {/* ------------------------------------------------------------ auth */}
      <H2>Authentication and access</H2>
      <Term label="Deny by default">
        Route protection is an explicit allowlist. Anything not named as public requires a signed-in
        user, so adding a page protects it automatically. The list is small, unit-tested, and every
        entry on it carries a written reason.
      </Term>
      <Term label="Sessions">
        Authentication is handled by Supabase. The session lives in httpOnly cookies that page
        scripts cannot read — set that way explicitly, not left to a library default — is refreshed
        server-side as you use the product, and is cleared by signing out.
      </Term>
      <Term label="Roles">
        A person&rsquo;s role comes from the dealership membership they actually hold, resolved
        server-side on every request. Which rooftop they are working is a browser-side preference,
        and it is only ever used to <em>choose from</em> the stores their account provably has a role
        at — never to look one up. Pasting another dealership&rsquo;s identifier into the browser
        resolves to nothing.
      </Term>
      <Term label="Scheduled jobs and webhooks">
        The overnight jobs authenticate a shared secret and refuse every request outright when that
        secret is not configured, rather than falling open. Payment webhooks are verified against
        Stripe&rsquo;s signature, and an unset signing secret refuses every delivery rather than
        accepting unverified JSON.
      </Term>

      {/* ----------------------------------------------------- credentials */}
      <H2>Bearer credentials</H2>
      <P>
        Three things in the product are opened by a link or a code rather than a password: a staff
        invitation, a service menu sent to a customer&rsquo;s phone, and a paired customer tablet.
        The credential each one ultimately rests on is built the same way.
      </P>
      <UL>
        <li>
          <strong className="text-[var(--ink)]">32 random bytes</strong> from the operating
          system&rsquo;s cryptographic source.
        </li>
        <li>
          <strong className="text-[var(--ink)]">SHA-256 stored; the raw value never written down.</strong>{' '}
          A copy of our database does not yield a working link. Lookups compare hashes.
        </li>
        <li>
          Scoped to one store and one purpose, and expiring where expiry makes sense — a customer
          menu link dies in twelve hours. A paired tablet&rsquo;s token is deliberately long-lived;
          revoking the pairing is how it ends.
        </li>
        <li>
          Comparisons that could leak information through timing use constant-time comparison.
        </li>
      </UL>
      <P>
        The six-character code a tablet pairing starts from is not one of these credentials. It is
        a claim ticket: it lives for ten minutes, is exchanged exactly once for the 32-byte token
        above, and is deleted the moment that exchange succeeds — which is what lets it be short
        enough to type.
      </P>

      {/* ------------------------------------------------------- documents */}
      <H2>Customer documents</H2>
      <P>
        An uploaded service contract is the most sensitive object in the system: it carries a
        customer&rsquo;s name, their VIN, and often their signature.
      </P>
      <UL>
        <li>
          Stored in a <strong className="text-[var(--ink)]">private</strong> bucket. The provisioning
          script refuses to leave the bucket public and says why.
        </li>
        <li>
          Read back only through <strong className="text-[var(--ink)]">signed URLs that expire in
          ten minutes</strong>, generated per request. There is no permanent public address for any
          customer document.
        </li>
        <li>Accepted file types are restricted at the bucket, not only in the browser.</li>
      </UL>

      {/* ----------------------------------------------------------- audit */}
      <H2>Audit log</H2>
      <P>
        Actions that matter — confirming a contract, changing a subscription, granting a role — are
        recorded with the actor, the record, and what changed.
      </P>
      <UL>
        <li>
          <strong className="text-[var(--ink)]">Append-only.</strong> There is no update or delete
          policy on the audit table, deliberately, and the product contains no code path that edits
          an entry. A log anyone can edit is not evidence.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Credentials are redacted before writing.</strong>{' '}
          Anything whose field name looks like a token, password, secret, API key, authorization
          header, cookie or SSN is replaced with a marker — matched case- and separator-insensitively,
          at any depth, and marked as redacted rather than silently dropped so it is visible that
          something was there.
        </li>
        <li>
          Readable for the dealerships you belong to, under the same row-level policies — and by
          our platform-support role, which is stated here because &ldquo;only&rdquo; would have
          been doing dishonest work.
        </li>
      </UL>

      {/* -------------------------------------------------------------- ai */}
      <H2>AI data handling</H2>
      <P>
        One model, one vendor, two features: reading an uploaded service contract, and the in-product
        Co-Pilot.
      </P>
      <UL>
        <li>
          Anthropic&rsquo;s commercial API terms state that data submitted through the API is not
          used to train their models. We do not train models on customer data either.
        </li>
        <li>
          Extracted fields are never trusted. They are stored as machine-read and unverified, the
          coverage engine downgrades its confidence because of it, and nothing reaches a coverage
          answer until a person has confirmed each field against the document in their hand.
        </li>
        <li>
          Where no AI provider is configured, the product says so and refuses to proceed rather than
          inventing plausible values.
        </li>
      </UL>
      <P>
        The full mechanism, including what the advisor&rsquo;s confirmation does and deliberately
        does not mean, is on the{' '}
        <Link href="/responsible-ai" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          Responsible AI
        </Link>{' '}
        page.
      </P>

      {/* --------------------------------------------------- infrastructure */}
      <H2>Infrastructure and encryption</H2>
      <P>
        {PRODUCT_NAME} runs on four vendors. Each is named because a subprocessor list this short
        is worth publishing. One more external service receives data from the product:
        NHTSA&rsquo;s public APIs, which are sent a VIN to decode it and a make, model and year to
        look up recall campaigns — and nothing about the customer. A government data source rather
        than a vendor, but a complete list is only worth having if it is complete.
      </P>
      <div className="mt-2">
        {SUBPROCESSORS.map((s) => (
          <Term key={s.name} label={s.name}>
            {s.purpose}
          </Term>
        ))}
      </div>
      <P>
        Traffic is served over HTTPS only. Data at rest is encrypted by our hosting providers, whose
        own documentation and compliance reports are the authority on the specifics — we point at
        theirs rather than restating figures we do not operate. No card data ever reaches our
        application; card entry happens on Stripe&rsquo;s hosted pages.
      </P>
      <P>
        Application secrets are held as environment variables in the hosting platform, never
        committed to the repository. The repository itself is private.
      </P>

      {/* ------------------------------------------------------- practices */}
      <H2>How we build</H2>
      <UL>
        <li>
          TypeScript in strict mode. The decision-making engines — coverage, pricing, prep sheets,
          scheduling, billing — are pure functions with no I/O, so their behaviour is provable in
          tests rather than inferable from a running system.
        </li>
        <li>
          Roughly 1,400 unit tests. Security seams have tests that exist specifically to fail if the
          seam moves: route protection, tenancy isolation against a real database, the whitelist that
          decides what a customer&rsquo;s tablet is allowed to receive.
        </li>
        <li>
          Customer-facing data is a whitelist, not a filter. Adding a field to an internal record
          does not add it to what a customer&rsquo;s screen receives — somebody has to decide to send
          it, and a test asserts that the internal coaching fields never appear at any depth.
        </li>
        <li>
          The drive, customer and vehicle screens are served with headers instructing
          intermediaries and search engines not to cache or index them.
        </li>
      </UL>

      {/* ------------------------------------------------------ disclosure */}
      <H2>Reporting a vulnerability</H2>
      <P>
        Email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>{' '}
        with enough detail to reproduce it. We will acknowledge it, tell you what we find, and fix
        what needs fixing. We will not take legal action against anyone who reports a finding in good
        faith, gives us a reasonable chance to fix it before publishing, and does not access, alter
        or exfiltrate data belonging to a dealership or its customers while investigating.
      </P>
      <P>
        There is no bug bounty. We are a small team and we would rather promise a real response than
        a payment we cannot underwrite. Machine-readable contact details are at{' '}
        <a
          href="/.well-known/security.txt"
          className="font-semibold text-[var(--ink)] underline underline-offset-4"
        >
          /.well-known/security.txt
        </a>
        .
      </P>

      {/* --------------------------------------------------- certifications */}
      <H2>What we do not have</H2>
      <Callout>
        <p>
          {PRODUCT_NAME} holds <strong className="text-[var(--ink)]">no security certifications</strong>.
          No SOC 1, no SOC 2, no ISO 27001, no ISO 27701, no ISO 42001. We do not have a compliance
          team, a formal penetration-testing programme, or a third-party auditor.
        </p>
        <p className="mt-3">
          That is what being early looks like, and pretending otherwise on a page a dealer&rsquo;s IT
          department will read is a lie with a paper trail. A SOC 2 audit becomes worth its cost when
          there are enough dealerships depending on us to justify it — a customer count, not a
          marketing decision — and we are not going to announce a timeline we have not committed to.
        </p>
        <p className="mt-3">
          What we offer in the meantime is this page: the controls stated specifically, so your IT
          contact can evaluate them directly instead of trusting a logo. If they have questions this
          page does not answer, they can ask and get an answer from the person who wrote the code.
        </p>
      </Callout>
      <P>
        The rest of the compliance picture — the Safeguards Rule, TCPA, CCPA and the questions a
        vendor questionnaire asks — is on the{' '}
        <Link href="/compliance" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          compliance page
        </Link>
        .
      </P>

      <DraftNotice />
    </TrustPage>
  )
}
