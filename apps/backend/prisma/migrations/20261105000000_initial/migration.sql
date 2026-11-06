CREATE TYPE "Level" AS ENUM ('CP', 'CE1', 'CE2', 'CM1', 'CM2');
CREATE TYPE "Period" AS ENUM ('P1', 'P2', 'P3', 'P4', 'P5');
CREATE TYPE "PlanState" AS ENUM ('DRAFT', 'CONFIRMED');
CREATE TYPE "ProgressState" AS ENUM ('NOT_STARTED', 'PARTIAL', 'DONE', 'CANCELLED');
CREATE TYPE "ScheduleState" AS ENUM ('ACTIVE', 'POSTPONED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "EventType" AS ENUM ('SCHEDULED', 'STATUS_CHANGED', 'POSTPONED', 'REOPENED', 'CANCELLED', 'PLAN_CONFIRMED', 'PLAN_REOPENED', 'ARCHIVED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "SchoolYear" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  CONSTRAINT "SchoolYear_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolYear_dates_check" CHECK ("endDate" > "startDate")
);
CREATE UNIQUE INDEX "SchoolYear_label_startDate_key" ON "SchoolYear"("label", "startDate");

CREATE TABLE "Classroom" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "schoolYearId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "academyCode" TEXT NOT NULL,
  "zoneCode" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Classroom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Classroom_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Classroom_ownerId_archivedAt_idx" ON "Classroom"("ownerId", "archivedAt");

CREATE TABLE "ClassroomLevel" (
  "classroomId" TEXT NOT NULL,
  "level" "Level" NOT NULL,
  CONSTRAINT "ClassroomLevel_pkey" PRIMARY KEY ("classroomId", "level"),
  CONSTRAINT "ClassroomLevel_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ClassroomDay" (
  "classroomId" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  CONSTRAINT "ClassroomDay_pkey" PRIMARY KEY ("classroomId", "weekday"),
  CONSTRAINT "ClassroomDay_weekday_check" CHECK ("weekday" BETWEEN 1 AND 5),
  CONSTRAINT "ClassroomDay_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Subject" (
  "id" TEXT NOT NULL,
  "classroomId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "Subject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Subject_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Subject_classroomId_name_key" ON "Subject"("classroomId", "name");
CREATE INDEX "Subject_classroomId_active_sortOrder_idx" ON "Subject"("classroomId", "active", "sortOrder");

CREATE TABLE "Sequence" (
  "id" TEXT NOT NULL,
  "classroomId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "targetPeriod" "Period" NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Sequence_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Sequence_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Sequence_classroomId_targetPeriod_sortOrder_idx" ON "Sequence"("classroomId", "targetPeriod", "sortOrder");

CREATE TABLE "SequenceLevel" (
  "sequenceId" TEXT NOT NULL,
  "level" "Level" NOT NULL,
  "optionalObjective" TEXT,
  CONSTRAINT "SequenceLevel_pkey" PRIMARY KEY ("sequenceId", "level"),
  CONSTRAINT "SequenceLevel_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Lesson" (
  "id" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "estimatedMinutes" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Lesson_estimatedMinutes_check" CHECK ("estimatedMinutes" > 0),
  CONSTRAINT "Lesson_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Lesson_sequenceId_sortOrder_idx" ON "Lesson"("sequenceId", "sortOrder");

CREATE TABLE "LessonLevel" (
  "lessonId" TEXT NOT NULL,
  "level" "Level" NOT NULL,
  "optionalObjective" TEXT,
  "optionalNotes" TEXT,
  CONSTRAINT "LessonLevel_pkey" PRIMARY KEY ("lessonId", "level"),
  CONSTRAINT "LessonLevel_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WeeklyPlan" (
  "id" TEXT NOT NULL,
  "classroomId" TEXT NOT NULL,
  "weekStartDate" DATE NOT NULL,
  "state" "PlanState" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "confirmedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeeklyPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeeklyPlan_monday_check" CHECK (EXTRACT(ISODOW FROM "weekStartDate") = 1),
  CONSTRAINT "WeeklyPlan_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WeeklyPlan_classroomId_weekStartDate_key" ON "WeeklyPlan"("classroomId", "weekStartDate");

CREATE TABLE "LessonSchedule" (
  "id" TEXT NOT NULL,
  "weeklyPlanId" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "state" "ScheduleState" NOT NULL DEFAULT 'ACTIVE',
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "remainingMinutes" INTEGER,
  CONSTRAINT "LessonSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LessonSchedule_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LessonSchedule_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LessonSchedule_weeklyPlanId_lessonId_key" ON "LessonSchedule"("weeklyPlanId", "lessonId");
CREATE INDEX "LessonSchedule_lessonId_state_idx" ON "LessonSchedule"("lessonId", "state");
CREATE UNIQUE INDEX "LessonSchedule_one_active_per_lesson" ON "LessonSchedule"("lessonId") WHERE "state" = 'ACTIVE';

CREATE TABLE "LessonProgress" (
  "lessonId" TEXT NOT NULL,
  "level" "Level" NOT NULL,
  "state" "ProgressState" NOT NULL DEFAULT 'NOT_STARTED',
  "completedMinutes" INTEGER,
  "notes" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("lessonId", "level"),
  CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LessonEvent" (
  "id" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "actorId" TEXT NOT NULL,
  "eventType" "EventType" NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LessonEvent_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonEvent_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "LessonSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LessonEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LessonEvent_lessonId_createdAt_idx" ON "LessonEvent"("lessonId", "createdAt");

CREATE TABLE "CalendarException" (
  "id" TEXT NOT NULL,
  "classroomId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "isTeachingDay" BOOLEAN NOT NULL,
  "reason" TEXT,
  CONSTRAINT "CalendarException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarException_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CalendarException_classroomId_date_key" ON "CalendarException"("classroomId", "date");

CREATE TABLE "SchoolCalendarCache" (
  "id" TEXT NOT NULL,
  "academyCode" TEXT NOT NULL,
  "schoolYear" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload" JSONB NOT NULL,
  CONSTRAINT "SchoolCalendarCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolCalendarCache_academyCode_schoolYear_key" ON "SchoolCalendarCache"("academyCode", "schoolYear");