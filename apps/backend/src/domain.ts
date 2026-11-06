export type CalendarDay = {
  date: string;
  weekday: number;
  isPublicHoliday: boolean;
  exception?: boolean;
};

export function isTeachingDay(day: CalendarDay, regularWeekdays: ReadonlySet<number>): boolean {
  if (day.exception !== undefined) return day.exception;
  return regularWeekdays.has(day.weekday) && !day.isPublicHoliday;
}

export type ProgressLesson = {
  estimatedMinutes: number;
  levels: { level: string }[];
  progress: { level: string; state: 'NOT_STARTED' | 'PARTIAL' | 'DONE' | 'CANCELLED'; completedMinutes: number | null }[];
};

export function calculateProgress(lessons: ProgressLesson[], level?: string) {
  const relevant = lessons.filter((lesson) => lesson.estimatedMinutes > 0 && lesson.levels.some((target) => !level || target.level === level));
  const plannedMinutes = relevant.reduce((total, lesson) => total + lesson.estimatedMinutes, 0);
  if (!plannedMinutes) return { plannedMinutes: null, completedMinutes: null, percentage: null, cancelledCount: 0 };

  let completedMinutes = 0;
  let cancelledCount = 0;
  for (const lesson of relevant) {
    const targetLevels = lesson.levels.filter((target) => !level || target.level === level);
    const states = targetLevels.map((target) => lesson.progress.find((progress) => progress.level === target.level));
    if (states.every((progress) => progress?.state === 'CANCELLED')) {
      cancelledCount += 1;
      continue;
    }
    for (const progress of states) {
      if (progress?.state === 'DONE') completedMinutes += lesson.estimatedMinutes / targetLevels.length;
      if (progress?.state === 'PARTIAL' && progress.completedMinutes !== null) {
        completedMinutes += Math.min(Math.max(progress.completedMinutes, 0), lesson.estimatedMinutes) / targetLevels.length;
      }
    }
  }
  return {
    plannedMinutes,
    completedMinutes,
    percentage: Math.round((completedMinutes / plannedMinutes) * 100),
    cancelledCount,
  };
}

export function addUtcDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function frenchPublicHolidays(year: number): Set<string> {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easterMonth = Math.floor((h + l - 7 * m + 114) / 31);
  const easterDay = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, easterMonth - 1, easterDay));
  const holidays = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`,
    `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
  ]);
  for (const daysAfterEaster of [1, 39, 50]) {
    const date = new Date(easter);
    date.setUTCDate(date.getUTCDate() + daysAfterEaster);
    holidays.add(date.toISOString().slice(0, 10));
  }
  return holidays;
}