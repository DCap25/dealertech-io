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
import { CONTACT_EMAIL, LEGAL_ENTITY, PRODUCT_NAME, SUBPROCESSORS } from '@/lib/site/legal'

export const metadata = {
  title: 'Compliance',
  description:
    'DealerTech.io’s Safeguards Rule posture, subprocessors, privacy readiness, and an honest answer to the standard dealer IT questionnaire.',
}

/**
 * The page a dealer's vendor questionnaire is actually asking for.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FAQ ANSWERS QUESTIONS WE LOOK BAD ON
 * ---------------------------------------------------------------------------
 * The larger DMS vendors publish a trust portal FAQ covering encryption,
 * disaster recovery, vendor monitoring, incident response, employee screening
 * and penetration testing. Some of those we answer well and some of them the
 * honest answer is "we are a very small team and here is what we do instead".
 *
 * Skipping the ones we answer badly would be the obvious move and the wrong
 * one: a fixed-ops director working a checklist reads a missing question as a
 * no, and then has to ask, and now the conversation starts with us looking
 * evasive. Answering it plainly costs one paragraph and buys the credibility
 * that makes the rest of the page believable.
 *
 * The FAQ deliberately does not restate provider figures (cipher suites, TLS
 * versions, RPO/RTO) as though they were ours. Where the real answer is "our
 * host does this and publishes the details", it says so and points there.
 */

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <p className="font-bold">{q}</p>
      <div className="mt-2 space-y-3 leading-relaxed text-[var(--ink-soft)]">{children}</div>
    </div>
  )
}

export default function CompliancePage() {
  return (
    <TrustPage
      eyebrow="Trust"
      title="Compliance"
      lede="What applies to us today, what we commit to contractually, and what we do not hold. In that order, because that is the order it matters in."
      updated="compliance"
    >
      <Summary>
        <p>
          Your dealership is a covered financial institution under the FTC Safeguards Rule. That
          makes us your service provider, and we give the written commitment the Rule requires you to
          obtain — and we will sign your addendum.
        </p>
        <p>
          Four subprocessors, all named. No SMS, by design. Privacy rights granted to everyone
          regardless of thresholds.
        </p>
        <p>
          No SOC 2, no ISO. Stated up front rather than discovered in procurement, with the actual
          controls published on the{' '}
          <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            security page
          </Link>{' '}
          instead.
        </p>
      </Summary>

      {/* ------------------------------------------------------- safeguards */}
      <H2>The FTC Safeguards Rule (GLBA)</H2>
      <P>
        This is the load-bearing one for a US franchise dealership, and it applies today.
      </P>
      <P>
        Dealerships that arrange financing are covered financial institutions under the Gramm-Leach-Bliley
        Act, and the amended Safeguards Rule requires you to take reasonable steps to select service
        providers capable of maintaining appropriate safeguards, and to{' '}
        <strong className="text-[var(--ink)]">require those safeguards by contract</strong>. We are
        such a service provider. That is a contractual posture, not a certification, and the honest
        version of it is:
      </P>
      <UL>
        <li>
          We implement and maintain administrative, technical and physical safeguards appropriate to
          the sensitivity of the customer information we handle for you. The specifics are published,
          not asserted — see{' '}
          <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            security
          </Link>
          .
        </li>
        <li>
          We use your customer information only to provide the service to you. Not to build products,
          not to train models, not to sell.
        </li>
        <li>
          We will notify you without undue delay of a security event affecting your customer
          information, with what we know and what we are doing about it.
        </li>
        <li>
          <strong className="text-[var(--ink)]">
            We will sign your service-provider addendum.
          </strong>{' '}
          Send it to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          . If your compliance vendor has a standard form, that is easier for both of us than
          negotiating ours.
        </li>
      </UL>
      <P>
        The Rule&rsquo;s logic is also why the product treats consent the way it does: every consent
        change is stored as a dated, sourced event with the exact disclosure text shown, and where a
        store cannot prove consent the screen says so rather than assuming.
      </P>

      {/* ------------------------------------------------------------ tcpa */}
      <H2>TCPA — no SMS, by design</H2>
      <P>
        {PRODUCT_NAME} <strong className="text-[var(--ink)]">does not send text messages</strong>.
        Not throttled, not opt-in-gated — the capability is not built.
      </P>
      <P>
        When an advisor sends a customer their service menu, they copy the link and send it from
        whatever channel the store already uses and already has consent for. That keeps the
        dealership&rsquo;s existing TCPA posture intact instead of creating a new sending identity
        with new consent obligations attached to our infrastructure.
      </P>
      <P>
        Consent is still recorded, because the dealership needs the record whether or not we do the
        sending. If we add outbound messaging, it will arrive with consent capture and revocation
        built in first, and this page will say so.
      </P>

      {/* ----------------------------------------------------- subprocessors */}
      <H2>Subprocessors</H2>
      <P>The complete list. There is no fifth.</P>
      <div className="mt-2">
        {SUBPROCESSORS.map((s) => (
          <Term key={s.name} label={s.name}>
            {s.purpose}
          </Term>
        ))}
      </div>
      <P>
        All four are US-based services and dealership data is hosted in the United States. Adding a
        subprocessor means updating this page and the{' '}
        <Link href="/legal/privacy" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          privacy policy
        </Link>{' '}
        in the same change, and telling dealerships under contract.
      </P>

      {/* --------------------------------------------------------- privacy */}
      <H2>Privacy law</H2>
      <Term label="CCPA / CPRA">
        The thresholds that make California&rsquo;s law binding — revenue and consumer volume — are
        almost certainly not met by a company this size. We grant the rights anyway: know, access,
        correct, delete, and no retaliation for asking. We do not sell personal information and do
        not share it for cross-context behavioural advertising, which is why there is no
        &ldquo;Do Not Sell My Information&rdquo; page on this site — the honest version is a sentence
        in the privacy policy.
      </Term>
      <Term label="GDPR">
        Does not apply. We sell to US franchise dealerships, we have no EU establishment, and we do
        not offer the service to people in the EU or UK. If that changes, this sentence changes with
        it and the machinery gets built before the offering opens, not after.
      </Term>
      <Term label="Data processing agreement">
        We act as a service provider for everything inside the product; the dealership is the
        controller. The processor commitments — purpose limitation, the subprocessor list above,
        breach notice, assistance with individual requests — are stated here and in the{' '}
        <Link href="/legal/terms" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          terms
        </Link>
        . A countersignable DPA is available on request rather than as a download; ask and we will
        execute yours.
      </Term>
      <Term label="Modern Slavery statement">
        A UK statutory requirement above a turnover threshold. It does not apply to us, and we are
        not going to publish one for decoration.
      </Term>

      {/* ------------------------------------------------------------- ai */}
      <H2>AI governance</H2>
      <P>
        Increasingly the question a dealer group asks second. Our answer is a mechanism rather than a
        framework name, because we hold no AI certification and the mechanism is checkable:
      </P>
      <UL>
        <li>Fields a model extracts are stored as unverified and are never trusted on their own.</li>
        <li>
          The coverage engine lowers its confidence on anything machine-read and tells the advisor
          why, on screen.
        </li>
        <li>Every human confirmation is written to an append-only audit log with the actor.</li>
        <li>No customer data is used to train models.</li>
      </UL>
      <P>
        The whole story, including what a confirmation deliberately does <em>not</em> mean, is on the{' '}
        <Link href="/responsible-ai" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          Responsible AI
        </Link>{' '}
        page.
      </P>

      {/* -------------------------------------------------------- not held */}
      <H2>What we do not hold</H2>
      <Callout>
        <p>
          No SOC 1, no SOC 2 Type I or Type II. No ISO 27001, 27701 or 42001. No PCI attestation of
          our own — card data never reaches our application, so the requirement sits with Stripe. No
          HITRUST, no FedRAMP, no third-party security audit, no formal penetration-testing
          programme, and no compliance team.
        </p>
        <p className="mt-3">
          A SOC 2 becomes worth its cost when enough dealerships depend on us to justify it — that is
          a customer count, not a marketing decision, and we are not naming a timeline we have not
          committed to.
        </p>
        <p className="mt-3">
          Every vendor list has a column for this. Ours says no. What it also says is that the
          controls an auditor would examine are published in specifics on the{' '}
          <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            security page
          </Link>
          , which is more than most attestation summaries disclose.
        </p>
      </Callout>

      {/* ------------------------------------------------------------- faq */}
      <H2>The questionnaire, answered</H2>
      <P>
        These are the questions a dealer group&rsquo;s IT department asks every vendor. Including the
        ones we answer badly, because a skipped question on a trust page reads as a no.
      </P>

      <Faq q="Is data encrypted in transit and at rest?">
        <p>
          In transit, yes: the site is served over HTTPS only. At rest, our database, storage and
          backups are encrypted by our hosting providers.
        </p>
        <p>
          We deliberately do not restate their cipher suites or TLS version floors as though they
          were ours to guarantee — we do not operate that layer, and a vendor quoting numbers it does
          not control is a vendor you cannot rely on. Supabase, Netlify and Stripe publish their own
          encryption and compliance documentation, and that is the authoritative answer for anything
          at that level.
        </p>
      </Faq>

      <Faq q="Who at DealerTech can see our data?">
        <p>
          Our staff can access dealership data only to operate and support the service. The team is
          currently very small — this is a founder-run product — so the practical answer is that
          access is limited to the people who build and run it, and a support grant is written to
          an append-only audit log when it is made and when it is revoked.
        </p>
        <p>
          Inside the product, a dealership&rsquo;s staff see only their own dealership&rsquo;s data,
          enforced by the database rather than by our queries.
        </p>
      </Faq>

      <Faq q="Where does our data live?">
        <p>
          In the United States, with Supabase (database and document storage) and Netlify (hosting).
          We do not replicate dealership data outside the US.
        </p>
      </Faq>

      <Faq q="What are your backup and disaster recovery arrangements?">
        <p>
          Database backups are managed by Supabase on their platform, including point-in-time
          recovery on their paid tiers, and the application itself is stateless — it redeploys from
          source. So the recovery story is: the code is reproducible, and the data is on a managed
          Postgres with the provider&rsquo;s backup regime.
        </p>
        <p>
          What we do <strong className="text-[var(--ink)]">not</strong> have is a documented RPO and
          RTO we have tested by rehearsing a full restore. Publishing one we had not practised would
          be worse than saying this. It is on the list ahead of a certification, because it is the
          thing that would actually matter at three in the morning.
        </p>
      </Faq>

      <Faq q="What is your incident response process?">
        <p>
          If we determine a security event has affected a dealership&rsquo;s customer information, we
          notify that dealership without undue delay, with what we know, what we do not yet know, and
          what we are doing. We contain first, then investigate, then write it up.
        </p>
        <p>
          It is not a rehearsed playbook run by a team on rotation, and it would be dishonest to
          describe it as one. The compensating fact is that the person who would answer the phone is
          the person who wrote the code.
        </p>
      </Faq>

      <Faq q="Do you monitor your own vendors?">
        <p>
          With four subprocessors, monitoring means reading their status and security notices and
          keeping the list on this page true. That is proportionate at four. It would not be at
          forty, which is one of several reasons the list stays short.
        </p>
      </Faq>

      <Faq q="Do you screen employees?">
        <p>
          Not through a formal background-check programme — there is no hiring pipeline to run one
          against yet. When we hire people with production access, screening comes before the access
          does, and this answer changes.
        </p>
      </Faq>

      <Faq q="What does your development process look like? Do you pen-test?">
        <p>
          Strict TypeScript, roughly 1,400 unit tests, and the security seams — tenant isolation,
          route protection, the whitelist governing what a customer&rsquo;s screen may receive — each
          have tests written specifically to fail if the seam moves. Tenant isolation is tested
          against a real Postgres rather than a mock. Secrets live in the hosting platform&rsquo;s
          environment, never in the repository, which is private.
        </p>
        <p>
          There is no third-party penetration test. When one happens, this page will say who did it
          and when.
        </p>
      </Faq>

      <Faq q="Can we get a copy of our data out?">
        <p>
          Yes — ask and we will export it, while the account is open and deliberately after it
          closes too. The billing state that ends an account keeps export permitted, because a
          service history is your asset and holding it hostage is not a business we want to be in.
          Today the export is something we run for you rather than a self-serve button; the button
          is on the roadmap, and the commitment is not waiting for it.
        </p>
      </Faq>

      <Faq q="Do you send text messages to our customers?">
        <p>No. See the TCPA section above. Links are copied and sent by a person, from your store.</p>
      </Faq>

      <Faq q="Do you use our data to train AI models?">
        <p>
          No. Neither do we permit our AI provider to — Anthropic&rsquo;s commercial API terms state
          that API data is not used for model training.
        </p>
      </Faq>

      <H2>Ask us something this page does not answer</H2>
      <P>
        {LEGAL_ENTITY} operates {PRODUCT_NAME}. Send a questionnaire, an addendum, or a single
        awkward question to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . If the answer is bad, we would rather tell you now than have you find out later.
      </P>

      <DraftNotice />
    </TrustPage>
  )
}
