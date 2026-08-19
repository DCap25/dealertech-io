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
import {
  CONTACT_EMAIL,
  GOVERNING_LAW_TEXT,
  LEGAL_ENTITY,
  PRODUCT_NAME,
} from '@/lib/site/legal'

export const metadata = {
  title: 'Terms of Service',
  description:
    'The agreement between a dealership and DealerTech.io — billing, data ownership, and what the product does and does not claim.',
}

/**
 * B2B terms, written from the code rather than from a template.
 *
 * ---------------------------------------------------------------------------
 * THE BILLING SECTION IS NOT BOILERPLATE
 * ---------------------------------------------------------------------------
 * Section 5 describes the lifecycle in `src/lib/billing/` — the states, the
 * fourteen-day grace, what a restricted account keeps, cancellation at period
 * end, proration onto the next invoice. Each sentence there corresponds to
 * behaviour in `lifecycle.ts`, `access.ts`, `cancellation.ts`, `proration.ts`
 * or `subscription-ops.ts`, and if one of those changes, this changes with it.
 *
 * That is the opposite of the usual arrangement, where terms describe a
 * generic SaaS and the software does something else. It is worth the upkeep
 * because the promises here are unusually favourable — a billing problem never
 * stops the drive, and no automated process can suspend an account — and they
 * are only worth making if they are true.
 *
 * Prices are deliberately NOT printed. The live price resolves from a Stripe
 * lookup key, so the number a dealership is charged is the one on their order
 * and at checkout; a figure typed into this page would be a second source of
 * truth that silently goes stale.
 */

export default function TermsPage() {
  return (
    <TrustPage
      eyebrow="Legal"
      title="Terms of Service"
      lede={`The agreement between your dealership and ${LEGAL_ENTITY} for the use of ${PRODUCT_NAME}. Business use only — this is not a consumer product.`}
      updated="terms"
    >
      <Summary>
        <p>
          Your dealership&rsquo;s data is yours. We hold it to run the product and for nothing else,
          and we will export it for you on request — including after the account closes.
        </p>
        <p>
          Billing is per rooftop, per month. A failed payment never stops your advisors working: you
          get fourteen days where nothing changes, then the admin screens pause while the drive keeps
          running, and only a person at DealerTech can suspend an account — no automated process can.
        </p>
        <p>
          Cancel any time and it takes effect at the end of the period you have paid for. We do not
          cut you off mid-month and we do not refund the month.
        </p>
        <p>
          The product advises; it does not adjudicate. Coverage answers, recall candidates and
          projections are decision support. Your DMS remains the system of record.
        </p>
      </Summary>

      {/* ------------------------------------------------------------ scope */}
      <H2>1. Who this is between</H2>
      <P>
        These terms are between {LEGAL_ENTITY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), which operates{' '}
        {PRODUCT_NAME}, and the dealership or dealer group that holds the account
        (&ldquo;you&rdquo;). By creating an account or using the service you agree to them. If you
        are agreeing on behalf of a dealership, you are confirming you are authorised to do so.
      </P>
      <P>
        {PRODUCT_NAME} is sold to businesses. It is not offered to consumers, and nothing in it is
        intended for personal or household use.
      </P>
      <P>
        Where you and we have signed a separate written agreement — an order form, a master services
        agreement, a service-provider addendum — that agreement governs where it conflicts with
        this page.
      </P>

      {/* ------------------------------------------------------------- use */}
      <H2>2. Accounts and acceptable use</H2>
      <P>
        You are responsible for who you invite, what role you grant them, and removing access when
        someone leaves. The product records who did what; it cannot know that a departed advisor
        should no longer have an account.
      </P>
      <UL>
        <li>
          Do not use the service to store data you have no right to hold, or to contact people who
          have not agreed to be contacted.
        </li>
        <li>
          Do not attempt to reach another dealership&rsquo;s data, probe the service for
          vulnerabilities outside the disclosure process on our{' '}
          <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            security page
          </Link>
          , or resell access to the service.
        </li>
        <li>
          Do not present output from the product to a customer as a settled coverage decision. See
          section 4 — that limit is the point of the product, not a disclaimer around the edge of it.
        </li>
      </UL>

      {/* ------------------------------------------------------------ data */}
      <H2>3. Your data stays yours</H2>
      <P>
        Everything you or your customers put into {PRODUCT_NAME} — customer records, vehicles,
        service history, declined work, inspection measurements, contracts, consent records — belongs
        to you. We do not acquire ownership of any of it.
      </P>
      <P>
        You grant us a limited licence to host, process, transmit and display that data solely to
        provide the service to you, to support you when you ask, and to keep the service secure and
        working. That licence lasts as long as we hold the data and covers nothing else. In
        particular:
      </P>
      <UL>
        <li>We do not sell it or share it for advertising.</li>
        <li>
          We do not use it to train machine-learning models. Our AI provider&rsquo;s API terms say
          the same — see{' '}
          <Link href="/responsible-ai" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            Responsible AI
          </Link>
          .
        </li>
        <li>We do not use one dealership&rsquo;s data to serve another.</li>
      </UL>
      <P>
        Your data is yours to take out. Ask and we will export it for you — while the account is
        open, and after it closes too, because a service history is the dealership&rsquo;s asset and
        holding it hostage would be an unpleasant way to run a business. Today that is us running
        the export when you ask rather than a self-serve button; the button is on the roadmap, and
        the commitment is not waiting for it.
      </P>
      <P>
        Aggregate, de-identified information about how the service is used — how often a screen is
        opened, how long a job takes — may be used to improve the product. Nothing in it identifies
        a dealership, a customer or a vehicle.
      </P>

      {/* --------------------------------------------------------- product */}
      <H2>4. What the product claims, and what it does not</H2>
      <P>
        These three limits are on the front page of this site for the same reason they are here.
        They are how the product is designed, not language added afterwards to cover it.
      </P>

      <Term label="We advise. The administrator adjudicates.">
        Service contract terms are contracts, and they vary. Every coverage answer carries a
        confidence level and routes prior-authorisation claims to the administrator before teardown.
        We will never tell an advisor something is covered as though it were settled — and you must
        not present it to a customer that way.
      </Term>
      <Term label="Recalls are shown as candidates, not certainties.">
        There is no public VIN-level open-recall feed. NHTSA publishes by make, model and year,
        without remedy status. Campaigns are surfaced to verify in the OEM portal rather than
        presented as confirmed open recalls.
      </Term>
      <Term label="Your DMS is the system of record.">
        {PRODUCT_NAME} is an intelligence layer beside your DMS, not a replacement for it. The
        repair order, the parts, the accounting and the invoice live there. Where the two disagree,
        the DMS is right.
      </Term>

      <P>
        Warranty terms in the product are reference data and vary by model and model year. Wear
        projections are predictions from prior measurements, not guarantees. Prices resolve from your
        own op-code price book, and where no op code matches, the product shows &ldquo;price to be
        confirmed&rdquo; rather than an estimate — because quoting a number your DMS will not charge
        is the problem this product exists to prevent.
      </P>
      <P>
        A customer&rsquo;s recorded preference is a record of what they want. It is not an
        authorization to perform work. Authorization remains your responsibility and is governed by
        the law of your state.
      </P>

      {/* -------------------------------------------------------- billing */}
      <H2>5. Fees, billing and what happens when a payment fails</H2>
      <P>
        This section describes what the software actually does. It is more specific than a billing
        section usually is, because the behaviour is more favourable than a billing section usually
        is and a promise nobody can check is not worth making.
      </P>

      <H3>What you pay for</H3>
      <P>
        Subscriptions are billed <strong className="text-[var(--ink)]">per rooftop, per month</strong>,
        in US dollars, in advance. Seats are unlimited — you are never charged for adding an advisor,
        a technician or a BDC agent, because a tool nobody can afford to give the whole department is
        a tool that does not change the department.
      </P>
      <P>
        Pricing is volume-tiered by the number of rooftops on the subscription, and the tier applies
        to <em>every</em> rooftop rather than only the ones above the threshold. One consequence is
        worth stating plainly because it surprises people in both directions: crossing into a larger
        tier can lower your total bill while adding a store, and removing a store can raise it. The
        price in force is the one shown at checkout and on your order.
      </P>
      <P>
        Prices are exclusive of any sales, use or similar taxes. Where such taxes apply, they are
        your responsibility.
      </P>

      <H3>Trials</H3>
      <P>
        New accounts start on a free trial — thirty days by default — with no card required and no
        reduced functionality. A trial is the product working, not a demonstration of it. Near the
        end, managers see a notice; advisors do not, because a countdown about money on an
        advisor&rsquo;s screen helps nobody.
      </P>
      <P>
        When a trial ends without a subscription, the account stops. Your data is not deleted and is
        waiting when you come back.
      </P>

      <H3>Payment</H3>
      <P>
        Card payments are handled entirely by Stripe on Stripe&rsquo;s own hosted pages. No card
        details are entered into, transmitted through, or stored by {PRODUCT_NAME}. Updating a card,
        downloading invoices and cancelling all happen in Stripe&rsquo;s billing portal.
      </P>
      <P>
        Dealer groups that cannot pay by card can be invoiced instead, on net 30, 45 or 60 day
        terms, with a purchase order number carried on every invoice. Invoiced accounts run the same
        lifecycle below.
      </P>

      <H3>Adding or removing rooftops mid-month</H3>
      <P>
        Changes take effect immediately and are prorated onto your{' '}
        <strong className="text-[var(--ink)]">next invoice</strong> rather than charged to your card
        on the day. A reduction produces a credit against the next invoice, not a cash refund. Any
        figure the product shows you before you confirm a change is an estimate of what Stripe will
        calculate; Stripe&rsquo;s invoice is the amount owed.
      </P>

      <H3>When a payment fails</H3>
      <P>
        The governing rule in the code is that a billing problem must never break the drive. What
        that means in practice, in order:
      </P>
      <UL>
        <li>
          <strong className="text-[var(--ink)]">Fourteen days, nothing lost.</strong> A failed
          payment changes nothing about what your team can do. Managers see a notice; advisors do
          not.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Then the admin screens pause.</strong> Inviting and
          managing staff, exporting data, changing integrations and adding a rooftop stop. Writing
          up cars, presenting menus and every customer-facing screen keep working.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Suspension is a human decision.</strong> No webhook
          and no scheduled job can suspend an account. A named person at DealerTech has to do it,
          from the restricted state, with a reason recorded. A suspended account is readable; new
          work cannot be saved.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Paying fixes it immediately.</strong> A recovered
          payment restores full access from any of those states.
        </li>
      </UL>
      <P>
        We can also disable an account for a serious breach of section 2 — that is a separate matter
        from non-payment and is not on this ladder.
      </P>

      <H3>Cancelling</H3>
      <P>
        You can cancel at any time. Cancellation takes effect at the end of the period you have
        already paid for, and there is deliberately no option to make it immediate: cutting a
        dealership off on the day they cancel would be charging for time not delivered. No further
        period is billed, and you keep everything until the one you have paid for ends. (On
        invoiced terms, the invoice for that final period may still be outstanding and remains
        payable.)
      </P>
      <P>
        Fees already paid are not refunded, and we do not prorate a refund on cancellation. What you
        get instead is the rest of the period you paid for, in full.
      </P>
      <P>
        After the subscription ends, the product keeps working for a further thirty days so nothing
        is lost in a handover. After that the account closes — and you can still get your data out,
        because the records are yours.
      </P>
      <P>
        A cancellation can be reversed while it is still scheduled. Once Stripe has actually ended
        the subscription it cannot be resumed; coming back means starting a new one.
      </P>

      {/* ------------------------------------------------------ safeguards */}
      <H2>6. GLBA Safeguards Rule — our commitment as a service provider</H2>
      <P>
        Franchise dealerships are covered financial institutions under the FTC Safeguards Rule, which
        requires you to obtain a written commitment from service providers that handle customer
        information. We give it here, and we will sign yours.
      </P>
      <UL>
        <li>
          We implement and maintain administrative, technical and physical safeguards appropriate to
          the sensitivity of the customer information we process on your behalf. What those
          safeguards actually are is described in specifics on the{' '}
          <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            security page
          </Link>
          , rather than asserted as adjectives here.
        </li>
        <li>
          We will notify you without undue delay of any security event we determine has affected
          your customer information, with what we know and what we are doing about it.
        </li>
        <li>
          We will execute your service-provider addendum or written safeguards agreement on request.
          Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
          .
        </li>
        <li>
          We do not use or disclose your customer information for any purpose other than providing
          the service to you.
        </li>
      </UL>
      <Callout>
        We hold no security certification — no SOC 2, no ISO 27001. We say so on every page that
        touches the subject rather than leaving it to be discovered during procurement. See{' '}
        <Link href="/compliance" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          compliance
        </Link>
        .
      </Callout>

      {/* ------------------------------------------------------- warranty */}
      <H2>7. Warranty disclaimer</H2>
      <P>
        We will provide the service with reasonable skill and care, and we will tell you when
        something is broken rather than hoping you do not notice.
      </P>
      <P>
        Beyond that, the service is provided &ldquo;as is&rdquo;. We do not warrant that it will be
        uninterrupted or error-free, that reference data such as warranty terms or recall campaigns
        is complete or current, that a coverage determination will match what an administrator
        ultimately pays, or that a wear projection will prove accurate. To the fullest extent
        permitted by law we disclaim all other warranties, express or implied, including
        merchantability, fitness for a particular purpose and non-infringement.
      </P>
      <P>
        Decisions about what work to perform, what to charge for it, and what to tell a customer
        remain yours.
      </P>

      {/* ------------------------------------------------------- liability */}
      <H2>8. Limitation of liability</H2>
      <P>
        Neither party is liable to the other for indirect, incidental, special, consequential or
        punitive damages, or for lost profits, lost revenue or lost goodwill, even if told such
        damages were possible.
      </P>
      <P>
        Our total liability arising out of or relating to the service is limited to the fees you
        paid us in the twelve months before the event giving rise to the claim.
      </P>
      <P>
        This does not limit liability that cannot be limited by law, and it does not limit either
        party&rsquo;s liability for fraud or wilful misconduct.
      </P>
      <P>
        The proportion here is deliberate: we are a small vendor charging a monthly subscription, and
        a cap tied to what you paid is the honest ceiling. A dealership needing more than that should
        say so before signing rather than discover it afterwards.
      </P>

      {/* ------------------------------------------------------------ misc */}
      <H2>9. Term, changes and notices</H2>
      <P>
        These terms apply while your account is open. Where we change them materially, we will tell
        account holders directly and update the date at the top of this page; continuing to use the
        service after that is acceptance. Sections 3, 7, 8 and 10 survive the end of the agreement.
      </P>
      <P>
        Notices to us go to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . Notices to you go to the email addresses on your account.
      </P>

      <H2>10. Governing law</H2>
      <P>
        These terms are governed by the laws of {GOVERNING_LAW_TEXT}, without regard to its conflict
        of laws rules, and the parties submit to the exclusive jurisdiction of the courts located
        there.
      </P>

      <H2>11. Everything else</H2>
      <UL>
        <li>
          Neither party may assign this agreement without the other&rsquo;s consent, except as part
          of a merger or sale of substantially all of its business.
        </li>
        <li>
          If a provision is unenforceable, the rest stands and that provision is read as narrowly as
          needed to make it enforceable.
        </li>
        <li>
          Not exercising a right does not waive it.
        </li>
        <li>
          Neither party is liable for delays caused by events outside its reasonable control.
        </li>
        <li>
          These terms, together with the{' '}
          <Link href="/legal/privacy" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            privacy policy
          </Link>{' '}
          and any signed order form or addendum, are the whole agreement about their subject.
        </li>
      </UL>

      <DraftNotice />
    </TrustPage>
  )
}
