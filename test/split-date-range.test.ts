import { describe, expect, it } from 'vitest';
import { splitDateRange } from '../src/sources/api-source.js';

describe('splitDateRange', () => {
  it('splits a range into windows of at most windowDays, tiling it exactly', () => {
    expect(splitDateRange('2026-06-01', '2026-06-30', 14)).toEqual([
      { from: '2026-06-01', to: '2026-06-14' },
      { from: '2026-06-15', to: '2026-06-28' },
      { from: '2026-06-29', to: '2026-06-30' },
    ]);
  });

  it('returns a single window when the range is shorter than windowDays', () => {
    expect(splitDateRange('2026-06-01', '2026-06-05', 14)).toEqual([
      { from: '2026-06-01', to: '2026-06-05' },
    ]);
  });

  it('handles an exact multiple with no trailing partial window', () => {
    expect(splitDateRange('2026-06-01', '2026-06-28', 14)).toEqual([
      { from: '2026-06-01', to: '2026-06-14' },
      { from: '2026-06-15', to: '2026-06-28' },
    ]);
  });

  it('crosses month boundaries correctly (UTC date math)', () => {
    expect(splitDateRange('2026-01-20', '2026-02-10', 14)).toEqual([
      { from: '2026-01-20', to: '2026-02-02' },
      { from: '2026-02-03', to: '2026-02-10' },
    ]);
  });

  it('returns no windows when to is before from', () => {
    expect(splitDateRange('2026-06-30', '2026-06-01', 14)).toEqual([]);
  });

  it('windows are contiguous with no gaps or overlaps', () => {
    const windows = splitDateRange('2026-03-01', '2026-12-31', 14);
    expect(windows[0]!.from).toBe('2026-03-01');
    expect(windows.at(-1)!.to).toBe('2026-12-31');
    for (let i = 1; i < windows.length; i++) {
      // each window starts the day after the previous one ends
      const prevEnd = new Date(`${windows[i - 1]!.to}T00:00:00Z`);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(windows[i]!.from).toBe(prevEnd.toISOString().slice(0, 10));
    }
  });
});
