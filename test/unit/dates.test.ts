import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, dropDate, originFor, segmentFloor, segmentIndex, segmentLabel, segmentStart, startOfMonth, startOfWeek, today } from '../../webview/src/layout/dates';

describe('dates', () => {
  it('finds the Monday of a week', () => {
    expect(startOfWeek('2026-11-03')).toBe('2026-11-02'); // Tuesday
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02'); // Monday
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02'); // Sunday
  });

  it('finds the 1st of a month', () => {
    expect(startOfMonth('2026-11-17')).toBe('2026-11-01');
  });

  it('adds days across a year change and a leap day', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2026-01-02', -3)).toBe('2025-12-30');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('counts calendar days over a DST change', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-11-02', '2026-10-30')).toBe(-3);
  });

  it('has a local today in the right shape', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('puts the origin 3 segments before today', () => {
    expect(originFor('2026-11-04', 'days')).toBe('2026-11-01');
    expect(originFor('2026-11-04', 'weeks')).toBe('2026-10-12');
    expect(originFor('2026-11-04', 'months')).toBe('2026-08-01');
    expect(segmentFloor('2026-11-04', 'weeks')).toBe('2026-11-02');
  });

  it('maps dates to segment indexes', () => {
    const origin = '2026-10-12';
    expect(segmentIndex('2026-10-12', origin, 'weeks')).toBe(0);
    expect(segmentIndex('2026-10-18', origin, 'weeks')).toBe(0);
    expect(segmentIndex('2026-10-19', origin, 'weeks')).toBe(1);
    expect(segmentIndex('2026-10-11', origin, 'weeks')).toBe(-1);
    expect(segmentIndex('2026-10-05', origin, 'days')).toBe(-7);
    expect(segmentIndex('2027-02-10', '2026-11-01', 'months')).toBe(3);
    expect(segmentIndex('2026-09-30', '2026-11-01', 'months')).toBe(-2);
  });

  it('maps segment indexes back to start dates', () => {
    expect(segmentStart(2, '2026-10-12', 'weeks')).toBe('2026-10-26');
    expect(segmentStart(-1, '2026-01-01', 'months')).toBe('2025-12-01');
    expect(segmentStart(14, '2026-11-01', 'months')).toBe('2028-01-01');
    expect(segmentStart(-3, '2026-11-04', 'days')).toBe('2026-11-01');
  });

  it('labels segments', () => {
    expect(segmentLabel(0, '2026-11-02', 'weeks')).toMatch(/2.*8/);
    expect(segmentLabel(0, '2026-11-01', 'months')).toContain('2026');
    expect(segmentLabel(0, '2026-11-03', 'days')).toContain('3');
  });

  it('keeps the date when it is already in the dropped week or month', () => {
    expect(dropDate('2026-10-14', 0, '2026-10-12', 'weeks')).toBe('2026-10-14');
    expect(dropDate('2026-10-14', 1, '2026-10-12', 'weeks')).toBe('2026-10-19');
    expect(dropDate(undefined, 1, '2026-10-12', 'weeks')).toBe('2026-10-19');
    expect(dropDate('2026-11-20', 0, '2026-11-01', 'months')).toBe('2026-11-20');
    expect(dropDate('2026-11-20', 1, '2026-11-01', 'months')).toBe('2026-12-01');
  });

  it('always uses the dropped day in Days', () => {
    expect(dropDate('2026-11-05', 2, '2026-11-01', 'days')).toBe('2026-11-03');
    expect(dropDate('2026-11-03', 2, '2026-11-01', 'days')).toBe('2026-11-03');
  });
});
