@AGENTS.md

# DealerTech in one paragraph

A selling tool for service advisors, a CRM second — DealerTech is the
advisor's daily workspace and the scheduling layer; the DMS stays the system
of record. `PROJECT_OVERVIEW.md` is the product map — read it before changing
behaviour. Beyond the original prep-sheet/menu core it now covers: the
scheduling layer (`/drive/week`, `/drive/book`, `/introduce`,
`src/lib/scheduling/` — decisions in `docs/DRIVE_PLAN.md`), the customer
timeline (`src/lib/timeline/`), self-serve tablet mode
(`TABLET_SELF_SERVE`), the Co-Pilot with its floating help launcher and
route-complete app guide (`src/lib/copilot/`), and contract upload with
AI extraction (`src/lib/contract-capture/` — extracted fields are never
trusted until a human confirms them).

Hard rules that never relax: `.env.local` is the production database — a
local write is a live write; migrate with `npm run db:apply`, never
`db:push`; do not push to origin unasked (Netlify build minutes);
customer-facing data is a whitelist; a customer preference is not an
authorization; never quote a price the DMS will not charge.
