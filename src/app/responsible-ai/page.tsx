import Link from 'next/link'
import {
  Callout,
  DraftNotice,
  H2,
  H3,
  P,
  Summary,
  Term,
  TrustPage,
  UL,
} from '@/components/marketing/trust-page'
import { CONTACT_EMAIL, PRODUCT_NAME } from '@/lib/site/legal'

export const metadata = {
  title: 'Responsible AI',
  description:
    'Where DealerTech.io uses a model, what it is never allowed to decide on its own, and the invariants that enforce it.',
}

/**
 * The best trust story this product has, told as mechanism.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN PAGE
 * ---------------------------------------------------------------------------
 * Larger vendors put Responsible AI as a peer of Security in their trust
 * portal, which is the tell about where dealer procurement is heading. They
 * needed an ISO 42001 certificate to say it. We can point at the code — and
 * because the honest version is specific, it reads better than the certified
 * version does.
 *
 * Everything asserted here is a property of the repository:
 *   unverified on write        src/lib/contract-capture/store.ts confirmContract
 *   machine-read suspicion     MACHINE_READ_SOURCES + engine.ts confidence floor
 *   audit on confirmation      recordAudit('CONTRACT_CONFIRMED')
 *   refuse rather than invent  extraction outcome NO_PROVIDER
 * The subtlest one — that an advisor's confirmation deliberately does NOT
 * clear the engine's low-confidence penalty — is the one worth reading the
 * block comment above `confirmContract` for. It is the whole argument of this
 * page in one place.
 */

export default function ResponsibleAiPage() {
  return (
    <TrustPage
      eyebrow="Trust"
      title="Responsible AI"
      lede="Two features use a model. Neither of them is allowed to decide anything. Here is exactly what stops them."
      updated="responsibleAi"
    >
      <Summary>
        <p>
          A model reads uploaded service contracts and answers questions inside the product. That is
          the complete list of where AI is used.
        </p>
        <p>
          Nothing a model extracts is trusted. Every field lands marked unverified, a person has to
          confirm each one against the paper, and the coverage engine{' '}
          <em>still</em> lowers its confidence afterwards — on purpose — and says so on the advisor&rsquo;s
          screen.
        </p>
        <p>
          No customer data is used to train models. Every confirmation is written to an append-only
          audit log with the name of the person who made it.
        </p>
        <p>
          With no AI provider configured, the product tells you so and refuses to proceed rather than
          producing something plausible.
        </p>
      </Summary>

      {/* ----------------------------------------------------------- where */}
      <H2>Where a model is used</H2>

      <Term label="Reading an uploaded service contract">
        A service contract arrives as a PDF or a photograph. Instead of an advisor typing a dozen
        fields off it — administrator, contract number, tier, deductible, term in months and miles,
        whether prior authorisation is required — a model reads it and proposes them. The advisor
        checks each one against the document in their hand and confirms.
      </Term>
      <Term label="The Co-Pilot">
        An in-product assistant that answers questions about the screen the user is on and about how
        the product works. It reads the context of the current surface; it does not act on the
        user&rsquo;s behalf, and it is not shown on any screen a customer holds.
      </Term>
      <P>
        Nothing else. There is no AI in the coverage engine, the pricing, the wear projections or the
        prep-sheet ranking. Those are deterministic rules over your data, each one unit-tested, each
        one able to explain which rule fired and which did not. That is deliberate — the answers a
        customer is quoted from should be reproducible, not generated.
      </P>

      {/* ------------------------------------------------------ invariants */}
      <H2>The invariants</H2>

      <H3>1. Extracted fields arrive unverified, and stay that way</H3>
      <P>
        A contract created from an upload is stored with its source recorded as machine-read and its
        verification timestamp left empty. Both facts follow the record for the rest of its life.
      </P>
      <P>
        The coverage engine treats machine-read-and-unverified as a reason to distrust: any
        determination resting on such a contract is capped at low confidence, and the reasoning
        trace the advisor sees says so in words —{' '}
        <em>read from a document and not yet verified; confirm the terms before relying on them</em>.
        The vehicle screen marks the contract the same way.
      </P>
      <P>
        The grouping is what makes it durable. The rule keys off a list of machine-read sources
        rather than being written at each place that checks, so a new extraction method added later
        inherits the suspicion by default instead of by somebody remembering to add it.
      </P>

      <H3>2. Nothing reaches the coverage engine without a person</H3>
      <P>
        Confirmation is the only path from an extraction to a usable contract. There is no automatic
        acceptance, no confidence threshold above which a field is taken as read, and no batch
        approval. A person looks at every field beside the document and agrees to it, or it does not
        exist as coverage.
      </P>

      <H3>3. A person&rsquo;s confirmation does not mean the contract is verified</H3>
      <Callout>
        <p>
          This is the invariant we are most proud of and it is the least obvious one.
        </p>
        <p className="mt-3">
          It would be easy — and it would look like a feature — to treat the advisor&rsquo;s
          confirmation as verification and clear the engine&rsquo;s low-confidence penalty. It is
          deliberately not done, because the two are answers to different questions.
        </p>
        <p className="mt-3">
          What the advisor did was agree that the transcription matches the paper in their hand. That
          is a real check, and it is why nothing saves without it. But the question the engine&rsquo;s
          penalty is asking is a different one:{' '}
          <em>does this policy exist, is it in force, and will the administrator pay?</em> A contract
          can be transcribed perfectly and still be cancelled, lapsed for non-payment, void on a
          salvage title, or simply not the copy the administrator holds.
        </p>
        <p className="mt-3">
          Only the administrator can answer that. Until somebody has rung them, &ldquo;a human read
          the document&rdquo; is the honest ceiling — so the source stays machine-read, the record
          stays unverified, and the engine keeps warning on every answer it drives. The verification
          field exists to record a real verification when it happens, not to be filled in by the
          nearest available person.
        </p>
      </Callout>

      <H3>4. Every confirmation is on the record</H3>
      <P>
        Confirming a contract writes an append-only audit entry naming the person, the document, the
        vehicle, and the values they accepted. If a customer is later told a repair is covered and
        the administrator disagrees, that entry is who accepted what, and when. The audit table
        carries no update or delete policy, deliberately, and credentials are stripped before
        anything is written.
      </P>

      <H3>5. With no provider, it refuses rather than invents</H3>
      <P>
        A deployment with no AI provider configured does not fall back to fabricated data or a
        demonstration mode dressed as a real answer. The upload records that nothing read it, and the
        advisor is told plainly to enter the fields by hand. A model that will not run is an
        inconvenience; a model that quietly makes something up is a coverage answer given to a
        customer on the strength of nothing.
      </P>

      {/* -------------------------------------------------------- training */}
      <H2>Training and data handling</H2>
      <UL>
        <li>
          <strong className="text-[var(--ink)]">We do not train models on customer data.</strong> Not
          our own models, not anyone else&rsquo;s.
        </li>
        <li>
          Our provider is Anthropic, whose commercial API terms state that data submitted through the
          API is not used to train their models.
        </li>
        <li>
          What is sent is what the feature needs: for extraction, the document being read; for the
          Co-Pilot, the context of the screen the user is on. Not a dealership&rsquo;s database.
        </li>
        <li>
          The Co-Pilot is never shown on a customer-facing screen — not the paired tablet, and not
          the menu link a customer opens on their own phone.
        </li>
      </UL>

      {/* ------------------------------------------------------ boundaries */}
      <H2 id="boundaries">What we will not do with it</H2>
      <UL>
        <li>
          No model decides what a customer is charged. Prices resolve from your own op-code price
          book, and where no op code matches the product shows &ldquo;price to be confirmed&rdquo;
          rather than guessing.
        </li>
        <li>
          No model decides whether something is covered. That is a deterministic waterfall with a
          reasoning trace, and the administrator adjudicates the claim regardless.
        </li>
        <li>
          No model writes to a customer&rsquo;s record without a person confirming it.
        </li>
        <li>
          No model talks to your customers. There is no AI chat on any customer-facing surface.
        </li>
        <li>
          No model scores or ranks your staff. Advisor coaching numbers exist, and they deliberately
          stay with the advisor.
        </li>
      </UL>

      <H2>No certification, and what that means</H2>
      <P>
        We hold no AI-governance certification — not ISO 42001, not anything else. The larger vendors
        publishing a Responsible AI page usually have one, and it is a real thing to have.
      </P>
      <P>
        What we have instead is that every claim above is a property of the code rather than a
        policy, which means it is checkable and it fails loudly if someone breaks it. The
        machine-read confidence rule, the human-confirmation requirement and the audit entry all have
        tests that exist for the sole purpose of failing if the behaviour changes. A policy document
        cannot do that.
      </P>
      <P>
        The rest of the security posture is on the{' '}
        <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          security page
        </Link>
        , and what we do and do not hold is listed on{' '}
        <Link href="/compliance" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          compliance
        </Link>
        .
      </P>

      <H2>Questions</H2>
      <P>
        If your group has an AI-use policy {PRODUCT_NAME} needs to fit inside, send it to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        .
      </P>

      <DraftNotice />
    </TrustPage>
  )
}
