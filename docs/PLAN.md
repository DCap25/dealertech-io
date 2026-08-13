# DealerTech.io — Build Plan

**Product:** A service-lane intelligence CRM for automotive dealership service advisors.

**Thesis:** *Bring variable-ops discipline to fixed ops.* The sales side runs a machine — every up logged, every deal desked, a full F&I menu presented to every customer regardless of what the manager assumes they'll buy, and a CRM-enforced follow-up cadence lasting years. The service drive has almost none of it. Three specific failures follow from that:

1. **The advisor doesn't know what the customer already owns.** The store sold the VSC at delivery, earned the reserve, and then never carried it forward into service — so it eats goodwill on a repair the contract would have paid.
2. **There is no follow-up after the visit.** Not at 7 days, not at 6 months, not at 3 years.
3. **Advisors pre-qualify.** "This guy won't buy tires." A competent F&I manager presents 100% of products to 100% of customers. The product should make skipping the presentation harder than doing it.

The advisor doesn't need another place to type. They need to walk up to every customer already knowing *who pays* and *what to sell next*.

**Decisions locked:**
| | |
|---|---|
| Business model | Multi-tenant SaaS sold to dealerships |
| Data strategy | Standalone + import, DMS adapter interface designed from day one |
| Scope | Appointments + coverage arbitration + opportunity engine. DMS keeps the RO, parts, invoicing, accounting. |
| Stack | Next.js (App Router) + TypeScript + Postgres/Supabase |
| Contract ingestion | Manual templates **+** CSV deal-jacket import **+** AI PDF extraction |
| Customer comms | Prompt-only at launch; consent schema in place for phase 2 |
| Surfaces | Podium (desktop, dense) and Drive (tablet, touch) as equal citizens |
| Build order | Schema → coverage engine → app → marketing |

---

## 1. Domain model — shared vocabulary

Terms used throughout this document and in the code. Names in the schema match these exactly.

**Roles.** *Service Advisor* (writer/consultant) — writes the RO, sells, communicates, delivers. *BDC* — books appointments, works missed-maintenance and recall lists. *Dispatcher/Foreman* — assigns work. *Technician* — flat-rate, paid book hours, performs the MPI. *Warranty Administrator* — submits and defends OEM claims. *Fixed Ops Director / Service Manager* — owns the numbers.

**Pay types.** Every line on every RO is **CP** (Customer Pay), **W** (Warranty — OEM reimburses), or **I** (Internal — the dealership eats it). Routing a line to the wrong pay type is the most common and most expensive mistake in the drive.

**The numbers advisors are measured on.** HPRO (hours per RO), dollars per RO, CP labor gross (~70–75% GP), CP parts gross (~38–42% GP), ELR (effective labor rate), ASR penetration (additional service requested), MPI completion rate, CSI/SSI survey scores, comeback rate. A typical advisor writes 12–18 ROs/day.

**Coverage products.**
- **OEM factory warranty** — basic (commonly 3yr/36k), powertrain (5yr/60k), corrosion, **federal emissions (8yr/80k on catalytic converter and ECM)**, **hybrid/EV battery (8yr/100k federal, 10yr/150k in CARB states)**, CPO extensions. The emissions and hybrid terms are routinely missed by advisors — pure found money and a CSI save.
- **VSC** — Vehicle Service Contract, the "extended warranty." Sold by OEMs (Ford ESP, GM Protection Plan, Mopar Vehicle Protection, Honda Care, Toyota Extra Care) and third-party admins (Zurich, JM&A, Ally, Fidelity, Assurant, Endurance, Portfolio, CNA, Safeguard). Has a term/mileage, a deductible (per-visit or per-repair — a meaningful difference), a coverage tier, and a **claim procedure that usually requires prior authorization before teardown**.
- **PPM/PPP** — Prepaid Maintenance. N prepaid oil changes and rotations, or a term. **Use-it-or-lose-it, which makes it the cheapest lever in the business for forcing a visit.**
- **Tire & Wheel** — road-hazard protection. Usually requires remaining tread above a threshold (often 3/32) to qualify.
- **Others** — key replacement, dent/PDR, windshield, appearance/paint & fabric, theft/etch. GAP exists on the deal jacket but is finance-side, not service.

**Recalls & campaigns.** Safety recalls, emissions recalls, customer satisfaction programs, and TSBs. Recalls are OEM-paid — free hours plus a captive customer. **Goodwill / policy adjustment** is partial OEM assistance just outside warranty, requested case-by-case.

**MPI** — the Multi-Point Inspection. The tech grades items green/yellow/red and records measurements: tread depth in 32nds per corner, brake pad thickness in mm per corner, battery state of health, fluid condition, alignment. **The MPI is the single richest data source in the department and almost nobody mines it across visits.**

---

## 2. Where the money actually leaks

This is the product. Every feature traces back to one of these.

| # | Leak | Why it happens | What we do |
|---|---|---|---|
| 1 | **Declined services never followed up** | Advisor quotes $1,200 in brakes, customer says "not today," and it's never seen again | Persist every decline, re-price it, resurface it on the next prep sheet and in a worklist |
| 2 | **Wrong pay-type routing** | Advisor bills CP for something the VSC or federal emissions warranty covers | Coverage arbitration engine, run before the RO is written |
| 3 | **PPM visits expiring unused** | Nobody tracks the ledger | Redemption ledger + expiry alerts to the BDC |
| 4 | **Factory warranty lapsing with no VSC pitch** | No trigger exists | Fire an upsell opportunity at a configurable threshold before expiry |
| 5 | **Tire/brake sold reactively** | Tread and pad data is captured every visit, then discarded | Wear-rate regression across visits → predicted sell date |
| 6 | **Open recalls not surfaced at booking** | Requires a separate OEM portal lookup | Surface candidate recalls on the prep sheet (see §7 risk 1) |
| 7 | **T&W claims not offered** | Advisor forgets the customer owns it | Coverage stack always visible; low out-of-pocket ranks the opportunity higher |

---

## 3. The Coverage Arbitration Engine — core IP

A pure, I/O-free TypeScript module. No database calls, no network. Takes a snapshot, returns a determination with a reasoning trace. This makes it exhaustively unit-testable, which matters because **it is the product**.

**Input**
```ts
{
  vehicle:   { vin, make, model, modelYear, inServiceDate, currentMileage, isHybridOrEV }
  operation: { opCode, description, componentGroup, laborHours, laborAmount, partsAmount }
  coverage:  { oemWarranty, contracts[], prepaidLedger[], openRecalls[] }
  store:     { laborRate, state, goodwillPolicy }
  history:   { visitCount, lifetimeSpend, lastVisitDate }
}
```

**Waterfall — evaluated in strict order, first match wins**

1. **Open recall or campaign matches this component** → OEM pays 100%, no deductible. Free hours.
2. **Maintenance operation with PPM entitlement remaining** → PPM pays, customer $0. Flag if the plan expires soon.
3. **Tire/wheel damage and T&W is active** → verify remaining tread meets the policy minimum, apply per-tire limit and deductible.
4. **Component within OEM warranty terms** → check basic / powertrain / **emissions 8-80** / **hybrid battery 8-100 or 10-150** against in-service date and mileage. Evaluate every term, not just basic.
5. **VSC covers the component** → resolve tier semantics (**exclusionary** = covered unless expressly listed; **inclusionary** = covered only if expressly listed), confirm term and mileage remaining, attach deductible, admin phone, and **prior-authorization requirement**.
6. **Goodwill candidate** → recently outside warranty, loyal service history, high lifetime value → suggest an OEM goodwill request with a talk track.
7. **Customer pay** → present at menu pricing.

**Output**
```ts
{
  payer: 'OEM_RECALL'|'PPM'|'TIRE_WHEEL'|'OEM_WARRANTY'|'VSC'|'GOODWILL'|'CUSTOMER_PAY'
  customerOutOfPocket, deductible, deductibleType
  requiredActions[]   // e.g. "Call Zurich 800-xxx for prior auth BEFORE teardown"
  confidence: 'HIGH'|'MEDIUM'|'LOW'
  reasoning[]         // every rule evaluated and why it did or didn't fire
  disclaimer          // see §7 risk 2 — the admin adjudicates, we advise
}
```

Every determination is written to `coverage_determinations` along with any advisor override and the eventual actual payer. That table is an audit trail, a source of truth for disputes, and the training signal for tuning the rules.

---

## 4. The Opportunity Engine

Runs nightly for the next 3 days of appointments, and on demand at booking. Produces the **Prep Sheet** — one screen, printable, ready before the customer arrives.

**Generators**
- `DECLINED_SERVICE` — prior declines, re-priced at today's rates
- `MAINTENANCE_DUE` — projected against **mileage at appointment date**, using observed avg miles/day, not last-known odometer
- `WEAR_PREDICTED` — linear regression on tread depth and pad thickness across visits → miles until 4/32 (sell) and 2/32 (legal minimum)
- `RECALL_OPEN` — candidate recalls for the VIN
- `PPM_UNUSED` — entitlements remaining, weighted hard when the plan is near expiry
- `WARRANTY_EXPIRING` — factory warranty inside the threshold → VSC upsell
- `CONTRACT_UPSELL` — no T&W and the vehicle runs low-profile tires; no PPM and the customer pays cash every visit
- `SEASONAL` — regional triggers (battery test before winter, A/C before summer)

**Priority score** — weighted on gross potential, close probability, safety urgency, and customer out-of-pocket. **Low out-of-pocket ranks high**, because a T&W-covered tire at a $0 deductible is the easiest yes on the drive. A 2/32 tread ranks high regardless of dollars, because it's a safety and liability item.

**Prep Sheet layout**
- Customer + vehicle header, service history summary, CSI risk flags (prior comeback, prior low survey)
- **Coverage stack** — visual bars for factory warranty remaining, VSC remaining, PPM visits left, T&W active
- Ranked opportunity list, each with estimated gross, likely payer, customer out-of-pocket, and a talk track
- Total opportunity dollars and total gross at the top

---

## 4b. The Follow-Up Cadence Engine

The direct analog of the variable-ops CRM cadence, which fixed ops almost universally lacks. Rules-based, store-configurable, and it never lets a customer go dark.

**Post-visit cadence** — thank-you / quality check (day 1–3), CSI survey pre-emption (day 3–5, catch a detractor *before* the OEM survey lands), declined-service re-offer (day 7–14, while the quote is fresh), second re-offer at 30–45 days.

**Lifecycle cadence** — next maintenance due, projected from observed miles/day rather than a flat 6 months. PPM expiry warnings at 90/30/7 days. Factory warranty expiring → VSC pitch. VSC expiring → renewal or upgrade. Annual state inspection / emissions where applicable. Seasonal triggers.

**Dormancy recovery** — a *lost soul* list: customers 1, 2, and 3+ service intervals past due. This is the "years after a visit" gap, and it's the closest fixed-ops equivalent to equity mining.

Every rule produces a task with a talk track, an owner (advisor or BDC), a due date, and an outcome that gets logged back. At launch these are worklists and call scripts — no automated messaging (see §7 risk 6). The cadence definitions live in data, so phase 7 flips them to SMS/email without a rewrite.

---

## 5. Data architecture

Postgres via Supabase. **Every tenant-scoped table carries `store_id` and is protected by row-level security** — RLS is the tenant isolation boundary, not application code.

**Tenancy** — `organizations`, `stores` (brand, labor rate, tax, timezone, state), `users`, `user_store_roles` (advisor / bdc / manager / tech / admin)

**People & vehicles** — `customers` (contact, preferred channel, `sms_consent`, `sms_consent_at`, `sms_consent_source`, `email_consent`, `do_not_call`), `vehicles` (VIN, decoded attrs, `in_service_date`, `current_mileage`, `mileage_as_of`, computed `avg_miles_per_day`), `customer_vehicles` (ownership history)

**Coverage** — `contract_products` (admin company, product type, claim phone, claim portal, procedure notes, prior-auth flag), `contracts` (instance: number, term months/miles, expiry date/mileage, deductible + type, tier, status, **`source`** manual|csv|pdf_extract, **`extraction_confidence`**, `verified_by`, `verified_at`, `document_url`), `contract_coverage_items` (component group, covered, notes — encodes exclusionary vs inclusionary), `prepaid_ledger` (entitlements and redemptions with date/RO/mileage)

**Reference data** — `oem_warranty_terms`, `maintenance_schedules`, `component_groups` (the taxonomy every op code and coverage item maps to), `admin_companies`

> **`oem_warranty_terms` is all-manufacturer and carries an `applies_to_first_owner_only` flag.** Some terms are statutory and universal — federal emissions 8yr/80k, hybrid/EV battery 8yr/100k (10yr/150k in CARB states). Basic and powertrain vary by brand and model-year range, and several brands have traps advisors get wrong constantly:
> - **Hyundai / Kia / Genesis 10yr/100k powertrain is *original owner only*** — it drops to 5yr/60k for a second owner. Miss this and you either eat a repair or wrongly bill a customer.
> - **Chrysler lifetime powertrain (2007–2009)** — still live on the road, transfers only under conditions.
> - **BMW / Mercedes / Audi 4yr/50k**, no separate powertrain term.
> - **Tesla 4yr/50k basic with 8yr/100k–150k battery**, varying by model.
>
> Model-year range validity (`effective_from` / `effective_to`) is therefore part of the primary key, not an afterthought.

**Follow-up** — `cadence_rules` (store-configurable trigger + offset + audience + owner + talk track), `cadence_tasks` (instance: customer, vehicle, due date, owner, status, outcome, outcome reason)

**Recalls** — `recalls`, `vehicle_recalls` (status open|completed|unknown, source, last_checked)

**Service activity** — `appointments` (scheduled_at, transport type waiter|loaner|shuttle|dropoff|pickup, concerns, promised time, status), `visits` (RO mirror: ro_number, mileage in, advisor, pay-type totals), `visit_lines` (op code, pay type, labor, parts, tech), `declined_services`

**Inspection** — `inspections`, `inspection_items` (item key, status, **numeric measurement + unit + wheel position**, photo). The numeric measurements are what make wear prediction possible — capturing "yellow" alone is worthless.

**Engine output** — `opportunities`, `opportunity_events` (presented / sold / declined + reason), `coverage_determinations`, `audit_log`

**The DMS adapter seam.** One interface — `pullCustomers`, `pullVehicles`, `pullServiceHistory`, `pullAppointments`, `pushAppointment` — with a `CsvAdapter` as the first implementation. CDK (Fortellis), Reynolds (RCI), and Tekion slot in behind it later with no schema change.

---

## 6. Phases

**Phase 0 — Foundation.** Next.js + TS strict, Supabase project, Drizzle schema + migrations, RLS policies with tests that *prove* cross-tenant reads fail, auth with MFA, seed reference data (OEM warranty terms for the top makes, admin companies, component groups).

**Phase 1 — Coverage engine.** The pure module, the rule waterfall, an extensive fixture suite of real-world scenarios, and a thin internal UI to exercise it. *Milestone: paste a VIN + a concern, get a defensible answer.*

**Phase 2 — Contract ingestion.** Manual entry with per-admin templates. CSV deal-jacket import with column mapping. PDF/photo upload → Claude extraction → **human verification queue** (nothing extracted is trusted until verified).

**Phase 3 — Customers, vehicles, appointments, Prep Sheet.** VIN decode via NHTSA vPIC. Mileage projection. The prep sheet screen, printable.

**Phase 4 — MPI + opportunity engine.** Inspection capture with numeric measurements, wear-rate regression, all opportunity generators, priority scoring.

**Phase 5 — Advisor workspace.** Podium mode (dense, keyboard-driven) and Drive mode (tablet, touch, camera). Manager dashboards: opportunity pipeline, per-advisor close rate, gross captured vs left behind.

**Phase 6 — Marketing site + onboarding + billing.** DealerTech.io public site, self-serve trial, Stripe, tenant provisioning, onboarding import wizard.

**Phase 7 — Comms + DMS adapters.** Twilio SMS with A2P 10DLC and consent enforcement, email campaigns, first real DMS integration.

---

## 7. Risks and honest constraints

**1. There is no free VIN-level open-recall API.** *Verified:* NHTSA vPIC decodes any VIN free and unauthenticated, and `api.nhtsa.gov/recalls/recallsByVehicle` returns recalls free — but **by make/model/year, not by VIN, and with no remedy status.** Whether *this specific car* has an *unremedied* recall lives only with the OEM. → The UI must say "candidate recalls — verify in the OEM portal," never "you have an open recall." Commercial VIN-level feeds exist and can be added later.

**2. We advise; the administrator adjudicates.** VSC terms are contracts and vary enormously between an exclusionary OEM tier and an inclusionary third-party tier. The app must never promise coverage. Every determination carries a confidence level and a disclaimer, and the required-actions list always routes prior-auth-required claims to the admin **before** teardown. This is a liability boundary, not a UX nicety.

**3. Cold start.** Prep sheets need history. A brand-new tenant has none. → The onboarding CSV import of service history **and declined services** isn't a convenience feature, it's the thing that makes day one valuable. Treat it as Phase 6 critical path.

**4a. No design-partner store — the biggest risk in the project.** We are building fixed-ops software with deep variable-ops experience and researched fixed-ops knowledge, but no frontline validation loop. The specific danger is that the *engine* is correct while the *workflow* is wrong — right answers delivered at a moment the advisor can't use them. → Mitigations: (a) make Phase 1's demo good enough to *recruit* a design partner rather than waiting for one; (b) buy 3–5 hours of service-advisor and fixed-ops-director time for interviews early — cheap, and it de-risks the whole workflow; (c) keep the coverage engine independently verifiable against published warranty booklets and sample contracts, which needs no store at all.

**4b. All-manufacturer scope multiplies the reference-data burden.** ~30 brands × model-year ranges of warranty terms, plus per-brand VSC ecosystems. → Tractable because the data is published and stable, and the statutory terms are universal. Sequence it: seed the top 8–10 brands by franchise count first, treat the long tail as data entry, and **make an unknown brand degrade gracefully** — return `confidence: LOW` with a "verify terms" action rather than a wrong answer.

**4. Advisor adoption is the real risk.** They're slammed and already juggling four tabs. If it isn't faster than not using it, it dies. → The prep sheet must be ready before they arrive, load in one screen, and print.

**5. Maintenance schedule data has licensing questions.** OEM schedules as published by Motor/Mitchell are licensed products. → Ship a generic starter schedule and make the store's own menu the source of truth. Every store already has one.

**6. Compliance is not optional.** Dealerships are covered "financial institutions" under the **FTC Safeguards Rule (GLBA)**, and as their service provider we will be asked for a security addendum. Required from Phase 0: encryption in transit and at rest, MFA, least-privilege access, `audit_log` on all PII access, incident response plan, documented vendor oversight. Also: never store SSNs or full card numbers; TCPA/A2P consent columns now even though comms ship later; CAN-SPAM; CCPA/CPRA export and deletion; state RO retention (2–4 years); and never imply dealer service is required to keep a warranty valid (**Magnuson-Moss**).

---

## 8. Answered

- **Background:** 28 years variable ops. Deep on sales/F&I process, lighter on fixed ops — which is the *source* of the product thesis, not a gap in it.
- **Design partner:** none yet. See risk 4a.
- **Manufacturers:** all. See risk 4b.
- **Segment:** franchise first. Factory warranty, recalls, and OEM-backed VSCs are all in play — exactly what makes the coverage engine worth paying for.
- **Infrastructure:** existing Supabase account (also hosts thedashboard.com). **DealerTech gets its own Supabase project** — separate database, separate auth, separate keys. Dealership customer PII falls under the FTC Safeguards Rule, and co-locating it with an unrelated product widens both the blast radius and the audit scope for no benefit.

## 9. Still open

1. Timeline and hours/week.
2. Pricing model — per rooftop, per advisor seat, or usage-based. Needed by Phase 6, not before.

---

*Verified sources: [NHTSA vPIC VIN decode](https://vpic.nhtsa.dot.gov/api/), [NHTSA Recalls API](https://api.nhtsa.gov/recalls/recallsByVehicle), [NHTSA recalls portal](https://www.nhtsa.gov/recalls)*
