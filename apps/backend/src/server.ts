import Fastify, { type FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  classroomSchema,
  lessonSchema,
  registerSchema,
  sequenceSchema,
} from '@institplanit/api-contracts';
import { calculateProgress, frenchPublicHolidays, isTeachingDay } from './domain';
import { backendOpenApi } from './openapi';

const app = Fastify({ logger: true });
const prisma = new PrismaClient();
const internalSecret = process.env.INTERNAL_SERVICE_SECRET ?? 'local-internal-secret-change-this';
if (process.env.NODE_ENV === 'production' && (
  internalSecret.length < 32
  || internalSecret === 'local-internal-secret-change-this'
  || internalSecret === 'replace-with-a-different-random-secret'
  || (process.env.DATABASE_URL ?? '').includes('change-me-locally')
)) {
  throw new Error('Production requires a strong internal secret and a non-development database password.');
}

class VersionConflict extends Error {}

function error(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).send({ code, message, requestId: reply.request.id });
}

function authenticatedUser(request: { headers: Record<string, string | string[] | undefined> }) {
  const userId = request.headers['x-institplanit-user'];
  const timestamp = request.headers['x-institplanit-time'];
  const signature = request.headers['x-institplanit-signature'];
  if (typeof userId !== 'string' || typeof timestamp !== 'string' || typeof signature !== 'string') return null;
  if (Math.abs(Date.now() - Number(timestamp)) > 60_000) return null;
  const expected = createHmac('sha256', internalSecret).update(`${userId}:${timestamp}`).digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) ? userId : null;
}

async function requireUser(request: Parameters<typeof authenticatedUser>[0], reply: FastifyReply) {
  const userId = authenticatedUser(request);
  if (!userId) {
    error(reply, 401, 'UNAUTHENTICATED', 'Authentification requise.');
    return null;
  }
  return userId;
}

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/openapi.json', async () => backendOpenApi);
app.get('/health/ready', async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  } catch {
    return reply.code(503).send({ status: 'unavailable' });
  }
});

app.post('/api/v1/auth/register', async (request, reply) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 422, 'VALIDATION_ERROR', 'Les informations saisies sont invalides.');
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return error(reply, 409, 'EMAIL_TAKEN', 'Cette adresse e-mail est déjà utilisée.');
  const user = await prisma.user.create({
    data: { email, passwordHash: await argon2.hash(parsed.data.password, { type: argon2.argon2id }) },
    select: { id: true, email: true },
  });
  return reply.code(201).send(user);
});

app.post('/api/v1/auth/login', async (request, reply) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 422, 'VALIDATION_ERROR', 'Les informations saisies sont invalides.');
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
    return error(reply, 401, 'INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect.');
  }
  return { id: user.id, email: user.email };
});

app.get('/api/v1/me', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
});

app.get('/api/v1/classrooms', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  return prisma.classroom.findMany({
    where: { ownerId: userId, archivedAt: null },
    include: { levels: true, days: true, schoolYear: true },
    orderBy: { createdAt: 'asc' },
  });
});

app.post('/api/v1/classrooms', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const parsed = classroomSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 422, 'VALIDATION_ERROR', 'Les informations de classe sont invalides.');
  const data = parsed.data;
  if (new Date(data.endDate) <= new Date(data.startDate)) {
    return error(reply, 422, 'INVALID_SCHOOL_YEAR', 'La fin de l’année doit suivre son début.');
  }
  const classRoom = await prisma.$transaction(async (tx) => {
    const schoolYear = await tx.schoolYear.upsert({
      where: { label_startDate: { label: data.schoolYearLabel, startDate: new Date(`${data.startDate}T00:00:00.000Z`) } },
      create: {
        label: data.schoolYearLabel,
        startDate: new Date(`${data.startDate}T00:00:00.000Z`),
        endDate: new Date(`${data.endDate}T00:00:00.000Z`),
      },
      update: {},
    });
    return tx.classroom.create({
      data: {
        ownerId: userId,
        schoolYearId: schoolYear.id,
        name: data.name,
        academyCode: data.academyCode.toUpperCase(),
        levels: { create: [...new Set(data.levels)].map((level) => ({ level })) },
        days: { create: [...new Set(data.weekdays)].map((weekday) => ({ weekday })) },
        subjects: {
          create: [
            'Français', 'Mathématiques', 'Anglais', 'Histoire-géographie',
            'Sciences', 'EPS', 'Arts', 'EMC',
          ].map((name, sortOrder) => ({ name, sortOrder })),
        },
      },
      include: { levels: true, days: true, subjects: true, schoolYear: true },
    });
  });
  return reply.code(201).send(classRoom);
});

app.get('/api/v1/classrooms/:id/subjects', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const classroom = await prisma.classroom.findFirst({ where: { id, ownerId: userId } });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  return prisma.subject.findMany({ where: { classroomId: id, active: true }, orderBy: { sortOrder: 'asc' } });
});

app.post('/api/v1/classrooms/:id/sequences', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const parsed = sequenceSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 422, 'VALIDATION_ERROR', 'Les informations de séquence sont invalides.');
  const classroom = await prisma.classroom.findFirst({
    where: { id, ownerId: userId },
    include: { levels: true },
  });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const allowedLevels = new Set(classroom.levels.map(({ level }) => level));
  if (parsed.data.levels.some((level) => !allowedLevels.has(level))) {
    return error(reply, 422, 'INVALID_LEVEL', 'Tous les niveaux doivent appartenir à la classe.');
  }
  const subject = await prisma.subject.findFirst({
    where: { id: parsed.data.subjectId, classroomId: id, active: true },
    select: { id: true },
  });
  if (!subject) return error(reply, 422, 'INVALID_SUBJECT', 'La matière ne fait pas partie de cette classe.');
  const sequence = await prisma.sequence.create({
    data: {
      classroomId: id,
      subjectId: subject.id,
      title: parsed.data.title,
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
      targetPeriod: parsed.data.targetPeriod,
      levels: {
        create: [...new Set(parsed.data.levels)].map((level) => ({
          level,
          ...(parsed.data.objectives?.[level] === undefined ? {} : { optionalObjective: parsed.data.objectives[level] }),
        })),
      },
    },
    include: { levels: true, subject: true },
  });
  return reply.code(201).send(sequence);
});

app.post('/api/v1/sequences/:id/lessons', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const parsed = lessonSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 422, 'VALIDATION_ERROR', 'Les informations de séance sont invalides.');
  const sequence = await prisma.sequence.findFirst({
    where: { id, archivedAt: null, classroom: { ownerId: userId, archivedAt: null } },
    include: { levels: true },
  });
  if (!sequence) return error(reply, 404, 'NOT_FOUND', 'Séquence introuvable.');
  const allowedLevels = new Set(sequence.levels.map(({ level }) => level));
  if (parsed.data.levels.some((level) => !allowedLevels.has(level))) {
    return error(reply, 422, 'INVALID_LEVEL', 'Les niveaux de séance doivent appartenir à la séquence.');
  }
  const count = await prisma.lesson.count({ where: { sequenceId: id } });
  const lesson = await prisma.lesson.create({
    data: {
      sequenceId: id,
      title: parsed.data.title,
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
      estimatedMinutes: parsed.data.estimatedMinutes,
      sortOrder: count,
      levels: { create: [...new Set(parsed.data.levels)].map((level) => ({ level })) },
    },
    include: { levels: true },
  });
  return reply.code(201).send(lesson);
});

app.get('/api/v1/classrooms/:id/sequences', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const classroom = await prisma.classroom.findFirst({ where: { id, ownerId: userId } });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  return prisma.sequence.findMany({
    where: { classroomId: id, archivedAt: null },
    include: { levels: true, subject: true, lessons: { where: { archivedAt: null }, include: { levels: true }, orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ targetPeriod: 'asc' }, { sortOrder: 'asc' }],
  });
});

app.patch('/api/v1/sequences/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const parsed = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(4000).nullable().optional(),
    targetPeriod: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']).optional(),
    sortOrder: z.number().int().min(0).optional(),
  }).safeParse(request.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return error(reply, 422, 'VALIDATION_ERROR', 'Les modifications de séquence sont invalides.');
  const sequence = await prisma.sequence.findFirst({ where: { id, classroom: { ownerId: userId }, archivedAt: null } });
  if (!sequence) return error(reply, 404, 'NOT_FOUND', 'Séquence introuvable.');
  const data = {
    ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
    ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
    ...(parsed.data.targetPeriod === undefined ? {} : { targetPeriod: parsed.data.targetPeriod }),
    ...(parsed.data.sortOrder === undefined ? {} : { sortOrder: parsed.data.sortOrder }),
  };
  return prisma.sequence.update({ where: { id }, data, include: { levels: true, subject: true } });
});

app.delete('/api/v1/sequences/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const sequence = await prisma.sequence.findFirst({
    where: { id, classroom: { ownerId: userId }, archivedAt: null },
    include: { lessons: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!sequence) return error(reply, 404, 'NOT_FOUND', 'Séquence introuvable.');
  await prisma.$transaction(async (tx) => {
    await tx.sequence.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.lesson.updateMany({ where: { sequenceId: id, archivedAt: null }, data: { archivedAt: new Date() } });
    for (const lesson of sequence.lessons) {
      await tx.lessonEvent.create({ data: { lessonId: lesson.id, actorId: userId, eventType: 'ARCHIVED', payload: { sequenceId: id } } });
    }
  });
  return reply.code(204).send();
});

app.patch('/api/v1/lessons/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const parsed = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(4000).nullable().optional(),
    estimatedMinutes: z.number().int().min(1).max(600).optional(),
    sortOrder: z.number().int().min(0).optional(),
  }).safeParse(request.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return error(reply, 422, 'VALIDATION_ERROR', 'Les modifications de séance sont invalides.');
  const lesson = await prisma.lesson.findFirst({ where: { id, archivedAt: null, sequence: { classroom: { ownerId: userId }, archivedAt: null } } });
  if (!lesson) return error(reply, 404, 'NOT_FOUND', 'Séance introuvable.');
  const data = {
    ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
    ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
    ...(parsed.data.estimatedMinutes === undefined ? {} : { estimatedMinutes: parsed.data.estimatedMinutes }),
    ...(parsed.data.sortOrder === undefined ? {} : { sortOrder: parsed.data.sortOrder }),
  };
  return prisma.lesson.update({ where: { id }, data, include: { levels: true } });
});

app.delete('/api/v1/lessons/:id', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const lesson = await prisma.lesson.findFirst({ where: { id, archivedAt: null, sequence: { classroom: { ownerId: userId } } } });
  if (!lesson) return error(reply, 404, 'NOT_FOUND', 'Séance introuvable.');
  await prisma.$transaction(async (tx) => {
    await tx.lesson.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.lessonEvent.create({ data: { lessonId: id, actorId: userId, eventType: 'ARCHIVED', payload: { archivedAt: new Date().toISOString() } } });
  });
  return reply.code(204).send();
});

app.get('/api/v1/lessons/:id/history', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const lesson = await prisma.lesson.findFirst({ where: { id, sequence: { classroom: { ownerId: userId } } }, select: { id: true } });
  if (!lesson) return error(reply, 404, 'NOT_FOUND', 'Séance introuvable.');
  return prisma.lessonEvent.findMany({ where: { lessonId: id }, orderBy: { createdAt: 'desc' } });
});

app.get('/api/v1/classrooms/:id/available-lessons', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const classroom = await prisma.classroom.findFirst({
    where: { id, ownerId: userId, archivedAt: null },
    include: { levels: true },
  });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const levels = classroom.levels.map(({ level }) => level);
  const lessons = await prisma.lesson.findMany({
    where: {
      archivedAt: null,
      sequence: { classroomId: id, archivedAt: null },
      levels: { some: { level: { in: levels } } },
      schedules: { none: { state: 'ACTIVE' } },
    },
    include: { levels: true, progress: true, sequence: { include: { subject: true } } },
    orderBy: [{ sequence: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });
  return lessons.filter((lesson) => !lesson.levels.every(({ level }) => lesson.progress.some((progress) => progress.level === level && progress.state === 'DONE')));
});

const weekPathSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 1;
}, 'La semaine doit commencer un lundi.');

app.get('/api/v1/classrooms/:id/weeks/:weekStart', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id, weekStart } = request.params as { id: string; weekStart: string };
  if (!weekPathSchema.safeParse(weekStart).success) return error(reply, 422, 'INVALID_WEEK', 'La semaine doit commencer un lundi.');
  const classroom = await prisma.classroom.findFirst({ where: { id, ownerId: userId } });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
  return (await prisma.weeklyPlan.findUnique({
    where: { classroomId_weekStartDate: { classroomId: id, weekStartDate } },
    include: {
      schedules: {
        where: { state: 'ACTIVE' },
        include: { lesson: { include: { levels: true, progress: true, sequence: { include: { subject: true } } } } },
        orderBy: [{ lesson: { sequence: { sortOrder: 'asc' } } }, { lesson: { sortOrder: 'asc' } }],
      },
    },
  })) ?? { id: null, classroomId: id, weekStartDate: weekStart, state: 'DRAFT', version: 0, schedules: [] };
});

app.put('/api/v1/classrooms/:id/weeks/:weekStart', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id, weekStart } = request.params as { id: string; weekStart: string };
  if (!weekPathSchema.safeParse(weekStart).success) return error(reply, 422, 'INVALID_WEEK', 'La semaine doit commencer un lundi.');
  const parsed = z.object({ lessonIds: z.array(z.string()).max(100), version: z.number().int().min(0) }).safeParse(request.body);
  if (!parsed.success || new Set(parsed.data.lessonIds).size !== parsed.data.lessonIds.length) {
    return error(reply, 422, 'VALIDATION_ERROR', 'La liste de séances est invalide ou contient des doublons.');
  }
  const classroom = await prisma.classroom.findFirst({
    where: { id, ownerId: userId, archivedAt: null },
    include: {
      days: true,
      exceptions: {
        where: {
          date: {
            gte: new Date(`${weekStart}T00:00:00.000Z`),
            lt: new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 7 * 86400000),
          },
        },
      },
    },
  });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const exceptions = new Map(classroom.exceptions.map(({ date, isTeachingDay }) => [date.toISOString().slice(0, 10), isTeachingDay]));
  const hasTeachingDay = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000);
    const isoDate = date.toISOString().slice(0, 10);
    const isHoliday = frenchPublicHolidays(date.getUTCFullYear()).has(isoDate);
    return exceptions.has(isoDate) ? exceptions.get(isoDate) === true : !isHoliday && classroom.days.some(({ weekday }) => weekday === date.getUTCDay());
  }).some(Boolean);
  if (!hasTeachingDay && parsed.data.lessonIds.length) return error(reply, 409, 'NO_TEACHING_DAY', 'Cette semaine ne comporte aucun jour de classe.');
  const existing = await prisma.weeklyPlan.findUnique({
    where: { classroomId_weekStartDate: { classroomId: id, weekStartDate: start } },
    include: { schedules: { where: { state: 'ACTIVE' } } },
  });
  if (existing?.state === 'CONFIRMED') return error(reply, 409, 'PLAN_CONFIRMED', 'Réouvrez la semaine avant de la modifier.');
  if (existing && parsed.data.version !== undefined && existing.version !== parsed.data.version) {
    return error(reply, 409, 'VERSION_CONFLICT', 'La semaine a été modifiée ailleurs.');
  }
  const lessons = await prisma.lesson.findMany({
    where: { id: { in: parsed.data.lessonIds }, archivedAt: null, sequence: { classroomId: id, archivedAt: null } },
    include: { levels: true, progress: true },
  });
  if (lessons.length !== parsed.data.lessonIds.length) return error(reply, 422, 'INVALID_LESSON', 'Une séance ne fait pas partie de cette classe.');
  if (lessons.some((lesson) => lesson.levels.length > 0 && lesson.levels.every(({ level }) => lesson.progress.some((progress) => progress.level === level && progress.state === 'DONE')))) {
    return error(reply, 409, 'LESSON_DONE', 'Une séance terminée doit être réouverte explicitement avant replanification.');
  }
  const alreadyScheduled = await prisma.lessonSchedule.findMany({
    where: { lessonId: { in: parsed.data.lessonIds }, state: 'ACTIVE', ...(existing ? { weeklyPlanId: { not: existing.id } } : {}) },
  });
  if (alreadyScheduled.length) return error(reply, 409, 'LESSON_ALREADY_SCHEDULED', 'Une séance est déjà affectée à une autre semaine.');
  try {
    return await prisma.$transaction(async (tx) => {
      let plan;
      if (existing) {
        const updated = await tx.weeklyPlan.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new VersionConflict();
        plan = await tx.weeklyPlan.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        plan = await tx.weeklyPlan.create({ data: { classroomId: id, weekStartDate: start } });
      }
      const selected = new Set(parsed.data.lessonIds);
      for (const previous of existing?.schedules ?? []) {
        if (selected.has(previous.lessonId)) continue;
        await tx.lessonSchedule.update({ where: { id: previous.id }, data: { state: 'POSTPONED', closedAt: new Date() } });
        await tx.lessonEvent.create({ data: { lessonId: previous.lessonId, scheduleId: previous.id, actorId: userId, eventType: 'POSTPONED', payload: { weekStart } } });
      }
      const previousIds = new Set(existing?.schedules.map(({ lessonId }) => lessonId) ?? []);
      for (const lessonId of parsed.data.lessonIds) {
        if (previousIds.has(lessonId)) continue;
        const schedule = await tx.lessonSchedule.create({ data: { weeklyPlanId: plan.id, lessonId } });
        await tx.lessonEvent.create({ data: { lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'SCHEDULED', payload: { weekStart } } });
      }
      return tx.weeklyPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: { schedules: { where: { state: 'ACTIVE' }, include: { lesson: { include: { levels: true, progress: true, sequence: { include: { subject: true } } } } } } },
      });
    });
  } catch (cause) {
    if (cause instanceof VersionConflict) return error(reply, 409, 'VERSION_CONFLICT', 'La semaine a été modifiée ailleurs.');
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'P2002') {
      return error(reply, 409, 'PLAN_CONFLICT', 'La semaine ou une affectation a été créée simultanément. Rechargez le planning.');
    }
    throw cause;
  }
});

app.post('/api/v1/classrooms/:id/weeks/:weekStart/confirm', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id, weekStart } = request.params as { id: string; weekStart: string };
  if (!weekPathSchema.safeParse(weekStart).success) return error(reply, 422, 'INVALID_WEEK', 'La semaine doit commencer un lundi.');
  const plan = await prisma.weeklyPlan.findFirst({
    where: { classroomId: id, weekStartDate: new Date(`${weekStart}T00:00:00.000Z`), classroom: { ownerId: userId } },
    include: { schedules: { where: { state: 'ACTIVE' } } },
  });
  if (!plan) return error(reply, 404, 'NOT_FOUND', 'Enregistrez d’abord les séances de la semaine.');
  if (plan.state === 'CONFIRMED') return { id: plan.id, state: plan.state, confirmedAt: plan.confirmedAt };
  try {
    return await prisma.$transaction(async (tx) => {
      const changed = await tx.weeklyPlan.updateMany({ where: { id: plan.id, version: plan.version, state: 'DRAFT' }, data: { state: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } } });
      if (changed.count !== 1) throw new VersionConflict();
      for (const schedule of plan.schedules) {
        await tx.lessonEvent.create({ data: { lessonId: schedule.lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'PLAN_CONFIRMED', payload: { weekStart } } });
      }
      return tx.weeklyPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { schedules: { where: { state: 'ACTIVE' } } } });
    });
  } catch (cause) {
    if (cause instanceof VersionConflict) return error(reply, 409, 'VERSION_CONFLICT', 'La semaine a été modifiée ailleurs.');
    throw cause;
  }
});

const reviewSchema = z.object({
  version: z.number().int().optional(),
  lessons: z.array(z.object({
    lessonId: z.string().min(1),
    state: z.enum(['NOT_STARTED', 'PARTIAL', 'DONE', 'CANCELLED']),
    completedMinutes: z.number().int().min(0).optional(),
    notes: z.string().max(2000).optional(),
    levels: z.record(z.enum(['CP', 'CE1', 'CE2', 'CM1', 'CM2']), z.object({
      state: z.enum(['NOT_STARTED', 'PARTIAL', 'DONE', 'CANCELLED']),
      completedMinutes: z.number().int().min(0).optional(),
      notes: z.string().max(2000).optional(),
    })).optional(),
  })).max(100),
});

app.post('/api/v1/classrooms/:id/weeks/:weekStart/review', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id, weekStart } = request.params as { id: string; weekStart: string };
  if (!weekPathSchema.safeParse(weekStart).success) return error(reply, 422, 'INVALID_WEEK', 'La semaine doit commencer un lundi.');
  const parsed = reviewSchema.safeParse(request.body);
  if (!parsed.success || new Set(parsed.data.lessons.map(({ lessonId }) => lessonId)).size !== parsed.data.lessons.length) {
    return error(reply, 422, 'VALIDATION_ERROR', 'Le bilan est invalide ou contient des doublons.');
  }
  const plan = await prisma.weeklyPlan.findFirst({
    where: { classroomId: id, weekStartDate: new Date(`${weekStart}T00:00:00.000Z`), classroom: { ownerId: userId } },
    include: { schedules: { where: { state: 'ACTIVE' }, include: { lesson: { include: { levels: true } } } } },
  });
  if (!plan) return error(reply, 404, 'NOT_FOUND', 'Semaine introuvable.');
  if (plan.state !== 'CONFIRMED') return error(reply, 409, 'PLAN_NOT_CONFIRMED', 'Confirmez la semaine avant de valider son bilan.');
  if (parsed.data.version !== undefined && parsed.data.version !== plan.version) return error(reply, 409, 'VERSION_CONFLICT', 'La semaine a été modifiée ailleurs.');
  const schedules = new Map(plan.schedules.map((schedule) => [schedule.lessonId, schedule]));
  if (parsed.data.lessons.some(({ lessonId }) => !schedules.has(lessonId))) return error(reply, 422, 'INVALID_LESSON', 'Une séance ne fait pas partie de cette semaine.');
  for (const item of parsed.data.lessons) {
    const levels = schedules.get(item.lessonId)!.lesson.levels.map(({ level }) => level);
    if (item.levels && Object.keys(item.levels).some((level) => !levels.includes(level as typeof levels[number]))) {
      return error(reply, 422, 'INVALID_LEVEL', 'Un niveau ne fait pas partie de la séance.');
    }
    if (item.completedMinutes !== undefined && item.completedMinutes > schedules.get(item.lessonId)!.lesson.estimatedMinutes) {
      return error(reply, 422, 'INVALID_DURATION', 'La durée réalisée ne peut pas dépasser la durée prévue.');
    }
    if (item.levels && Object.values(item.levels).some((progress) => progress.completedMinutes !== undefined && progress.completedMinutes > schedules.get(item.lessonId)!.lesson.estimatedMinutes)) {
      return error(reply, 422, 'INVALID_DURATION', 'La durée réalisée par niveau ne peut pas dépasser la durée prévue.');
    }
  }
  try {
    await prisma.$transaction(async (tx) => {
      const versioned = await tx.weeklyPlan.updateMany({ where: { id: plan.id, version: plan.version }, data: { version: { increment: 1 } } });
      if (versioned.count !== 1) throw new VersionConflict();
    for (const item of parsed.data.lessons) {
      const schedule = schedules.get(item.lessonId)!;
      const targetLevels = schedule.lesson.levels.map(({ level }) => level);
      const progressUpdates = item.levels
        ? Object.entries(item.levels)
        : targetLevels.map((level) => [level, { state: item.state, completedMinutes: item.completedMinutes, notes: item.notes }] as const);
      for (const [level, progress] of progressUpdates) {
        const previous = await tx.lessonProgress.findUnique({ where: { lessonId_level: { lessonId: item.lessonId, level: level as typeof targetLevels[number] } } });
        await tx.lessonProgress.upsert({
          where: { lessonId_level: { lessonId: item.lessonId, level: level as typeof targetLevels[number] } },
          create: {
            lessonId: item.lessonId, level: level as typeof targetLevels[number], state: progress.state,
            ...(progress.completedMinutes === undefined ? {} : { completedMinutes: progress.completedMinutes }),
            ...(progress.notes === undefined ? {} : { notes: progress.notes }),
          },
          update: {
            state: progress.state,
            completedMinutes: progress.completedMinutes === undefined ? null : progress.completedMinutes,
            notes: progress.notes === undefined ? null : progress.notes,
          },
        });
        await tx.lessonEvent.create({ data: {
          lessonId: item.lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'STATUS_CHANGED',
          payload: { level, previous: previous?.state ?? 'NOT_STARTED', state: progress.state, completedMinutes: progress.completedMinutes ?? null, notes: progress.notes ?? null },
        } });
      }
      const finalProgress = await tx.lessonProgress.findMany({ where: { lessonId: item.lessonId } });
      const states = targetLevels.map((level) => {
        const changed = progressUpdates.find(([target]) => target === level)?.[1];
        return changed?.state ?? finalProgress.find((progress) => progress.level === level)?.state ?? 'NOT_STARTED';
      });
      let scheduleState: 'COMPLETED' | 'CANCELLED' | 'POSTPONED' = 'POSTPONED';
      if (states.every((state) => state === 'DONE')) scheduleState = 'COMPLETED';
      else if (states.every((state) => state === 'CANCELLED')) scheduleState = 'CANCELLED';
      await tx.lessonSchedule.update({ where: { id: schedule.id }, data: {
        state: scheduleState, closedAt: new Date(),
        remainingMinutes: item.completedMinutes === undefined ? null : Math.max(0, schedule.lesson.estimatedMinutes - item.completedMinutes),
      } });
      if (scheduleState === 'POSTPONED') {
        await tx.lessonEvent.create({ data: { lessonId: item.lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'POSTPONED', payload: { weekStart } } });
      }
      if (scheduleState === 'CANCELLED') {
        await tx.lessonEvent.create({ data: { lessonId: item.lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'CANCELLED', payload: { weekStart } } });
      }
    }
    });
  } catch (cause) {
    if (cause instanceof VersionConflict) return error(reply, 409, 'VERSION_CONFLICT', 'La semaine a été modifiée ailleurs.');
    throw cause;
  }
  return { status: 'ok' };
});

app.post('/api/v1/classrooms/:id/weeks/:weekStart/reopen', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id, weekStart } = request.params as { id: string; weekStart: string };
  if (!weekPathSchema.safeParse(weekStart).success) return error(reply, 422, 'INVALID_WEEK', 'La semaine doit commencer un lundi.');
  const plan = await prisma.weeklyPlan.findFirst({
    where: { classroomId: id, weekStartDate: new Date(`${weekStart}T00:00:00.000Z`), classroom: { ownerId: userId } },
    include: { schedules: true },
  });
  if (!plan) return error(reply, 404, 'NOT_FOUND', 'Semaine introuvable.');
  if (plan.state === 'DRAFT') return { id: plan.id, state: plan.state, version: plan.version };
  try {
    return await prisma.$transaction(async (tx) => {
      const changed = await tx.weeklyPlan.updateMany({ where: { id: plan.id, version: plan.version, state: 'CONFIRMED' }, data: { state: 'DRAFT', confirmedAt: null, version: { increment: 1 } } });
      if (changed.count !== 1) throw new VersionConflict();
      for (const schedule of plan.schedules.filter(({ state }) => state !== 'ACTIVE')) {
        await tx.lessonSchedule.update({ where: { id: schedule.id }, data: { state: 'ACTIVE', closedAt: null } });
        await tx.lessonEvent.create({ data: { lessonId: schedule.lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'REOPENED', payload: { weekStart } } });
        await tx.lessonEvent.create({ data: { lessonId: schedule.lessonId, scheduleId: schedule.id, actorId: userId, eventType: 'PLAN_REOPENED', payload: { weekStart } } });
      }
      return tx.weeklyPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { schedules: { where: { state: 'ACTIVE' } } } });
    });
  } catch (cause) {
    if (cause instanceof VersionConflict) return error(reply, 409, 'VERSION_CONFLICT', 'La semaine a été modifiée ailleurs.');
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'P2002') {
      return error(reply, 409, 'FUTURE_ASSIGNMENT_CONFLICT', 'Une séance de cette semaine a déjà été replanifiée. Résolvez ce conflit avant de réouvrir.');
    }
    throw cause;
  }
});

app.get('/api/v1/classrooms/:id/progress', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const classroom = await prisma.classroom.findFirst({ where: { id, ownerId: userId, archivedAt: null } });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const sequences = await prisma.sequence.findMany({
    where: { classroomId: id, archivedAt: null },
    include: { subject: true, levels: true, lessons: { where: { archivedAt: null }, include: { levels: true, progress: true } } },
  });
  return sequences.map((sequence) => ({
    sequenceId: sequence.id,
    title: sequence.title,
    subject: sequence.subject.name,
    targetPeriod: sequence.targetPeriod,
    overall: calculateProgress(sequence.lessons),
    levels: sequence.levels.map(({ level }) => ({ level, ...calculateProgress(sequence.lessons, level) })),
  }));
});

app.get('/api/v1/classrooms/:id/calendar', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const classroom = await prisma.classroom.findFirst({
    where: { id, ownerId: userId, archivedAt: null },
    include: { schoolYear: true, days: true, exceptions: true },
  });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const firstDate = classroom.schoolYear.startDate.toISOString().slice(0, 10);
  const lastDate = classroom.schoolYear.endDate.toISOString().slice(0, 10);
  const monday = new Date(`${firstDate}T00:00:00.000Z`);
  const weekday = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  const exceptions = new Map(classroom.exceptions.map(({ date, isTeachingDay }) => [date.toISOString().slice(0, 10), isTeachingDay]));
  const holidayYears = new Map<number, Set<string>>();
  const weeks: { startDate: string; teachingDays: string[]; shortened: boolean }[] = [];
  while (monday.toISOString().slice(0, 10) <= lastDate) {
    const weekStart = monday.toISOString().slice(0, 10);
    const teachingDays: string[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      const current = new Date(monday);
      current.setUTCDate(current.getUTCDate() + offset);
      const date = current.toISOString().slice(0, 10);
      if (date < firstDate || date > lastDate) continue;
      const year = current.getUTCFullYear();
      if (!holidayYears.has(year)) holidayYears.set(year, frenchPublicHolidays(year));
      if (isTeachingDay({ date, weekday: current.getUTCDay(), isPublicHoliday: holidayYears.get(year)!.has(date), ...(exceptions.has(date) ? { exception: exceptions.get(date)! } : {}) }, new Set(classroom.days.map(({ weekday: day }) => day)))) {
        teachingDays.push(date);
      }
    }
    weeks.push({ startDate: weekStart, teachingDays, shortened: teachingDays.length > 0 && teachingDays.length < classroom.days.length });
    monday.setUTCDate(monday.getUTCDate() + 7);
  }
  const calendarCache = await prisma.schoolCalendarCache.findUnique({
    where: { academyCode_schoolYear: { academyCode: classroom.academyCode, schoolYear: classroom.schoolYear.label } },
  });
  return {
    schoolYear: classroom.schoolYear,
    academyCode: classroom.academyCode,
    zoneCode: classroom.zoneCode,
    source: calendarCache?.source ?? 'Jours fériés nationaux et configuration manuelle',
    fetchedAt: calendarCache?.fetchedAt ?? null,
    schoolClosures: calendarCache?.payload ?? null,
    weeks,
    exceptions: classroom.exceptions,
    limitation: calendarCache ? null : 'Vacances scolaires non chargées. Configurez la source officielle du calendrier pour les afficher.',
  };
});

const calendarExceptionSchema = z.object({ date: z.string().date(), isTeachingDay: z.boolean(), reason: z.string().max(200).optional() });

app.post('/api/v1/classrooms/:id/calendar/exceptions', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id } = request.params as { id: string };
  const parsed = calendarExceptionSchema.safeParse(request.body);
  if (!parsed.success) return error(reply, 422, 'VALIDATION_ERROR', 'L’exception de calendrier est invalide.');
  const classroom = await prisma.classroom.findFirst({ where: { id, ownerId: userId, archivedAt: null } });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const schoolYear = await prisma.schoolYear.findFirst({ where: { classrooms: { some: { id } } } });
  if (!schoolYear || date < schoolYear.startDate || date > schoolYear.endDate) return error(reply, 422, 'DATE_OUT_OF_RANGE', 'La date doit appartenir à l’année scolaire.');
  return prisma.calendarException.upsert({
    where: { classroomId_date: { classroomId: id, date } },
    create: {
      classroomId: id,
      date,
      isTeachingDay: parsed.data.isTeachingDay,
      ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
    },
    update: {
      isTeachingDay: parsed.data.isTeachingDay,
      ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
    },
  });
});

app.delete('/api/v1/classrooms/:id/calendar/exceptions/:date', async (request, reply) => {
  const userId = await requireUser(request, reply);
  if (!userId) return;
  const { id, date: dateValue } = request.params as { id: string; date: string };
  const parsedDate = z.string().date().safeParse(dateValue);
  if (!parsedDate.success) return error(reply, 422, 'INVALID_DATE', 'La date doit être au format AAAA-MM-JJ.');
  const classroom = await prisma.classroom.findFirst({ where: { id, ownerId: userId } });
  if (!classroom) return error(reply, 404, 'NOT_FOUND', 'Classe introuvable.');
  await prisma.calendarException.deleteMany({ where: { classroomId: id, date: new Date(`${dateValue}T00:00:00.000Z`) } });
  return reply.code(204).send();
});

app.addHook('onClose', async () => prisma.$disconnect());

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });