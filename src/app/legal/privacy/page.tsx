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
import { CONTACT_EMAIL, LEGAL_ENTITY, PRODUCT_NAME, SUBPROCESSORS } from '@/lib/site/legal'

export const metadata = {
  title: 'Privacy Policy',
  description:
    'What DealerTech.io collects as a business, what it processes on a dealership’s behalf, and who to ask about which.',
}

/**
 * The two-lane policy.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STRUCTURE IS THE WHOLE POINT
 * ---------------------------------------------------------------------------
 * This product sits either side of a line that most privacy policies blur, and
 * blurring it here would promise the wrong things about the wrong data.
 *
 * Lane one: a demo request. That is our lead, nobody else's — we are the
 * controller, we decided to collect it, and a person who filled that form in
 * asks us directly to see or delete it.
 *
 * Lane two: everything inside the product — a dealership's customers, their
 * VINs, their service history, a service contract with a signature on it. None
 * of that is ours. The dealership decided to put it here; we hold it on their
 * instruction. A customer asking us to delete their record is asking the wrong
 * company, and the honest answer is to send them to the store.
 *
 * Every claim about what is collected below is checked against
 * `src/db/schema/marketing.ts` and `src/app/request-demo/actions.ts`. The
 * `referrer` column exists in that table and is never written by any code path,
 * so it is deliberately not listed here — the page describes what the software
 * does, not what the schema could hold.
 */

export default function PrivacyPage() {
  return (
    <TrustPage
      eyebrow="Legal"
      title="Privacy Policy"
      lede={`How ${LEGAL_ENTITY} handles personal information in ${PRODUCT_NAME}.`}
      updated="privacy"
    >
      <Summary>
        <p>
          There are two kinds of personal information here and they are not treated the same.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Yours, if you contacted us.</strong> Name, email,
          phone, dealership. We use it to reply to you and nothing else. We do not sell it, share it
          for advertising, or send it anywhere except the four vendors listed below. Ask and we will
          show you what we hold or delete it.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Your dealership&rsquo;s customers&rsquo;.</strong>{' '}
          That belongs to the dealership, not to us. We hold it for them, under their instruction,
          and we do not use it for our own purposes. If you are a vehicle owner asking about your
          record, the dealership is the company to ask — we will help them answer, but the answer is
          theirs to give.
        </p>
        <p>
          And before you sign in, this site sets no cookies at all. There are no analytics, no
          pixels, and no third-party scripts on any page.
        </p>
      </Summary>

      <P>
        This summary is written to be read. The sections below are the actual policy, and where they
        differ from the summary, they govern.
      </P>

      {/* ------------------------------------------------------------ roles */}
      <H2>1. Two roles, and which one applies to you</H2>
      <P>
        {LEGAL_ENTITY} operates {PRODUCT_NAME}. Depending on the data, we act in one of two
        capacities, and the difference decides who you ask about what.
      </P>

      <Term label="We are the business (controller) for our own contacts">
        When you fill in the demo-request form on this site, or hold an account with us, we decided
        to collect that information and we decide what it is for. Requests about it come to us.
      </Term>
      <Term label="We are a service provider (processor) for everything in the product">
        Customer names, contact details, VINs, service history, declined work, inspection
        measurements, uploaded service contracts, consent records — the dealership put those there
        and the dealership decides what happens to them. We act on their instruction, under their
        agreement with us. We do not sell that data, use it to build our own products, or use it for
        any purpose other than providing the service to that dealership.
      </Term>

      {/* -------------------------------------------------------- our own */}
      <H2>2. What we collect as a business</H2>

      <H3>Demo requests</H3>
      <P>
        The form on this site asks for, and stores, exactly these: your name, your email address,
        your phone number, your dealership&rsquo;s name, your role, how many rooftops the group has,
        which DMS you run, and whatever you type in the message box. It also records which page the
        form was submitted from. All of it except name, email and dealership is optional.
      </P>
      <P>
        We use it to reply to you, to prepare a walkthrough that is about your store rather than a
        generic one, and to keep track of whether we have already got back to you — including any
        note we make about that conversation. That is the whole list.
      </P>

      <H3>Accounts</H3>
      <P>
        A user account holds an email address, a name, the dealership and role that account was
        granted, and the sign-in records our authentication provider keeps. We use it to sign you in
        and to attribute actions in the product to the person who took them — which is a
        deliberate feature, not a side effect: the audit log records who confirmed what, and that is
        the record a dealership relies on when a coverage answer is later disputed.
      </P>

      <H3>What we do not collect</H3>
      <UL>
        <li>
          No analytics, no advertising identifiers, no cross-site tracking, no fingerprinting. There
          are no third-party scripts on this site.
        </li>
        <li>
          No cookies before you sign in. See the{' '}
          <Link href="/legal/cookies" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            cookie policy
          </Link>
          , which is short.
        </li>
        <li>
          No card numbers. Payment details are entered on Stripe&rsquo;s own hosted pages and never
          touch our application.
        </li>
        <li>
          No SMS. We do not send text messages — customer links are copied and pasted by a person.
        </li>
      </UL>

      {/* ------------------------------------------------------ dealership */}
      <H2>3. Data we hold for a dealership</H2>
      <P>
        A dealership using {PRODUCT_NAME} puts customer records into it: names and contact details,
        vehicles and VINs, service history, work that was quoted and declined, inspection
        measurements, prepaid maintenance and service contracts (including uploaded copies of the
        contract document itself, which can carry a signature), appointment history, and consent
        records showing what a customer agreed to and when.
      </P>
      <P>
        That data is the dealership&rsquo;s. We hold it to run the product for them and for no other
        reason. Concretely, that means:
      </P>
      <UL>
        <li>We do not sell it, and we do not share it for advertising.</li>
        <li>We do not use it to train machine-learning models — ours or anyone else&rsquo;s.</li>
        <li>
          We do not use one dealership&rsquo;s data to serve another. Isolation is enforced in the
          database rather than in queries; see the{' '}
          <Link href="/security" className="font-semibold text-[var(--ink)] underline underline-offset-4">
            security page
          </Link>
          .
        </li>
        <li>
          Our staff access it only to operate and support the service, and granting that access is
          itself written to the audit log, when it starts and when it ends.
        </li>
      </UL>

      <Callout>
        <strong className="text-[var(--ink)]">
          If you are a vehicle owner and this is about your record:
        </strong>{' '}
        contact the dealership you visited. They control that data and they are the ones who can
        change or delete it. If they need us to act, they tell us and we do. Writing to us first is
        not wrong — we will point you at the store and let them know you asked.
      </Callout>

      {/* ---------------------------------------------------- subprocessors */}
      <H2>4. Who else touches it</H2>
      <P>
        The complete list of subprocessors. There is no fifth, and adding one means updating this
        page in the same change.
      </P>
      <div className="mt-2">
        {SUBPROCESSORS.map((s) => (
          <Term key={s.name} label={s.name}>
            {s.purpose}
          </Term>
        ))}
      </div>
      <P>
        Data is hosted in the United States. We do not offer the product outside the United States
        and do not transfer dealership data abroad.
      </P>
      <P>
        We may also disclose information where the law requires it — a subpoena, a court order — or
        to establish or defend a legal claim. Where a demand covers a dealership&rsquo;s data and we
        are permitted to tell them, we will.
      </P>

      {/* -------------------------------------------------------- retention */}
      <H2>5. How long we keep things</H2>
      <P>
        Stated as what the software actually does, which is less tidy than a table of retention
        periods and more honest than inventing one.
      </P>
      <Term label="Demo requests">
        Kept while they are useful as a business record, and deleted on request. There is no
        automatic expiry.
      </Term>
      <Term label="Dealership data">
        Kept for as long as the dealership&rsquo;s account is active, because deleting a service
        history is deleting the product. When an account ends, the data remains available to the
        dealership — the billing state that closes an account deliberately keeps export permitted,
        and we will export it for them on request — and we delete it on the dealership&rsquo;s
        verified instruction.
      </Term>
      <Term label="Audit records">
        The audit log is append-only by design: no update or delete policy exists on it, and the
        product contains no code path that edits an entry. That is what makes it worth having.
        Credentials and tokens are redacted before anything is written to it.
      </Term>
      <Callout>
        We are not going to claim automated retention schedules we have not built. Where deletion
        happens on request rather than on a timer, this page says so. If your dealership needs a
        contractual retention period, ask and we will agree one in writing.
      </Callout>

      {/* ----------------------------------------------------------- rights */}
      <H2>6. Your rights</H2>
      <P>
        California&rsquo;s privacy law applies above revenue and volume thresholds that we do not
        currently meet. We grant these rights anyway, to everyone, because at our size it costs
        nothing but the willingness to answer an email — and a policy that only works once we are
        big enough to be forced is not a policy.
      </P>
      <UL>
        <li>
          <strong className="text-[var(--ink)]">Know.</strong> What we hold about you, where it came
          from, and who we disclosed it to.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Access.</strong> A copy of it.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Correct.</strong> Fix anything wrong.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Delete.</strong> Remove it, unless we are required
          to keep it.
        </li>
        <li>
          <strong className="text-[var(--ink)]">Non-retaliation.</strong> Exercising any of these
          changes nothing about the service you get.
        </li>
      </UL>
      <P>
        <strong className="text-[var(--ink)]">
          We do not sell personal information, and we do not share it for cross-context behavioural
          advertising.
        </strong>{' '}
        Not as a policy choice we could quietly reverse — there is no advertising technology on this
        site to do it with. That is why there is no &ldquo;Do Not Sell My Information&rdquo; link
        anywhere on it: the honest version of that page is this sentence.
      </P>
      <P>
        To exercise any of these, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . We will verify that you are who you say you are before acting — for an account, by the
        email address on it. Requests about a dealership&rsquo;s customer records go to the
        dealership, as described in section 3.
      </P>

      {/* ------------------------------------------------------------ misc */}
      <H2>7. Children</H2>
      <P>
        {PRODUCT_NAME} is a tool for dealership staff. It is not directed at children and we do not
        knowingly collect information from anyone under 16. If a dealership has loaded such a record
        and tells us, we will help them remove it.
      </P>

      <H2>8. Changes to this policy</H2>
      <P>
        When this changes, the &ldquo;last updated&rdquo; date at the top changes with it. Where a
        change materially affects a dealership under contract, we tell them directly rather than
        relying on them re-reading a page.
      </P>

      <H2>9. Contact</H2>
      <P>
        {LEGAL_ENTITY}, operator of {PRODUCT_NAME} —{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        .
      </P>

      <DraftNotice />
    </TrustPage>
  )
}
