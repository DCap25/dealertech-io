import { NextResponse } from 'next/server'
import { loadDriveDay } from '@/lib/prep-sheet/load'
import {
  SYSTEM_PROMPT, buildCopilotContext, buildUserPrompt, getProvider, sourceLabel,
} from '@/lib/copilot'
import type { CopilotIntent, CopilotRequest } from '@/lib/copilot'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'
import { demoNow } from '@/lib/demo-day'
import { getCurrentUser, getCurrentStore } from '@/lib/auth/session'
import { FixedWindowLimiter } from '@/lib/rate-limit/window'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Must match the drive page — the prep sheet is derived as of the visit. */
const DAY = () => demoNow()

const INTENTS: CopilotIntent[] = [
  'EXPLAIN_COVERAGE', 'NEXT_STEP', 'TALK_TRACK', 'OBJECTION', 'FREEFORM',
]

/** Long enough for a real question, short enough not to be a prompt-stuffing vector. */
const MAX_INPUT_CHARS = 500

/** Per signed-in user. See the note at the call site for why it is keyed there. */
const copilotLimiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000 })

interface Body {
  appointmentId?: unknown
  intent?: unknown
  opportunityId?: unknown
  coverageKey?: unknown
  objection?: unknown
  question?: unknown
  decisions?: unknown
}

function str(v: unknown, max = MAX_INPUT_CHARS): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

export async function POST(req: Request) {
  /**
   * 401 rather than a redirect — this is an API route, and a browser fetch
   * that silently followed a redirect to the login page would surface as a
   * confusing parse error in the panel rather than "you are signed out".
   *
   * Checked here and not only in the middleware: the middleware is a separate
   * deploy artifact on the host, and this endpoint returns a customer's
   * coverage detail and spends model tokens.
   */
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  /*
    Keyed on the user, and applied after the auth check rather than before it.

    Before it, an anonymous flood would consume the allowance of whoever it was
    keyed to — and there is nobody to key it to yet, so every anonymous caller
    would share one bucket and lock each other out. After it, the only way to
    spend somebody's allowance is to already be them.

    The cost being limited here is money, not data: every call that gets past
    this spends model tokens on somebody's API bill. Thirty a minute is far
    more than an advisor asks and far less than a loop costs.
  */
  const gate = copilotLimiter.check(user.id, Date.now())
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'Too many questions at once — give it a moment.' },
      { status: 429, headers: { 'retry-after': String(gate.retryAfterSeconds) } },
    )
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const appointmentId = str(body.appointmentId, 64)
  const intent = INTENTS.find((i) => i === body.intent)
  if (!appointmentId || !intent) {
    return NextResponse.json(
      { error: 'appointmentId and a known intent are required.' },
      { status: 400 },
    )
  }

  const store = await getCurrentStore()
  if (!store) {
    return NextResponse.json({ error: 'No store configured.' }, { status: 500 })
  }

  /**
   * The facts are re-derived server-side from the appointment id. The client
   * sends which visit it is asking about, never what is true about it — so a
   * tampered payload cannot put words in the model's mouth about coverage.
   */
  const sheets = await loadDriveDay(store.id, DAY(), DAY())
  const sheet = sheets.find((s) => s.appointment?.id === appointmentId)
  if (!sheet) {
    return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 })
  }

  // Decisions are advisor UI state and exist nowhere else yet, so they are the
  // one thing we do take from the client — and only as an id → enum map.
  const decisions: Record<string, OpportunityDecision> = {}
  if (body.decisions && typeof body.decisions === 'object') {
    for (const [id, value] of Object.entries(body.decisions as Record<string, unknown>)) {
      if (value === 'ACCEPTED' || value === 'DECLINED' || value === 'SKIPPED') {
        decisions[id] = value
      }
    }
  }

  const request: CopilotRequest = {
    intent,
    opportunityId: str(body.opportunityId, 64),
    coverageKey: str(body.coverageKey, 128),
    objection: str(body.objection),
    question: str(body.question),
  }

  const context = buildCopilotContext(sheet, decisions, DAY())
  const provider = await getProvider()

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of provider.stream(
          {
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(request, context),
            request,
            context,
          },
          req.signal,
        )) {
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (error) {
        // The advisor is standing at a car — surface the failure in the panel
        // rather than leaving a half-written answer on screen.
        const message = error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(encoder.encode(`\n\n[Co-Pilot error: ${message}]`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Copilot-Source': sourceLabel(request, context),
      'X-Copilot-Provider': provider.name,
    },
  })
}
