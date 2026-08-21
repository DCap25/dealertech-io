'use client'

/**
 * An instant, in the reader's own timezone.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A CLIENT COMPONENT FOR FOUR LINES OF FORMATTING
 * ---------------------------------------------------------------------------
 * A walkthrough is the one thing in this console with a time of day that
 * matters. Everything else is a date or a duration — "3d ago" reads the same
 * anywhere — but "two o'clock" has to mean two o'clock where the person
 * reading it is sitting, and the server has no idea where that is. Rendered
 * server-side it would come out in UTC, which on Netlify means every
 * afternoon demo appears to be in the morning.
 *
 * `suppressHydrationWarning` because the server and the browser genuinely
 * disagree here and the browser is right. React would otherwise report the
 * difference as a bug, which is exactly backwards: the mismatch is the
 * feature, and the alternative — rendering nothing until after hydration —
 * makes the time flicker in on a page that is otherwise complete.
 */
export function LocalTime({ iso, dateOnly }: { iso: string; dateOnly?: boolean }) {
  const at = new Date(iso)
  const text = dateOnly
    ? at.toLocaleDateString()
    : at.toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit',
      })

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  )
}
