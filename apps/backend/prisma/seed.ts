import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Le seed de démonstration est interdit en production.');
}

const prisma = new PrismaClient();

function mondayOf(date: Date) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return monday;
}

try {
  const email = 'demo@institplanit.local';
  const password = process.env.DEMO_PASSWORD ?? 'ClasseMultiNiveaux-2026!';
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    update: {},
  });
  const now = new Date();
  const yearStart = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const label = `${yearStart}-${yearStart + 1}`;
  const schoolYear = await prisma.schoolYear.upsert({
    where: { label_startDate: { label, startDate: new Date(Date.UTC(yearStart, 8, 1)) } },
    create: { label, startDate: new Date(Date.UTC(yearStart, 8, 1)), endDate: new Date(Date.UTC(yearStart + 1, 6, 31)) },
    update: {},
  });
  let classroom = await prisma.classroom.findFirst({ where: { ownerId: user.id, schoolYearId: schoolYear.id, name: 'Classe CE2-CM1' } });
  if (!classroom) {
    classroom = await prisma.classroom.create({
      data: {
        ownerId: user.id, schoolYearId: schoolYear.id, name: 'Classe CE2-CM1', academyCode: 'PAR', zoneCode: 'C',
        levels: { create: [{ level: 'CE2' }, { level: 'CM1' }] },
        days: { create: [{ weekday: 1 }, { weekday: 2 }, { weekday: 4 }, { weekday: 5 }] },
        subjects: { create: ['Français', 'Mathématiques', 'Anglais', 'Histoire-géographie', 'Sciences', 'EPS', 'Arts', 'EMC'].map((name, sortOrder) => ({ name, sortOrder })) },
      },
    });
  }
  const french = await prisma.subject.findFirstOrThrow({ where: { classroomId: classroom.id, name: 'Français' } });
  let sequence = await prisma.sequence.findFirst({ where: { classroomId: classroom.id, title: 'Le groupe nominal' } });
  if (!sequence) {
    sequence = await prisma.sequence.create({
      data: {
        classroomId: classroom.id, subjectId: french.id, title: 'Le groupe nominal',
        description: 'Identifier le nom noyau et enrichir le groupe nominal.', targetPeriod: 'P2',
        levels: { create: [{ level: 'CE2', optionalObjective: 'Repérer le nom et son déterminant.' }, { level: 'CM1', optionalObjective: 'Enrichir le groupe nominal avec des expansions.' }] },
      },
    });
  }
  const lessonData = [
    { title: 'Repérer le nom noyau', estimatedMinutes: 45, levels: ['CE2', 'CM1'] as const },
    { title: 'Déterminants et accords', estimatedMinutes: 40, levels: ['CE2', 'CM1'] as const },
    { title: 'Enrichir avec des expansions', estimatedMinutes: 35, levels: ['CM1'] as const },
  ];
  const lessons = [];
  for (const [sortOrder, data] of lessonData.entries()) {
    let lesson = await prisma.lesson.findFirst({ where: { sequenceId: sequence.id, title: data.title } });
    if (!lesson) {
      lesson = await prisma.lesson.create({
        data: { sequenceId: sequence.id, title: data.title, estimatedMinutes: data.estimatedMinutes, sortOrder, levels: { create: data.levels.map((level) => ({ level })) } },
      });
    }
    lessons.push(lesson);
  }
  const monday = mondayOf(now);
  const previousMonday = new Date(monday);
  previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
  const completedPlan = await prisma.weeklyPlan.upsert({
    where: { classroomId_weekStartDate: { classroomId: classroom.id, weekStartDate: previousMonday } },
    create: { classroomId: classroom.id, weekStartDate: previousMonday, state: 'CONFIRMED', confirmedAt: new Date() },
    update: {},
  });
  const completedSchedule = await prisma.lessonSchedule.findFirst({ where: { weeklyPlanId: completedPlan.id, lessonId: lessons[0]!.id } })
    ?? await prisma.lessonSchedule.create({ data: { weeklyPlanId: completedPlan.id, lessonId: lessons[0]!.id, state: 'COMPLETED', closedAt: new Date() } });
  for (const level of ['CE2', 'CM1'] as const) {
    await prisma.lessonProgress.upsert({
      where: { lessonId_level: { lessonId: lessons[0]!.id, level } },
      create: { lessonId: lessons[0]!.id, level, state: 'DONE', completedMinutes: lessons[0]!.estimatedMinutes },
      update: { state: 'DONE', completedMinutes: lessons[0]!.estimatedMinutes },
    });
  }
  for (const level of ['CE2', 'CM1']) {
    const hasEvent = await prisma.lessonEvent.findFirst({ where: { lessonId: lessons[0]!.id, scheduleId: completedSchedule.id, actorId: user.id, eventType: 'STATUS_CHANGED', payload: { path: ['level'], equals: level } } });
    if (!hasEvent) {
      await prisma.lessonEvent.create({ data: {
        lessonId: lessons[0]!.id, scheduleId: completedSchedule.id, actorId: user.id, eventType: 'STATUS_CHANGED', payload: { level, state: 'DONE', seeded: true },
      } });
    }
  }
  const currentPlan = await prisma.weeklyPlan.upsert({
    where: { classroomId_weekStartDate: { classroomId: classroom.id, weekStartDate: monday } },
    create: { classroomId: classroom.id, weekStartDate: monday },
    update: {},
  });
  const currentSchedule = await prisma.lessonSchedule.findFirst({ where: { weeklyPlanId: currentPlan.id, lessonId: lessons[1]!.id } });
  if (!currentSchedule) await prisma.lessonSchedule.create({ data: { weeklyPlanId: currentPlan.id, lessonId: lessons[1]!.id } });

  console.info(`Seed local prêt: ${email} / ${password}`);
} finally {
  await prisma.$disconnect();
}