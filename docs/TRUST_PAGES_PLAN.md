# Trust, Legal & Footer Pages — Scope

**Status: BUILT AND VERIFIED (2026-08-19) — see §8 for the verification
record. Publishing still waits on the §6 leftovers: the registered address,
the info@ mailbox going live, and the lawyer pass (Q5).**

What has to exist at the bottom of the marketing page, what each page must
say, and — as important — what we should refuse to say. The reference point
Dan asked about is Tekion's trust portal (tekion.com/trust-portal/compliance),
surveyed 2026-08-19; §2 maps their list onto our stage honestly.

The thesis of the whole product is that the transparent dealership wins. The
same bet applies to us: a legal footer that is honest about being an
early-stage vendor — real architecture, real subprocessors, no rented badges —
is worth more with a fixed-ops director than a wall of certification logos we
do not hold. Every page below is scoped to say only things that are true of
the code as it exists, and several of them turn out to be *better* than the
industry boilerplate because of it.

---

## 1. The facts the pages must describe

Established by reading the code, not by assumption. The build must not
contradict any of these; where one changes, the page that states it changes
in the same commit.

- **Two data roles.** For the demo-request form (`demo_requests` — name,
  email, phone, dealership, DMS) we are the **controller**: it is our lead,
  nobody else's. For everything inside the product — dealership customers'
  names, VINs, service history, contracts with signatures on them — we are a
  **service provider / processor** acting for the dealer, who is the
  controller. The privacy policy has to keep these two lanes separate or it
  will promise the wrong things about the wrong data.
- **Dealerships are covered financial institutions** under the FTC Safeguards
  Rule (GLBA). The landing page already says so out loud. That makes us a
  Safeguards *service provider*, which is a contractual posture (we commit to
  safeguards; the dealer is required to obtain that commitment) — not a badge.
  This is the single most load-bearing compliance fact for a US dealership
  vendor and it costs nothing but honesty to state properly.
- **Subprocessors, the complete list:** Supabase (Postgres, auth, private
  document storage), Stripe (billing), Anthropic (AI extraction and Co-Pilot;
  API data is not used for model training), Netlify (hosting). There is no
  fifth. A subprocessor list this short is a selling point; publish it.
- **No cookies for anonymous visitors.** The only cookies in the codebase are
  the Supabase session (set at sign-in, now explicitly httpOnly — see §8) and
  `dt_active_store` (set when a rooftop is picked, so a one-store user may
  never receive it), both strictly functional. The marketing schema states its own rule:
  *"Attribution, captured without cookies or third-party scripts."* No
  analytics, no pixels, no tag manager, no third-party JS anywhere.
- **No SMS** (TCPA, deliberate, v1) — links are copy-and-paste.
- **AI governance is already real:** extracted contract fields land as
  `AI_EXTRACTION` with `verifiedAt` null and are never trusted until a human
  confirms them; the coverage engine degrades confidence on machine-read
  sources and says so on screen; every confirmation is audit-logged with the
  actor. This is a genuine, testable answer to "how do you govern AI use" —
  most vendors our size have a paragraph of adjectives instead.
- **Security architecture worth describing:** RLS FORCEd on every table with
  a deny-by-default route allowlist; bearer credentials (invites, menu links,
  device tokens) 32 random bytes, SHA-256 at rest; customer documents in a
  private bucket behind 10-minute signed URLs; append-only audit log with
  credential redaction; encryption in transit and at rest via Supabase.
- **What we do not have:** SOC 2, ISO anything, a compliance team, or a
  security certification. Any page that implies otherwise is a lie with a
  paper trail.

## 2. Tekion's list, mapped to our stage

Tekion lists SOC 1/2 Type II, ISO 27001/27701/42001, GLBA, GDPR, CPRA, a DPA,
a Modern Slavery statement, and a hosted status page. They are a
multi-thousand-employee DMS vendor; that list is a decade of compliance
budget. Copying its *shape* is right; copying its *claims* would be fatal.

| Tekion has | Our v1 answer |
|---|---|
| SOC 1 / SOC 2 Type II | Not held. Say so, plainly, with one sentence on when it becomes worth pursuing (customer count, not vibes). Do not say "in progress" unless it is. |
| ISO 27001 / 27701 | Not held. The security page describes the actual controls instead — which is what an auditor would check anyway. |
| ISO 42001 (AI governance) | Not held — but the human-confirmation invariant (§1) is a concrete AI-governance practice, stated with the mechanism, not the framework name. |
| GLBA | **Applies now.** Safeguards service-provider commitment, stated on the compliance page and reflected in the terms. |
| GDPR | Does not apply — US dealerships only, no EU offering. One honest sentence, revisited if that changes. |
| CPRA / CCPA | Thresholds almost certainly not met yet ($25M revenue / 100k consumers), but the privacy policy grants the access/deletion rights anyway — cheap for us at this size, and it future-proofs the document. |
| DPA | Worth having as a short document for dealer contracts (processor commitments, subprocessor list, breach notice). v1: a page; countersignable PDF later. |
| Cookie policy + consent manager | **We need no consent banner** — see §4. A short cookies section that says "none until you sign in" beats a banner. |
| Modern Slavery statement | UK statutory requirement for large turnover. Not applicable; skip without comment. |
| status.tekion.com | See the status decision in §3. |

## 2a. What visiting the live page added (Chrome, 2026-08-19)

The first survey was a server-side fetch; a browser visit afterwards caught
three things the fetch flattened, and each one changes the plan slightly.

**Their trust portal is a four-tab hub — and Responsible AI is its own tab.**
Privacy / Security / Compliance / Responsible AI sit as sibling pages under a
parent Trust Portal page. That Responsible AI stands as a peer of Security is
the tell about where dealer procurement questions are heading. Amendment to
P6: give Responsible AI **its own page** (`/responsible-ai`) rather than a
section inside compliance. It is our single best trust story — the
human-confirmation invariant, machine-read suspicion in the coverage engine,
the audit log on every confirmation, no model training on customer data — and
it is all mechanism, not adjectives. Tekion needed ISO 42001 to say it; we
can point at the code.

**Their real footer inventory** (worth mirroring in shape, not content):
four link columns (Company · Resources · trust/legal · Contact), then a
bottom row: © line · Update Privacy Preferences · Terms of Use · Cookie
Policy. The trust/legal column is: Trust Portal, Legal, Privacy Policy,
Security, Compliance, Do Not Sell My Information, Status, Modern Slavery
statement. Amendments to P1: add a **contact block** (the demo email /
founder contact — dealers expect an address in the footer, Q2 covers which);
and where Tekion has "Update Privacy Preferences" (their consent-manager
reopen link), our bottom row carries the no-tracking sentence from §4 — same
slot, honest version. "Do Not Sell My Information" is a CCPA sale/share
opt-out; we do not sell or share data, so the privacy policy says that
plainly instead of a dedicated opt-out page.

**Their FAQ is the dealer-IT questionnaire.** The live page carries the full
list: encryption in transit and at rest (they answer TLS 1.2+, AES-256,
tokenization for payments), disaster recovery and continuity, vendor
monitoring, incident response, employee screening, SDLC and pen-testing, who
audits them. Amendment to P6: our compliance FAQ should answer this exact
question list honestly — Supabase gives us the encryption answers, Stripe the
payment one, and where the honest answer is "we are two people and a test
suite" (employee screening, formal DR drills), say what is actually true
rather than skipping the question. A skipped question on a trust page reads
as a no.

## 3. The pages, one by one

All public → each route must be added to the public prefix list in
`src/lib/auth/routes.ts`, or deny-by-default will bounce visitors to /login.

**P1 — Shared footer component.** The current footer lives only in
`src/app/page.tsx` (product links + the advisory-coverage disclaimer). Extract
to a component used by `/`, `/demo`, `/request-demo`, and every new page below.
Adds a second row: Privacy · Terms · Security · Compliance · Status · Press ·
Legal, plus the one-line cookie sentence (§4) and © line with the legal
entity name (open question Q1).

**P2 — `/legal/privacy` — Privacy Policy.** Two-lane structure per §1: (a)
what we collect as controller (demo requests, account emails) and why; (b)
what we process as the dealer's service provider and that questions about a
dealership's records go to the dealership. Subprocessor list. Retention
honestly stated. CCPA-style rights granted regardless of thresholds. Contact
address (Q2). Plain-language summary up top — the house voice, not the
usual fog.

**P3 — `/legal/terms` — Terms of Service.** B2B only. Must match the code:
the billing lifecycle, proration and cancellation behaviour in
`src/lib/billing/` is the contract's billing section — the terms describe what
the code does, not a generic template. Must carry the three product
disclaimers already on the landing page (coverage advisory, recall candidates,
DMS as system of record) with the same wording. Dealer owns dealership data;
we take a processing licence, not ownership. Governing law is Q3.

**P4 — `/legal/cookies`** — one honest page (see §4). Also linked from the
privacy policy.

**P5 — `/security`.** The architecture from §1, written for a fixed-ops
director and their IT contact: tenancy isolation, credential handling,
document storage, audit log, AI data handling (Anthropic does not train on
API data; extraction is human-confirmed), responsible-disclosure contact
(Q2), and the certifications paragraph that says what we do not hold.

**P6 — `/compliance`** (the Tekion-analogue trust page). The §2 table's
right-hand column as prose: Safeguards service-provider posture front and
centre, TCPA stance, AI governance with the mechanism, subprocessors, and the
not-yet list. Short FAQ like Tekion's, answering only what we can answer
truthfully (encryption, backups, who can see what, where data lives).

**P7 — `/status`.** Decision needed (Q4):
- *(a) Hosted status provider* (BetterStack/Instatus free tiers) — real
  uptime history, incident comms, independent of our own outage. Cost: an
  external service and a subdomain.
- *(b) Self-built `/status` page* — live health check of app + database plus
  links to Supabase/Stripe/Anthropic/Netlify status pages. Free, but it dies
  with the site, which is the one moment a status page earns its keep, and a
  public DB-touching route needs rate-limiting care.
- **Recommendation: (a)** on a free tier, linked as `status.dealertech.io`;
  (b) is theatre precisely when it matters.

**P8 — `/press`.** One page: what DealerTech is in two paragraphs, founder
contact (Q2), logo/wordmark downloads. No "News" section until news exists —
an empty news page ages the product. Fold news in later.

**Explicitly out of scope for this build:** SOC 2 pursuit, a cookie consent
manager, GDPR machinery, a countersignable DPA PDF, a security.txt bounty
programme (a plain `/.well-known/security.txt` pointing at the disclosure
email *is* in scope — it is ten lines).

## 4. The cookie banner question — recommendation: none

Dan asked for "cookies decline or agree etc." The honest answer is that we do
not need one, and adding one would make us look *worse*:

- Consent banners are required (ePrivacy/GDPR; CCPA for sale/share) for
  non-essential cookies — analytics, advertising, tracking. We set none.
  Anonymous visitors to the marketing page receive **zero cookies**; signed-in
  users receive two strictly-necessary ones, which are exempt from consent in
  every regime that could plausibly apply to us.
- A banner on a site with no trackable cookies is compliance theatre, invites
  the question "consent to what?", and quietly signals we track like everyone
  else.
- The differentiating move is the opposite: a footer line — *"No tracking, no
  analytics, no cookies until you sign in"* — linking to P4, which explains
  the two functional cookies and commits that adding any non-essential cookie
  means adding real consent first.
- **The tripwire:** the moment anyone adds analytics, this decision reopens.
  The build should pin the claim with a test asserting the marketing page's
  rendered response sets no cookies, so the page cannot silently start lying.

## 5. Notes for the Opus build brief (when Dan approves)

- **routes.ts:** every new route into the public prefix list, with the
  house-style comment on why each is public. Check `routes.test.ts` patterns.
- **Copilot completeness test:** `src/lib/copilot/` has a test that walks the
  route tree so new pages fail the suite until the app guide learns them —
  determine whether it covers public marketing routes, and either teach the
  guide or (if workspace-only) confirm these routes are exempt.
- **Content as code:** static TSX in the existing marketing idiom (Section /
  Eyebrow / H2 / Lede components in page.tsx — consider extracting them too).
  No CMS, no MDX dependency, no new packages.
- **Terms/billing fidelity:** the terms' billing section must be written by
  reading `src/lib/billing/` (lifecycle states, proration, cancellation), not
  from a template.
- **Drafts are drafts:** privacy and terms pages ship with a visible
  "last updated" date, and Dan should have a lawyer read both before real
  contracts hang off them (Q5). The pages are the honest starting text, not
  legal advice.
- **The no-cookie test** from §4.
- **security.txt** under `/.well-known/`, pointing at the Q2 address.

## 6. Decisions (Dan, 2026-08-19) and what remains

- **Q1 — Legal entity: The DAS Board LLC.** Dan's existing LLC, which owns
  the variable-ops product The DAS Board (thedasboard.com,
  E:\WebProjects\dasboard — © line found in its DashboardLayout). DealerTech
  operates as a product of that LLC; whether a DBA filing is needed for
  "DealerTech.io" on contracts is a **lawyer question**, flagged. Registered
  address: still needed from Dan or the lawyer before publishing.
- **Q2 — Contact: info@dealertech.io**, being created. All pages use it
  (privacy, security disclosure, press) until role addresses exist. Matches
  the sibling site's info@thedasboard.com pattern.
- **Q3 — Governing law: unresolved.** The build writes around it ("the state
  in which The DAS Board LLC is organized") and keeps entity, address, email
  and governing state in **one constants file** so the lawyer pass is a
  one-file edit.
- **Q4 — Status: build the minimal static page now** (links to Netlify,
  Supabase, Stripe and Anthropic status pages, honest sentence about being
  early); hosted provider remains the recommended upgrade when there are
  customers to notify.
- **Q5 — Lawyer review: yes, before the first customer.** Decided. Pages
  carry a visible "last updated" date; the drafts are the honest starting
  text, not legal advice.
- **Q6 — SOC 2: silence** beyond "when customer count warrants it" (default
  taken; no timeline named).

## 7. The DAS Board tie-in

Dan has two products under one LLC: The DAS Board (variable ops — sales,
F&I, payroll, deals) and DealerTech (fixed ops — the service drive). The
question is whether to build a parent site like Tekion's, an umbrella like
dlr360.com (one brand, product family, one light footer), or something
smaller.

- *(a) Parent marketing site* — a third property presenting both products.
  Real cost: a domain, a brand, content, and upkeep for a company of one.
  Tekion's shape, without Tekion's staff.
- *(b) Family treatment on both existing sites* — footer line "DealerTech.io
  is a product of The DAS Board LLC", a small cross-link ("Also from The DAS
  Board LLC: variable-ops management at thedasboard.com"), mirrored on the
  sibling site. One legal entity, two storefronts — which is also dlr360's
  actual footer weight (terms, privacy, one info@ address).
- *(c) Fold both under one domain* — a rebrand, out of scope.

**Recommendation: (b) now, (a) only when both products have customers and a
name worth umbrella-ing.** The legal build is unblocked either way — every
document hangs off The DAS Board LLC regardless — so (b)'s footer line ships
with this build and the parent-site question can wait without cost. One
follow-on worth noting: The DAS Board's own legal pages
(src/pages/legal in that repo) should eventually agree with these on entity
name, subprocessors and tone — a later pass, in that repo.

## 8. Verification record (2026-08-19)

Opus built the nine pages per §3–§5; the build was then verified
adversarially — three lanes, each instructed to contradict the pages rather
than confirm them — before anything was committed. The rule being enforced:
every sentence on these pages is a claim about the code, so either the
sentence changes or the code does. Both happened.

**Where the pages were wrong, and which way each fix went:**

- **"Session cookies that page scripts cannot read" was false** —
  `@supabase/ssr` defaults to `httpOnly: false` and nothing overrode it. The
  *code* changed: both `createServerClient` sites now set
  `httpOnly: true` explicitly (safe here — there is no browser client), and
  the sentence went back on the security and cookie pages once it was true.
- **The data-export promise had no feature behind it.** The access policy
  permits export after closure; nothing implements it. The *pages* changed:
  export is "we run it for you on request", with the self-serve button named
  as roadmap. Building it stays on the list.
- **"New work cannot be saved" when suspended was a banner nothing enforced.**
  The *code* changed: `checkWork()` in session.ts now guards seventeen drive
  write actions, `MANAGE_STAFF` guards all three roster mutations (restore
  included — it was the bypass), and the customer menu link refuses as a
  closed list rather than leaking the dealership's billing state to their
  customer. Three teardown actions are deliberately unguarded (take back a
  menu, discard an upload, unpair a device): revoking access and clearing
  drafts must never be hostage to an invoice. ADD_STORE and EXPORT_DATA have
  no tenant-facing call sites to guard; the reasoning is written at
  `createStore`. Found along the way and fixed: a trial-expired store used to
  read "This account is suspended" — refusals now derive from the banner so
  the two cannot disagree.
- **"You will be billed once more" on cancellation** was wrong on the card
  rail (advance billing; `cancel_at_period_end` invoices nothing further).
  Reworded, with the invoice-rail caveat kept.
- **Smaller wording corrections:** audit log "cannot be deleted including by
  us" softened to the policy-level truth on three pages (the privileged
  connection exists and the pages must not pretend otherwise); NHTSA named as
  a fifth external party on the security page (VINs go there; a complete list
  is only worth having if it is complete); tablet pairing code described as
  the ten-minute claim ticket it is rather than folded into "32 bytes,
  hashed"; cookie timing corrected (session at sign-in, store cookie on
  pick); "homepage or the demo" attribution trimmed (the form exists only on
  the homepage); staff-access wording pinned to what is actually audited
  (grants and revocations, not each read); noindex headers extended to the
  workspace surfaces netlify.toml missed, plus robots.txt.
- **The tripwire test got its blind spots closed:** the marketing-surface
  test now scans the root layout and globals.css, and its own comments say
  what it still cannot see.

**Operational note for whoever suspends an account:** `closeRepairOrder` is a
write, so suspending a dealership mid-day leaves open ROs unclosable until
payment recovers. Suspend after close of business. Documented at the guard.

**Still open before real contracts hang off these pages:** registered
address (Q1), the info@dealertech.io mailbox actually existing (Q2),
governing state (Q3), the lawyer pass (Q5) — all one-file edits in
`src/lib/site/legal.ts` when they land. Roadmap debts the pages now name:
self-serve data export, hosted status provider when there are customers to
notify, a rehearsed restore behind the DR answer.
