import { z } from 'zod';

export const levelSchema = z.enum(['CP', 'CE1', 'CE2', 'CM1', 'CM2']);
export const periodSchema = z.enum(['P1', 'P2', 'P3', 'P4', 'P5']);
export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
});
export const classroomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  schoolYearLabel: z.string().regex(/^\d{4}-\d{4}$/),
  startDate: z.string().date(),
  endDate: z.string().date(),
  academyCode: z.string().trim().min(2).max(8),
  levels: z.array(levelSchema).min(1).max(5),
  weekdays: z.array(z.number().int().min(1).max(5)).min(1).max(5),
});
export const sequenceSchema = z.object({
  subjectId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional(),
  targetPeriod: periodSchema,
  levels: z.array(levelSchema).min(1).max(5),
  objectives: z.record(levelSchema, z.string().max(2000).optional()).optional(),
});
export const lessonSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional(),
  estimatedMinutes: z.number().int().min(1).max(600),
  levels: z.array(levelSchema).min(1).max(5),
});
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.unknown().optional(),
});

export type Level = z.infer<typeof levelSchema>;
export type ClassroomInput = z.infer<typeof classroomSchema>;
export type SequenceInput = z.infer<typeof sequenceSchema>;
export type LessonInput = z.infer<typeof lessonSchema>;