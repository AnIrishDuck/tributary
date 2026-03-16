import { test, expect, describe } from 'vitest'
import { dateDiff } from '../src/date-diff.js'

describe('dateDiff', () => {
  // -----------------------------------------------------------------------
  // Different dates
  // -----------------------------------------------------------------------

  describe('different dates', () => {
    test('shows date change across months', () => {
      const from = new Date(2025, 0, 10, 8, 0, 0)
      const to = new Date(2025, 1, 15, 14, 30, 0)

      expect(dateDiff(from, to)).toBe('10 Jan 2025 => 15 Feb 2025')
    })

    test('shows date change across years', () => {
      const from = new Date(2024, 11, 31, 23, 59, 59)
      const to = new Date(2025, 0, 1, 0, 0, 0)

      expect(dateDiff(from, to)).toBe('31 Dec 2024 => 1 Jan 2025')
    })

    test('shows date change within the same month', () => {
      const from = new Date(2025, 2, 1, 12, 0, 0)
      const to = new Date(2025, 2, 20, 18, 0, 0)

      expect(dateDiff(from, to)).toBe('1 Mar 2025 => 20 Mar 2025')
    })
  })

  // -----------------------------------------------------------------------
  // Same date (time diff)
  // -----------------------------------------------------------------------

  describe('same date', () => {
    test('shows time difference with date prefix', () => {
      const from = new Date(2026, 1, 11, 23, 4, 12)
      const to = new Date(2026, 1, 11, 23, 46, 12)

      expect(dateDiff(from, to)).toBe('11 Feb 2026; 23:04:12 => 23:46:12')
    })

    test('shows time difference at midnight', () => {
      const from = new Date(2025, 5, 15, 0, 0, 0)
      const to = new Date(2025, 5, 15, 12, 30, 45)

      expect(dateDiff(from, to)).toBe('15 Jun 2025; 00:00:00 => 12:30:45')
    })

    test('shows identical times', () => {
      const d = new Date(2025, 8, 1, 10, 20, 30)

      expect(dateDiff(d, d)).toBe('1 Sep 2025; 10:20:30 => 10:20:30')
    })
  })
})
