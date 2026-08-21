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
import { CONTACT_EMAIL, PRODUCT_NAME } from '@/lib/site/legal'

export const metadata = {
  title: 'Cookie Policy',
  description:
    'At most two functional cookies, none before you sign in, and no analytics or third-party scripts anywhere.',
}

/**
 * Why there is no consent banner.
 *
 * ---------------------------------------------------------------------------
 * THE ARGUMENT, SO NOBODY RE-OPENS IT BY ACCIDENT
 * ---------------------------------------------------------------------------
 * Consent banners exist for non-essential cookies — analytics, advertising,
 * tracking. We set none. An anonymous visitor to this site receives zero
 * cookies; a signed-in user receives at most two strictly-necessary ones,
 * which are exempt from consent in every regime that could plausibly apply to
 * a US dealership vendor.
 *
 * A banner on a site with nothing to consent to is theatre, invites the
 * question "consent to what?", and quietly signals that we track like everyone
 * else. The differentiating move is the opposite: say plainly that there is
 * nothing, and commit that adding anything non-essential means adding real
 * consent first.
 *
 * The tripwire: `src/lib/site/marketing-surface.test.ts` fails if a marketing
 * or trust page starts reaching for anything that can set a cookie or load a
 * third-party script. The moment that test is changed to accommodate an
 * analytics tag, this page is a lie and this decision reopens.
 */

export default function CookiesPage() {
  return (
    <TrustPage
      eyebrow="Legal"
      title="Cookie Policy"
      lede="Short, because there is very little to say."
      updated="cookies"
    >
      <Summary>
        <p>
          Browsing this site sets <strong className="text-[var(--ink)]">no cookies at all</strong>.
          Not one. There is no analytics, no advertising pixel, no tag manager, and no third-party
          script on any page.
        </p>
        <p>
          Signing in sets one strictly necessary cookie: the session that keeps you signed in. A
          second appears only when you pick which rooftop you are working, and it is a preference,
          not a tracker. That is the complete list.
        </p>
        <p>
          Which is why there is no consent banner. There is nothing here to consent to.
        </p>
      </Summary>

      <H2 id="before-you-sign-in">Before you sign in</H2>
      <P>
        Zero cookies. The marketing pages, the coverage demo, and every page you are reading now are
        rendered without setting anything in your browser and without loading anything from another
        company&rsquo;s servers.
      </P>
      <P>
        If you submit the demo-request form, what you typed is sent to us and stored — see the{' '}
        <Link href="/legal/privacy" className="font-semibold text-[var(--ink)] underline underline-offset-4">
          privacy policy
        </Link>
        . That is a form submission, not a cookie; nothing is left behind in your browser and you are
        not followed anywhere.
      </P>

      <H2>After you sign in</H2>
      <P>At most two cookies, named here because a policy that will not name them is not a policy.</P>

      <Term label="The Supabase authentication session">
        Set by our authentication provider when you sign in, and refreshed as you use the product.
        It is what makes the next page know it is still you. Without it there is no way to be signed
        in at all. It is stored so that page scripts cannot read it, and it is cleared when you sign
        out.
      </Term>
      <Term label="dt_active_store">
        Remembers which rooftop you are currently working, for people who hold a role at more than
        one store in a group. It is set when you pick a store — someone who only ever works one
        rooftop may never receive it. It is a preference, never a permission: the value is only ever used to
        pick from the list of dealerships your account provably has a role at, so editing it in your
        browser changes which of <em>your</em> stores you land on and nothing else.
      </Term>

      <Callout>
        Both are strictly necessary — the product cannot function without them — which is the
        category exempt from consent requirements under every privacy regime that applies to us. We
        are not relying on that exemption to sneak anything past it; those two are genuinely the
        whole list.
      </Callout>

      <H2>What we do not use</H2>
      <UL>
        <li>No analytics of any kind — no Google Analytics, no Plausible, no self-hosted equivalent.</li>
        <li>No advertising or conversion pixels, and no remarketing.</li>
        <li>No tag manager.</li>
        <li>No social embeds, chat widgets, or third-party fonts loaded at page view.</li>
        <li>No cross-site tracking, and no fingerprinting as a substitute for cookies.</li>
      </UL>
      <P>
        The demo-request form records which page it was submitted from. That is a hidden field in
        the form itself — no cookie, no script, and it tells us nothing about you before you decide
        to press the button.
      </P>

      <H2>If that ever changes</H2>
      <P>
        Adding any non-essential cookie to {PRODUCT_NAME} means adding real consent first — a
        genuine choice, defaulting to off, that works if you decline it — and rewriting this page in
        the same change. We would rather not have the data than have it dishonestly.
      </P>
      <P>
        You can also block or clear cookies in your browser. Clearing the two above signs you out and
        forgets which rooftop you were on; nothing else in the product depends on them.
      </P>

      <H2>Questions</H2>
      <P>
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-[var(--ink)] underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        .
      </P>

      <DraftNotice />
    </TrustPage>
  )
}
