const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDate(d: Date): string {
  const day = d.getUTCDate()
  const month = MONTHS[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day} ${month} ${year}`
}

function formatTime(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

/**
 * Render the difference between two dates as a human-readable string.
 *
 * - Different dates: "10 Jan 2025 => 15 Feb 2025"
 * - Same date: "11 Feb 2026; 23:04:12 => 23:46:12"
 */
export function dateDiff(from: Date, to: Date): string {
  const sameDate =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCDate() === to.getUTCDate()

  if (sameDate) {
    return `${formatDate(from)}; ${formatTime(from)} => ${formatTime(to)}`
  }

  return `${formatDate(from)} => ${formatDate(to)}`
}
