import { test, expect, describe } from 'vitest'
import { dateDiff } from '../src/date-diff.js'

describe('dateDiff', () => {
  // -----------------------------------------------------------------------
  // Different dates
  // -----------------------------------------------------------------------

  describe('different dates', () => {
    test('shows date change across months', () => {
      const from = new Date('2025-01-10T08:00:00Z')
      const to = new Date('2025-02-15T14:30:00Z')

      expect(dateDiff(from, to)).toBe('10 Jan 2025 => 15 Feb 2025')
    })

    test('shows date change across years', () => {
      const from = new Date('2024-12-31T23:59:59Z')
      const to = new Date('2025-01-01T00:00:00Z')

      expect(dateDiff(from, to)).toBe('31 Dec 2024 => 1 Jan 2025')
    })

    test('shows date change within the same month', () => {
      const from = new Date('2025-03-01T12:00:00Z')
      const to = new Date('2025-03-20T18:00:00Z')

      expect(dateDiff(from, to)).toBe('1 Mar 2025 => 20 Mar 2025')
    })
  })

  // -----------------------------------------------------------------------
  // Same date (time diff)
  // -----------------------------------------------------------------------

  describe('same date', () => {
    test('shows time difference with date prefix', () => {
      const from = new Date('2026-02-11T23:04:12Z')
      const to = new Date('2026-02-11T23:46:12Z')

      expect(dateDiff(from, to)).toBe('11 Feb 2026; 23:04:12 => 23:46:12')
    })

    test('shows time difference at midnight', () => {
      const from = new Date('2025-06-15T00:00:00Z')
      const to = new Date('2025-06-15T12:30:45Z')

      expect(dateDiff(from, to)).toBe('15 Jun 2025; 00:00:00 => 12:30:45')
    })

    test('shows identical times', () => {
      const d = new Date('2025-09-01T10:20:30Z')

      expect(dateDiff(d, d)).toBe('1 Sep 2025; 10:20:30 => 10:20:30')
    })
  })
})
