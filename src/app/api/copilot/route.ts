import { NextResponse } from 'next/server'
import { getDefaultStore, loadDriveDay } from '@/lib/prep-sheet/load'
import {
  SYSTEM_PROMPT, buildCopilotContext, buildUserPrompt, getProvider, sourceLabel,
} from '@/lib/copilot'
import type { CopilotIntent, CopilotRequest } from '@/lib/copilot'
import type { OpportunityDecision } from '@/lib/prep-sheet/presentation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Must match the drive page — the prep sheet is derived as of the visit. */
const DAY = new Date('2026-08-12T12:00:00')

const INTENTS: CopilotIntent[] = [
  'EXPLAIN_COVERAGE', 'NEXT_STEP', 'TALK_TRACK', 'OBJECTION', 'FREEFORM',
]

/** Long enough for a real question, short enough not to be a prompt-stuffing vector. */
const MAX_INPUT_CHARS = 500

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

  const store = await getDefaultStore()
  if (!store) {
    return NextResponse.json({ error: 'No store configured.' }, { status: 500 })
  }

  /**
   * The facts are re-derived server-side from the appointment id. The client
   * sends which visit it is asking about, never what is true about it — so a
   * tampered payload cannot put words in the model's mouth about coverage.
   */
  const sheets = await loadDriveDay(store.id, DAY, DAY)
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

  const context = buildCopilotContext(sheet, decisions, DAY)
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
