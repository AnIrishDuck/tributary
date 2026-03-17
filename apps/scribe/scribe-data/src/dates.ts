import { format, isSameDay } from 'date-fns'

/**
 * Render the difference between two dates as a human-readable string.
 *
 * - Different dates: "10 Jan 2025 => 15 Feb 2025"
 * - Same date: "11 Feb 2026; 23:04:12 => 23:46:12"
 */
export function dateDiff(from: Date, to: Date): string {
  if (isSameDay(from, to)) {
    return `${format(from, 'd MMM yyyy')}; ${format(from, 'HH:mm:ss')} => ${format(to, 'HH:mm:ss')}`
  }

  return `${format(from, 'd MMM yyyy')} => ${format(to, 'd MMM yyyy')}`
}
