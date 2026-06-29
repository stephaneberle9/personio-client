import { describe, expect, it } from 'vitest';
import { durationHours, parseDateTimeMs, round2 } from '../src/domain/hours.js';

describe('durationHours', () => {
  it('computes a plain same-day duration', () => {
    expect(durationHours('2026-06-01T08:00:00', '2026-06-01T16:30:00')).toBe(8.5);
  });

  it('handles a period crossing midnight (end on the next calendar day)', () => {
    // 22:00 → 02:00 next day = 4h, even though the calendar date changes.
    expect(durationHours('2026-06-01T22:00:00', '2026-06-02T02:00:00')).toBe(4);
  });

  it('returns 0 for an open/running period (missing end)', () => {
    expect(durationHours('2026-06-01T08:00:00', null)).toBe(0);
    expect(durationHours('2026-06-01T08:00:00', undefined)).toBe(0);
  });

  it('returns 0 for a non-positive duration', () => {
    expect(durationHours('2026-06-01T16:00:00', '2026-06-01T08:00:00')).toBe(0);
  });

  it('is unaffected by host DST because components are read as UTC', () => {
    // Spring-forward night in Europe/Berlin (2026-03-29). Parsed as UTC, the
    // wall-clock difference is a clean 4h regardless of the host timezone.
    expect(durationHours('2026-03-29T00:00:00', '2026-03-29T04:00:00')).toBe(4);
  });

  it('respects an explicit zone designator when present', () => {
    expect(parseDateTimeMs('2026-06-01T00:00:00Z')).toBe(Date.UTC(2026, 5, 1));
  });
});

describe('round2', () => {
  it('avoids binary-float noise', () => {
    expect(round2(7.5000000001)).toBe(7.5);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
