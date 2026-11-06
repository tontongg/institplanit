import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addUtcDays, calculateProgress, isTeachingDay } from './domain.ts';

describe('calendar rules', () => {
  it('uses the local exception before the regular weekday and holiday', () => {
    const weekdays = new Set([1, 2, 4, 5]);
    assert.equal(isTeachingDay({ date: '2026-11-11', weekday: 3, isPublicHoliday: true, exception: true }, weekdays), true);
    assert.equal(isTeachingDay({ date: '2026-11-11', weekday: 3, isPublicHoliday: true }, weekdays), false);
  });

  it('does not count a non-working Wednesday and handles week boundaries in UTC', () => {
    assert.equal(isTeachingDay({ date: '2026-11-04', weekday: 3, isPublicHoliday: false }, new Set([1, 2, 4, 5])), false);
    assert.equal(addUtcDays('2026-11-02', 6), '2026-11-08');
  });
});

describe('progress calculation', () => {
  it('counts shared lesson workload once and calculates progress per level', () => {
    const lessons = [{
      estimatedMinutes: 45,
      levels: [{ level: 'CE2' }, { level: 'CM1' }],
      progress: [
        { level: 'CE2', state: 'DONE', completedMinutes: null },
        { level: 'CM1', state: 'PARTIAL', completedMinutes: 15 },
      ],
    }];
    assert.deepEqual(calculateProgress(lessons), { plannedMinutes: 45, completedMinutes: 30, percentage: 67, cancelledCount: 0 });
    assert.equal(calculateProgress(lessons, 'CE2').completedMinutes, 45);
    assert.equal(calculateProgress(lessons, 'CM1').completedMinutes, 15);
  });

  it('does not turn cancelled work into completed progress', () => {
    const summary = calculateProgress([{ estimatedMinutes: 30, levels: [{ level: 'CP' }], progress: [{ level: 'CP', state: 'CANCELLED', completedMinutes: null }] }]);
    assert.equal(summary.completedMinutes, 0);
    assert.equal(summary.cancelledCount, 1);
  });
});