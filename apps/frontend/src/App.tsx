import { FormEvent, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const apiBase = import.meta.env.VITE_BFF_URL ?? 'http://localhost:3000';
const levels = ['CP', 'CE1', 'CE2', 'CM1', 'CM2'] as const;
const periods = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
const weekdays = [
  { value: 1, label: 'Lundi' }, { value: 2, label: 'Mardi' }, { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' }, { value: 5, label: 'Vendredi' },
];

type Level = typeof levels[number];
type User = { id: string; email: string };
type Classroom = { id: string; name: string; levels: { level: Level }[]; schoolYear: { label: string } };
type Subject = { id: string; name: string };
type Lesson = {
  id: string; title: string; estimatedMinutes: number; levels: { level: Level }[];
  progress?: { level: Level; state: string; completedMinutes?: number | null; notes?: string | null }[];
  sequence: { id: string; title: string; targetPeriod: string; subject: { name: string } };
};
type Sequence = {
  id: string; title: string; description?: string | null; targetPeriod: string;
  levels: { level: Level; optionalObjective?: string | null }[]; subject: Subject; lessons: Lesson[];
};
type Schedule = { id: string; lesson: Lesson };
type Plan = { id: string | null; state: 'DRAFT' | 'CONFIRMED'; version: number; schedules: Schedule[] };
type LessonEvent = { id: string; eventType: string; createdAt: string; payload: Record<string, unknown> };
type CalendarData = {
  weeks: { startDate: string; teachingDays: string[]; shortened: boolean }[];
  exceptions: { id: string; date: string; isTeachingDay: boolean; reason?: string | null }[];
  limitation: string | null;
};
type ProgressData = {
  sequenceId: string; title: string; subject: string; targetPeriod: string;
  overall: { plannedMinutes: number | null; completedMinutes: number | null; percentage: number | null };
  levels: { level: Level; percentage: number | null }[];
};

function reviewFormDefaults(plan: Plan) {
  const states: Record<string, string> = {};
  const details: Record<string, boolean> = {};
  const levels: Record<string, Record<string, string>> = {};
  const remaining: Record<string, string> = {};
  const notes: Record<string, string> = {};
  const levelRemaining: Record<string, Record<string, string>> = {};
  const levelNotes: Record<string, Record<string, string>> = {};
  for (const { lesson } of plan.schedules) {
    const levelStates = lesson.levels.map(({ level }) => lesson.progress?.find((progress) => progress.level === level)?.state ?? 'NOT_STARTED');
    const mixed = new Set(levelStates).size > 1;
    states[lesson.id] = mixed ? 'NOT_STARTED' : levelStates[0] ?? 'NOT_STARTED';
    details[lesson.id] = mixed;
    levels[lesson.id] = Object.fromEntries(lesson.levels.map(({ level }) => [level, lesson.progress?.find((progress) => progress.level === level)?.state ?? 'NOT_STARTED']));
    levelRemaining[lesson.id] = Object.fromEntries(lesson.levels.flatMap(({ level }) => {
      const progress = lesson.progress?.find((item) => item.level === level);
      return progress?.state === 'PARTIAL' && progress.completedMinutes !== null && progress.completedMinutes !== undefined
        ? [[level, String(Math.max(0, lesson.estimatedMinutes - progress.completedMinutes))] as const]
        : [];
    }));
    levelNotes[lesson.id] = Object.fromEntries(lesson.levels.flatMap(({ level }) => {
      const value = lesson.progress?.find((item) => item.level === level)?.notes;
      return value ? [[level, value] as const] : [];
    }));
    const partials = lesson.levels.map(({ level }) => lesson.progress?.find((item) => item.level === level)).filter((item) => item?.state === 'PARTIAL');
    if (partials.length && partials.every((item) => item?.completedMinutes !== null && item?.completedMinutes !== undefined)) {
      const completed = partials.reduce((sum, item) => sum + (item?.completedMinutes ?? 0), 0) / partials.length;
      remaining[lesson.id] = String(Math.max(0, lesson.estimatedMinutes - Math.round(completed)));
    }
    const sharedNote = lesson.levels.map(({ level }) => lesson.progress?.find((item) => item.level === level)?.notes).find(Boolean);
    if (sharedNote) notes[lesson.id] = sharedNote;
  }
  return { states, details, levels, remaining, notes, levelRemaining, levelNotes };
}

function describeEvent(event: LessonEvent) {
  if (event.eventType === 'STATUS_CHANGED') {
    const level = typeof event.payload.level === 'string' ? `${event.payload.level} · ` : '';
    const previous = typeof event.payload.previous === 'string' ? event.payload.previous : 'Non commencée';
    const state = typeof event.payload.state === 'string' ? event.payload.state : 'modifiée';
    return `${level}${previous} → ${state}`;
  }
  const labels: Record<string, string> = {
    SCHEDULED: 'Séance ajoutée à une semaine',
    POSTPONED: 'Séance reportée',
    REOPENED: 'Affectation réouverte',
    CANCELLED: 'Séance annulée',
    PLAN_CONFIRMED: 'Semaine confirmée',
    PLAN_REOPENED: 'Semaine réouverte',
    ARCHIVED: 'Séance archivée',
  };
  return labels[event.eventType] ?? event.eventType;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? 'Une erreur est survenue.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function mondayOf(date: Date) {
  const monday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return monday.toISOString().slice(0, 10);
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { register: registerField, handleSubmit } = useForm<{ email: string; password: string }>();

  async function submit(values: { email: string; password: string }) {
    setErrorMessage('');
    setBusy(true);
    try {
      const user = await api<User>(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST', body: JSON.stringify(values),
      });
      onLogin(user);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-copy">
      <a className="wordmark" href="/">instit<span>planit</span></a>
      <div className="auth-illustration" aria-hidden="true">
        <div className="paper paper-back"><i /><i /><i /></div>
        <div className="paper paper-front"><b>SEMAINE</b><strong>12</strong><span>CE2 + CM1</span><i /><i /></div>
        <div className="sun-mark">+</div>
      </div>
      <p className="auth-caption">Une classe, plusieurs niveaux.<br />Un programme qui tient ensemble.</p>
    </section>
    <section className="auth-form-wrap">
      <div className="auth-form-card">
        <p className="eyebrow">VOTRE ESPACE ENSEIGNANT</p>
        <h1>{register ? 'Créer mon espace' : 'Ravi·e de vous revoir'}</h1>
        <p className="muted">{register ? 'La préparation commence ici.' : 'Reprenez votre fil pédagogique.'}</p>
        <form className="form-stack" onSubmit={handleSubmit(submit)}>
          <label>Adresse e-mail<input type="email" autoComplete="email" {...registerField('email', { required: true })} /></label>
          <label>Mot de passe<input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} {...registerField('password', { required: true, minLength: 12 })} /></label>
          {register && <small className="field-note">12 caractères minimum.</small>}
          {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Un instant…' : register ? 'Créer mon compte' : 'Se connecter'} <span aria-hidden="true">↗</span></button>
        </form>
        <p className="auth-switch">{register ? 'Déjà inscrit·e ?' : 'Première visite ?'} <button type="button" className="text-button" onClick={() => { setRegister(!register); setErrorMessage(''); }}>{register ? 'Se connecter' : 'Créer un compte'}</button></p>
      </div>
    </section>
  </main>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [available, setAvailable] = useState<Lesson[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [progress, setProgress] = useState<ProgressData[]>([]);
  const [reviewStates, setReviewStates] = useState<Record<string, string>>({});
  const [reviewDetails, setReviewDetails] = useState<Record<string, boolean>>({});
  const [reviewLevels, setReviewLevels] = useState<Record<string, Record<string, string>>>({});
  const [reviewRemaining, setReviewRemaining] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewLevelRemaining, setReviewLevelRemaining] = useState<Record<string, Record<string, string>>>({});
  const [reviewLevelNotes, setReviewLevelNotes] = useState<Record<string, Record<string, string>>>({});
  const [lessonHistory, setLessonHistory] = useState<Record<string, LessonEvent[]>>({});
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [week, setWeek] = useState(mondayOf(new Date()));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filterSubject, setFilterSubject] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: () => api<User>('/me'), retry: false });
  const currentPage = location.pathname.startsWith('/planning') ? 'planning'
    : location.pathname.startsWith('/programmation') ? 'programmation'
    : location.pathname.startsWith('/calendrier') ? 'calendrier' : 'accueil';

  async function refresh(nextClassroomId?: string) {
    const rows = await api<Classroom[]>('/classrooms');
    setClassrooms(rows);
    const active = rows.find((row) => row.id === (nextClassroomId ?? classroom?.id)) ?? rows[0] ?? null;
    setClassroom(active);
    if (!active) {
      setSubjects([]); setSequences([]); setAvailable([]); setPlan(null); setCalendar(null); setProgress([]);
      return;
    }
    const [subjectRows, sequenceRows, lessonRows, weekPlan, calendarData, progressRows] = await Promise.all([
      api<Subject[]>(`/classrooms/${active.id}/subjects`),
      api<Sequence[]>(`/classrooms/${active.id}/sequences`),
      api<Lesson[]>(`/classrooms/${active.id}/available-lessons`),
      api<Plan>(`/classrooms/${active.id}/weeks/${week}`),
      api<CalendarData>(`/classrooms/${active.id}/calendar`),
      api<ProgressData[]>(`/classrooms/${active.id}/progress`),
    ]);
    setSubjects(subjectRows); setSequences(sequenceRows); setAvailable(lessonRows); setPlan(weekPlan);
    setCalendar(calendarData); setProgress(progressRows);
    setSelectedIds(weekPlan.schedules.map(({ lesson }) => lesson.id));
    const defaults = reviewFormDefaults(weekPlan);
    setReviewStates(defaults.states); setReviewDetails(defaults.details); setReviewLevels(defaults.levels);
    setReviewRemaining(defaults.remaining); setReviewNotes(defaults.notes);
    setReviewLevelRemaining(defaults.levelRemaining); setReviewLevelNotes(defaults.levelNotes);
  }

  useEffect(() => {
    if (profileQuery.isPending) return;
    if (profileQuery.data) {
      setUser(profileQuery.data);
      refresh().catch((error) => setErrorMessage(error instanceof Error ? error.message : 'Chargement impossible.'))
        .finally(() => setLoading(false));
      return;
    }
    setUser(null);
    setLoading(false);
  }, [profileQuery.data, profileQuery.isPending, profileQuery.isError]);

  useEffect(() => {
    if (!user || !classroom) return;
    api<Plan>(`/classrooms/${classroom.id}/weeks/${week}`).then((weekPlan) => {
      setPlan(weekPlan); setSelectedIds(weekPlan.schedules.map(({ lesson }) => lesson.id));
      const defaults = reviewFormDefaults(weekPlan);
      setReviewStates(defaults.states); setReviewDetails(defaults.details); setReviewLevels(defaults.levels);
      setReviewRemaining(defaults.remaining); setReviewNotes(defaults.notes);
      setReviewLevelRemaining(defaults.levelRemaining); setReviewLevelNotes(defaults.levelNotes);
    }).catch((error) => setErrorMessage(error instanceof Error ? error.message : 'Chargement de la semaine impossible.'));
  }, [week, classroom?.id, user?.id]);

  async function withFeedback(action: () => Promise<void>, successMessage?: string) {
    setErrorMessage(''); setNotice(''); setBusy(true);
    try { await action(); if (successMessage) setNotice(successMessage); }
    catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Une erreur est survenue.'); }
    finally { setBusy(false); }
  }

  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedLevels = levels.filter((level) => data.getAll('levels').includes(level));
    const selectedDays = weekdays.filter((day) => data.getAll('weekdays').includes(String(day.value))).map(({ value }) => value);
    await withFeedback(async () => {
      const newClass = await api<Classroom>('/classrooms', {
        method: 'POST', body: JSON.stringify({
          name: data.get('name'), schoolYearLabel: data.get('schoolYearLabel'),
          startDate: data.get('startDate'), endDate: data.get('endDate'),
          academyCode: data.get('academyCode'), levels: selectedLevels, weekdays: selectedDays,
        }),
      });
      await refresh(newClass.id);
      navigate('/programmation');
    }, 'Classe créée. La programmation peut commencer.');
  }

  async function createSequence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroom) return;
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const selectedLevels = levels.filter((level) => data.getAll('levels').includes(level));
    await withFeedback(async () => {
      await api(`/classrooms/${classroom.id}/sequences`, {
        method: 'POST', body: JSON.stringify({
          subjectId: data.get('subjectId'), title: data.get('title'),
          description: data.get('description') || undefined, targetPeriod: data.get('targetPeriod'), levels: selectedLevels,
        }),
      });
      formElement.reset();
      await refresh();
    }, 'Séquence ajoutée à la programmation.');
  }

  async function createLesson(event: FormEvent<HTMLFormElement>, sequence: Sequence) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const selectedLevels = sequence.levels.map(({ level }) => level).filter((level) => data.getAll('levels').includes(level));
    await withFeedback(async () => {
      await api(`/sequences/${sequence.id}/lessons`, {
        method: 'POST', body: JSON.stringify({ title: data.get('title'), estimatedMinutes: Number(data.get('minutes')), levels: selectedLevels }),
      });
      formElement.reset();
      await refresh();
    }, 'Séance ajoutée.');
  }

  async function editSequence(event: FormEvent<HTMLFormElement>, sequence: Sequence) {
    event.preventDefault();
    if (!classroom) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    await withFeedback(async () => {
      await api(`/sequences/${sequence.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: data.get('title'), description: data.get('description') || null, targetPeriod: data.get('targetPeriod') }),
      });
      await refresh();
    }, 'Séquence modifiée.');
  }

  async function editLesson(event: FormEvent<HTMLFormElement>, lesson: Lesson) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await withFeedback(async () => {
      await api(`/lessons/${lesson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: data.get('title'), estimatedMinutes: Number(data.get('minutes')) }),
      });
      await refresh();
    }, 'Séance modifiée.');
  }

  async function archiveSequence(sequence: Sequence) {
    if (!window.confirm(`Archiver « ${sequence.title} » ? Son historique sera conservé.`)) return;
    await withFeedback(async () => {
      await api(`/sequences/${sequence.id}`, { method: 'DELETE' });
      await refresh();
    }, 'Séquence archivée.');
  }

  async function archiveLesson(lesson: Lesson) {
    if (!window.confirm(`Archiver « ${lesson.title} » ? Son historique sera conservé.`)) return;
    await withFeedback(async () => {
      await api(`/lessons/${lesson.id}`, { method: 'DELETE' });
      await refresh();
    }, 'Séance archivée.');
  }

  async function toggleLessonHistory(lessonId: string) {
    if (openHistory[lessonId]) {
      setOpenHistory((opened) => ({ ...opened, [lessonId]: false }));
      return;
    }
    if (!lessonHistory[lessonId]) {
      try {
        const events = await api<LessonEvent[]>(`/lessons/${lessonId}/history`);
        setLessonHistory((history) => ({ ...history, [lessonId]: events }));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Historique indisponible.');
        return;
      }
    }
    setOpenHistory((opened) => ({ ...opened, [lessonId]: true }));
  }

  async function saveWeek(confirm = false) {
    if (!classroom || !plan) return;
    await withFeedback(async () => {
      const saved = await api<Plan>(`/classrooms/${classroom.id}/weeks/${week}`, {
        method: 'PUT', body: JSON.stringify({ lessonIds: selectedIds, version: plan.version }),
      });
      setPlan(saved);
      if (confirm) {
        const confirmed = await api<Plan>(`/classrooms/${classroom.id}/weeks/${week}/confirm`, { method: 'POST' });
        setPlan(confirmed);
      }
      await refresh();
    }, confirm ? 'Semaine confirmée.' : 'Brouillon enregistré.');
  }

  async function submitReview() {
    if (!classroom || !plan) return;
    await withFeedback(async () => {
      await api(`/classrooms/${classroom.id}/weeks/${week}/review`, {
        method: 'POST',
        body: JSON.stringify({
          version: plan.version,
          lessons: plan.schedules.map(({ lesson }) => {
            const remaining = reviewRemaining[lesson.id];
            return {
              lessonId: lesson.id,
              state: reviewStates[lesson.id] ?? 'NOT_STARTED',
              ...(remaining === undefined || remaining === '' ? {} : { completedMinutes: Math.max(0, lesson.estimatedMinutes - Number(remaining)) }),
              ...(reviewNotes[lesson.id] ? { notes: reviewNotes[lesson.id] } : {}),
              ...(reviewDetails[lesson.id] ? {
                levels: Object.fromEntries(lesson.levels.map(({ level }) => {
                  const levelRemaining = reviewLevelRemaining[lesson.id]?.[level] ?? reviewRemaining[lesson.id];
                  const notes = reviewLevelNotes[lesson.id]?.[level] ?? reviewNotes[lesson.id];
                  return [level, {
                    state: reviewLevels[lesson.id]?.[level] ?? reviewStates[lesson.id] ?? 'NOT_STARTED',
                    ...(levelRemaining === undefined || levelRemaining === '' ? {} : { completedMinutes: Math.max(0, lesson.estimatedMinutes - Number(levelRemaining)) }),
                    ...(notes ? { notes } : {}),
                  }];
                })),
              } : {}),
            };
          }),
        }),
      });
      setReviewStates({}); setReviewDetails({}); setReviewLevels({}); setReviewRemaining({}); setReviewNotes({}); setReviewLevelRemaining({}); setReviewLevelNotes({});
      await refresh();
    }, 'Bilan enregistré. Les séances inachevées sont disponibles pour reprise.');
  }

  async function reopenWeek() {
    if (!classroom) return;
    await withFeedback(async () => {
      await api(`/classrooms/${classroom.id}/weeks/${week}/reopen`, { method: 'POST' });
      await refresh();
    }, 'Semaine réouverte. Les affectations et leur historique sont conservés.');
  }

  async function saveCalendarException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classroom) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    await withFeedback(async () => {
      await api(`/classrooms/${classroom.id}/calendar/exceptions`, {
        method: 'POST',
        body: JSON.stringify({
          date: data.get('date'),
          isTeachingDay: data.get('isTeachingDay') === 'true',
          reason: data.get('reason') || undefined,
        }),
      });
      form.reset();
      await refresh();
    }, 'Exception de calendrier enregistrée.');
  }

  async function deleteCalendarException(date: string) {
    if (!classroom) return;
    await withFeedback(async () => {
      await api(`/classrooms/${classroom.id}/calendar/exceptions/${date}`, { method: 'DELETE' });
      await refresh();
    }, 'Exception supprimée.');
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null); setClassroom(null); navigate('/');
  }

  if (loading) return <div className="loading-screen"><span className="loader-mark">i</span><p>Ouverture du cahier…</p></div>;
  if (!user) return <AuthScreen onLogin={async (profile) => { setUser(profile); setLoading(true); await refresh(); setLoading(false); }} />;

  const totalMinutes = selectedIds.reduce((total, id) => total + (available.find((lesson) => lesson.id === id)?.estimatedMinutes ?? plan?.schedules.find((schedule) => schedule.lesson.id === id)?.lesson.estimatedMinutes ?? 0), 0);
  const filteredAvailable = available.filter((lesson) =>
    (!filterSubject || lesson.sequence.subject.name === filterSubject)
    && (!filterPeriod || lesson.sequence.targetPeriod === filterPeriod)
    && (!filterLevel || lesson.levels.some(({ level }) => level === filterLevel)),
  );

  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="wordmark">instit<span>planit</span></Link>
      <div className="class-switcher">
        {classrooms.length ? <select aria-label="Classe active" value={classroom?.id ?? ''} onChange={(event) => refresh(event.target.value)}>
          {classrooms.map((row) => <option value={row.id} key={row.id}>{row.name} · {row.levels.map(({ level }) => level).join(' / ')}</option>)}
        </select> : <span>Mon espace</span>}
      </div>
      <div className="account-menu"><span className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</span><span className="account-email">{user.email}</span><button className="icon-button" title="Se déconnecter" aria-label="Se déconnecter" onClick={logout}>↗</button></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <p className="sidebar-label">MON ANNÉE</p>
        <nav className="side-nav" aria-label="Navigation principale">
          <Link className={currentPage === 'accueil' ? 'active' : ''} to="/"><span>⌂</span> Vue d’ensemble</Link>
          <Link className={currentPage === 'programmation' ? 'active' : ''} to="/programmation"><span>▤</span> Programmation</Link>
          <Link className={currentPage === 'planning' ? 'active' : ''} to="/planning"><span>◷</span> Semaine</Link>
          <Link className={currentPage === 'calendrier' ? 'active' : ''} to="/calendrier"><span>▦</span> Calendrier</Link>
        </nav>
        <div className="sidebar-bottom"><span className="sync-dot" /> Données enregistrées<br /><small>dans votre espace privé</small></div>
      </aside>
      <main className="main-content">
        <div className="page-heading">
          <div><p className="eyebrow">{classroom?.schoolYear.label ?? 'ANNÉE SCOLAIRE'}{classroom ? ` · ${classroom.name}` : ''}</p>
            <h1>{currentPage === 'planning' ? 'La semaine, à votre façon.' : currentPage === 'programmation' ? 'Le fil de l’année.' : currentPage === 'calendrier' ? 'Le rythme de l’année.' : 'Bonjour, professeur·e.'}</h1>
            <p className="muted">{currentPage === 'planning' ? 'Choisissez les séances qui feront votre semaine.' : currentPage === 'programmation' ? 'Des séquences communes, des chemins qui s’adaptent.' : currentPage === 'calendrier' ? 'Jours de classe, semaines raccourcies et exceptions.' : 'Votre classe multiniveau, un seul espace de préparation.'}</p>
          </div>
          {classroom && <div className="level-stamp">{classroom.levels.map(({ level }) => <span key={level}>{level}</span>)}</div>}
        </div>
        {(errorMessage || notice) && <div className={errorMessage ? 'notice notice-error' : 'notice notice-success'} role="status">{errorMessage || notice}<button onClick={() => { setErrorMessage(''); setNotice(''); }} aria-label="Fermer">×</button></div>}
        {!classroom ? <section className="setup-section">
          <div className="section-intro"><span className="step-number">01</span><div><h2>Posons le cadre de la classe</h2><p>Une seule configuration pour tous les niveaux réunis.</p></div></div>
          <form className="setup-form" onSubmit={createClass}>
            <label>Nom de la classe<input name="name" placeholder="Ex. La classe des explorateurs" required /></label>
            <div className="form-grid form-grid-three">
              <label>Année scolaire<input name="schoolYearLabel" placeholder="2026-2027" pattern="\d{4}-\d{4}" required /></label>
              <label>Début<input name="startDate" type="date" required /></label>
              <label>Fin<input name="endDate" type="date" required /></label>
            </div>
            <label>Académie (code)<input name="academyCode" placeholder="Ex. PAR" required /></label>
            <fieldset><legend>Niveaux réunis</legend><div className="choice-row">{levels.map((level) => <label className="check-choice" key={level}><input name="levels" value={level} type="checkbox" /><span>{level}</span></label>)}</div></fieldset>
            <fieldset><legend>Jours de classe habituels</legend><div className="choice-row">{weekdays.map(({ value, label }) => <label className="check-choice" key={value}><input name="weekdays" value={value} type="checkbox" defaultChecked={value !== 3} /><span>{label}</span></label>)}</div></fieldset>
            <button disabled={busy} className="button button-primary">Créer la classe <span>↗</span></button>
          </form>
        </section> : currentPage === 'programmation' ? <>
          <section className="section-block">
            <div className="section-title-row"><div><p className="eyebrow">CONSTRUIRE LE PROGRAMME</p><h2>Nouvelle séquence</h2></div><span className="quiet-count">{sequences.length} séquence{sequences.length === 1 ? '' : 's'}</span></div>
            <form className="sequence-form" onSubmit={createSequence}>
              <label className="field-wide">Titre de la séquence<input name="title" placeholder="Ex. Le groupe nominal" required /></label>
              <label>Matière<select name="subjectId" required defaultValue=""><option value="" disabled>Choisir…</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
              <label>Période<select name="targetPeriod" defaultValue="P1">{periods.map((period) => <option key={period}>{period}</option>)}</select></label>
              <label className="field-wide">Intention pédagogique <textarea name="description" rows={2} placeholder="Quelques mots pour garder le cap…" /></label>
              <fieldset className="field-wide"><legend>Niveaux concernés</legend><div className="choice-row">{classroom.levels.map(({ level }) => <label className="check-choice" key={level}><input name="levels" value={level} type="checkbox" defaultChecked /><span>{level}</span></label>)}</div></fieldset>
              <button disabled={busy} className="button button-primary">Ajouter la séquence <span>＋</span></button>
            </form>
          </section>
          <section className="program-list">
            <div className="section-title-row"><div><p className="eyebrow">PROGRAMMATION ANNUELLE</p><h2>Les séquences</h2></div><span className="quiet-count">Une séquence commune n’apparaît qu’une fois</span></div>
            {sequences.length === 0 ? <div className="empty-state"><span>✳</span><h3>Le programme commence ici</h3><p>Créez une séquence commune ou ciblée pour votre classe.</p></div> : <div className="sequence-list">{sequences.map((sequence, index) => <article className="sequence-row" key={sequence.id}>
              <div className="sequence-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="sequence-body"><div className="sequence-meta"><span>{sequence.subject.name}</span><span>{sequence.targetPeriod}</span><span>{sequence.levels.map(({ level }) => level).join(' + ')}</span></div><h3>{sequence.title}</h3>{sequence.description && <p>{sequence.description}</p>}
                <details className="edit-details"><summary>Modifier la séquence</summary><form className="edit-sequence-form" onSubmit={(event) => editSequence(event, sequence)}><label>Titre<input name="title" defaultValue={sequence.title} required /></label><label>Période<select name="targetPeriod" defaultValue={sequence.targetPeriod}>{periods.map((period) => <option key={period}>{period}</option>)}</select></label><label className="edit-description">Intention<textarea name="description" defaultValue={sequence.description ?? ''} rows={2} /></label><button className="button button-primary">Enregistrer</button><button type="button" className="text-button archive-action" onClick={() => archiveSequence(sequence)}>Archiver la séquence</button></form></details>
                <div className="lesson-list">{sequence.lessons.map((lesson) => <div className="lesson-entry" key={lesson.id}><div className="lesson-line"><span className="lesson-bullet" /> <span>{lesson.title}</span><small>{lesson.estimatedMinutes} min</small><span className="lesson-levels">{lesson.levels.map(({ level }) => level).join(' + ')}</span><details className="lesson-edit"><summary aria-label={`Modifier ${lesson.title}`} title="Modifier ou archiver">···</summary><form onSubmit={(event) => editLesson(event, lesson)}><label>Titre<input name="title" defaultValue={lesson.title} required /></label><label>Durée en minutes<input name="minutes" type="number" min="1" max="600" defaultValue={lesson.estimatedMinutes} required /></label><button className="button button-primary">Enregistrer</button><button type="button" className="text-button archive-action" onClick={() => archiveLesson(lesson)}>Archiver la séance</button><button type="button" className="text-button history-action" onClick={() => toggleLessonHistory(lesson.id)}>{openHistory[lesson.id] ? 'Masquer l’historique' : 'Consulter l’historique'}</button>{openHistory[lesson.id] && <div className="history-list">{lessonHistory[lesson.id]?.length ? lessonHistory[lesson.id].map((event) => <div className="history-event" key={event.id}><strong>{describeEvent(event)}</strong><time>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(event.createdAt))}</time></div>) : <p>Aucun événement enregistré.</p>}</div>}</form></details></div></div>)}
                  <form className="inline-lesson-form" onSubmit={(event) => createLesson(event, sequence)}><input name="title" aria-label="Titre de la séance" placeholder="Ajouter une séance…" required /><input name="minutes" aria-label="Durée estimée en minutes" type="number" min="1" max="600" defaultValue="45" required /><span className="minute-label">min</span>{sequence.levels.map(({ level }, index) => <label key={level} className="mini-check"><input type="checkbox" name="levels" value={level} defaultChecked={index === 0} />{level}</label>)}<button className="icon-button" title="Ajouter la séance" aria-label="Ajouter la séance">＋</button></form>
                </div>
              </div>
            </article>)}</div>}
          </section>
        </> : currentPage === 'planning' ? <section className="planner-section">
          <div className="week-toolbar"><div className="week-picker"><button className="icon-button" aria-label="Semaine précédente" onClick={() => { const date = new Date(`${week}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 7); setWeek(date.toISOString().slice(0, 10)); }}>←</button><div><span className="eyebrow">SEMAINE DU</span><input aria-label="Lundi de la semaine" type="date" value={week} onChange={(event) => setWeek(mondayOf(new Date(`${event.target.value}T00:00:00`)))} /></div><button className="icon-button" aria-label="Semaine suivante" onClick={() => { const date = new Date(`${week}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 7); setWeek(date.toISOString().slice(0, 10)); }}>→</button></div><span className={`plan-status ${plan?.state === 'CONFIRMED' ? 'confirmed' : ''}`}><i />{plan?.state === 'CONFIRMED' ? 'Semaine confirmée' : 'Brouillon'}</span></div>
          <div className="planner-columns">
            <div className="catalog-column"><div className="section-title-row"><div><p className="eyebrow">À VOTRE DISPOSITION</p><h2>Les séances</h2></div><span className="count-badge">{filteredAvailable.length}</span></div>
              <div className="catalog-filters"><label>Matière<select value={filterSubject} onChange={(event) => setFilterSubject(event.target.value)}><option value="">Toutes</option>{subjects.map((subject) => <option key={subject.id} value={subject.name}>{subject.name}</option>)}</select></label><label>Niveau<select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value)}><option value="">Tous</option>{classroom?.levels.map(({ level }) => <option key={level}>{level}</option>)}</select></label><label>Période<select value={filterPeriod} onChange={(event) => setFilterPeriod(event.target.value)}><option value="">Toutes</option>{periods.map((period) => <option key={period}>{period}</option>)}</select></label></div>
              {available.length === 0 ? <div className="empty-state compact"><span>✓</span><h3>Tout est planifié</h3><p>Ajoutez d’abord des séances à votre programmation.</p><Link className="text-button" to="/programmation">Voir la programmation ↗</Link></div> : filteredAvailable.length === 0 ? <div className="empty-state compact"><span>⌕</span><h3>Aucune séance pour ces filtres</h3><p>Essayez un autre niveau, une autre matière ou une autre période.</p></div> : <div className="catalog-list">{filteredAvailable.map((lesson) => <label className={`catalog-item ${selectedIds.includes(lesson.id) ? 'is-selected' : ''}`} key={lesson.id}><input type="checkbox" checked={selectedIds.includes(lesson.id)} disabled={plan?.state === 'CONFIRMED'} onChange={() => setSelectedIds((ids) => ids.includes(lesson.id) ? ids.filter((id) => id !== lesson.id) : [...ids, lesson.id])} /><span className="catalog-check" /><span className="catalog-copy"><small>{lesson.sequence.subject.name} · {lesson.sequence.targetPeriod}</small><strong>{lesson.title}</strong><span>{lesson.sequence.title}</span><em>{lesson.levels.map(({ level }) => level).join(' + ')}</em></span><span className="catalog-duration">{lesson.estimatedMinutes}<small>min</small></span></label>)}</div>}
            </div>
            <div className="week-column"><div className="section-title-row"><div><p className="eyebrow">SÉLECTION MANUELLE</p><h2>Votre semaine</h2></div><span className="count-badge count-dark">{selectedIds.length}</span></div>
              {selectedIds.length === 0 ? <div className="selection-empty"><span>＋</span><p>Choisissez une séance dans la liste pour composer votre semaine.</p></div> : <div className="selected-list">{selectedIds.map((id) => {
                const lesson = available.find((item) => item.id === id) ?? plan?.schedules.find((schedule) => schedule.lesson.id === id)?.lesson;
                if (!lesson) return null;
                return <div className="selected-item" key={lesson.id}><div className="selected-marker">{lesson.sequence.subject.name.slice(0, 1)}</div><div className="selected-copy"><strong>{lesson.title}</strong><span>{lesson.sequence.subject.name} · {lesson.levels.map(({ level }) => level).join(' + ')}</span></div><span className="selected-minutes">{lesson.estimatedMinutes}′</span>{plan?.state !== 'CONFIRMED' && <button className="icon-button remove-button" title="Retirer de la semaine" aria-label={`Retirer ${lesson.title}`} onClick={() => setSelectedIds((ids) => ids.filter((itemId) => itemId !== id))}>×</button>}</div>;
              })}</div>}
              <div className="week-total"><span>Charge prévue <small>séances mutualisées comptées une seule fois</small></span><strong>{Math.floor(totalMinutes / 60)}h{String(totalMinutes % 60).padStart(2, '0')}</strong></div>
              <div className="week-actions">{plan?.state === 'CONFIRMED' ? plan.schedules.length > 0 ? <><button className="button button-outline" disabled={busy} onClick={reopenWeek}>Réouvrir le planning</button><button className="button button-primary" disabled={busy} onClick={submitReview}>Enregistrer le bilan <span>↗</span></button></> : <><p className="review-complete">Bilan enregistré · les affectations sont conservées dans l’historique.</p><button className="button button-outline" disabled={busy} onClick={reopenWeek}>Réouvrir pour corriger</button></> : <><button className="button button-outline" disabled={busy} onClick={() => saveWeek(false)}>Enregistrer le brouillon</button><button className="button button-primary" disabled={busy || selectedIds.length === 0} onClick={() => saveWeek(true)}>Confirmer la semaine <span>↗</span></button></>}</div>
              {plan?.state === 'CONFIRMED' && plan.schedules.length > 0 && <div className="review-panel">
                <p className="eyebrow">BILAN DE LA SEMAINE</p>
                {plan.schedules.map(({ lesson }) => <div className="review-card" key={lesson.id}>
                  <label className="review-line"><span>{lesson.title}<small>{lesson.levels.map(({ level }) => level).join(' + ')}</small></span>
                    <select aria-label={`Avancement de ${lesson.title}`} value={reviewStates[lesson.id] ?? 'NOT_STARTED'} onChange={(event) => setReviewStates((states) => ({ ...states, [lesson.id]: event.target.value }))}><option value="DONE">Terminée</option><option value="PARTIAL">Partielle</option><option value="NOT_STARTED">Non commencée</option><option value="CANCELLED">Annulée</option></select>
                  </label>
                  {!reviewDetails[lesson.id] && reviewStates[lesson.id] === 'PARTIAL' && <div className="review-extra"><label>Durée restante<input type="number" min="0" max={lesson.estimatedMinutes} value={reviewRemaining[lesson.id] ?? ''} onChange={(event) => setReviewRemaining((all) => ({ ...all, [lesson.id]: event.target.value }))} placeholder="minutes" /></label><label>Note facultative<input value={reviewNotes[lesson.id] ?? ''} onChange={(event) => setReviewNotes((all) => ({ ...all, [lesson.id]: event.target.value }))} maxLength={2000} /></label></div>}
                  {lesson.levels.length > 1 && <label className="detail-toggle"><input type="checkbox" checked={Boolean(reviewDetails[lesson.id])} onChange={(event) => setReviewDetails((details) => ({ ...details, [lesson.id]: event.target.checked }))} />Détailler par niveau</label>}
                  {reviewDetails[lesson.id] && <div className="level-review-list">{lesson.levels.map(({ level }) => {
                    const state = reviewLevels[lesson.id]?.[level] ?? reviewStates[lesson.id] ?? 'NOT_STARTED';
                    return <div className="level-review-entry" key={level}>
                      <label className="review-line"><span>{level}</span><select aria-label={`Avancement ${level} pour ${lesson.title}`} value={state} onChange={(event) => setReviewLevels((all) => ({ ...all, [lesson.id]: { ...all[lesson.id], [level]: event.target.value } }))}><option value="DONE">Terminée</option><option value="PARTIAL">Partielle</option><option value="NOT_STARTED">Non commencée</option><option value="CANCELLED">Annulée</option></select></label>
                      {state === 'PARTIAL' && <div className="review-extra"><label>Durée restante<input type="number" min="0" max={lesson.estimatedMinutes} value={reviewLevelRemaining[lesson.id]?.[level] ?? ''} onChange={(event) => setReviewLevelRemaining((all) => ({ ...all, [lesson.id]: { ...all[lesson.id], [level]: event.target.value } }))} placeholder="minutes" /></label><label>Note facultative<input value={reviewLevelNotes[lesson.id]?.[level] ?? ''} onChange={(event) => setReviewLevelNotes((all) => ({ ...all, [lesson.id]: { ...all[lesson.id], [level]: event.target.value } }))} maxLength={2000} /></label></div>}
                    </div>;
                  })}</div>}
                </div>)}
              </div>}
            </div>
          </div>
        </section> : currentPage === 'calendrier' ? <section className="calendar-view">
          <div className="section-title-row"><div><p className="eyebrow">{classroom.schoolYear.label}</p><h2>Semaines de l’année</h2></div><span className="quiet-count">{calendar?.weeks.length ?? 0} semaines calendaires</span></div>
          {calendar?.limitation && <p className="calendar-limit">{calendar.limitation}</p>}
          <div className="calendar-week-list">{calendar?.weeks.map((calendarWeek) => <div className="calendar-week" key={calendarWeek.startDate}>
            <strong>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${calendarWeek.startDate}T00:00:00Z`))}</strong>
            <div className="calendar-day-dots">{weekdays.map(({ value, label }) => {
              const date = new Date(`${calendarWeek.startDate}T00:00:00Z`);
              date.setUTCDate(date.getUTCDate() + value - 1);
              const isTeaching = calendarWeek.teachingDays.includes(date.toISOString().slice(0, 10));
              return <i key={value} title={`${label}${isTeaching ? ' · classe' : ' · sans classe'}`} className={isTeaching ? 'teaching' : ''} />;
            })}</div>
            {calendarWeek.teachingDays.length === 0 ? <span className="calendar-week-state off">Sans classe</span> : calendarWeek.shortened ? <span className="calendar-week-state short">Raccourcie · {calendarWeek.teachingDays.length} j</span> : <span className="calendar-week-state">{calendarWeek.teachingDays.length} jours</span>}
          </div>)}</div>
          <section className="calendar-exceptions"><div className="section-title-row"><div><p className="eyebrow">AJUSTEMENTS LOCAUX</p><h2>Exceptions de calendrier</h2></div></div>
            <form className="exception-form" onSubmit={saveCalendarException}><label>Date<input name="date" type="date" required /></label><label>Décision<select name="isTeachingDay"><option value="false">Pas de classe</option><option value="true">Jour de classe</option></select></label><label>Motif (facultatif)<input name="reason" maxLength={200} placeholder="Ex. sortie scolaire" /></label><button className="button button-primary" disabled={busy}>Enregistrer</button></form>
            {calendar?.exceptions.length ? <div className="exception-list">{calendar.exceptions.map((exception) => <div className="exception-row" key={exception.id}><strong>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${exception.date}T00:00:00Z`))}</strong><span>{exception.isTeachingDay ? 'Jour de classe ajouté' : 'Pas de classe'}{exception.reason ? ` · ${exception.reason}` : ''}</span><button className="icon-button" aria-label={`Supprimer l’exception du ${exception.date}`} onClick={() => deleteCalendarException(exception.date)}>×</button></div>)}</div> : <p className="muted calendar-empty">Aucune exception enregistrée.</p>}
          </section>
        </section> : <section className="dashboard-grid">
          <article className="dashboard-feature"><div className="feature-top"><span className="eyebrow">À VENIR</span><span className="feature-symbol">↗</span></div><h2>La semaine se dessine<br />à votre rythme.</h2><p>Choisissez les séances de votre programmation. Rien ne s’ajoute sans vous.</p><Link className="button button-light" to="/planning">Préparer ma semaine <span>→</span></Link><div className="feature-decoration" aria-hidden="true"><i /><i /><i /><i /><i /></div></article>
          <article className="dashboard-stat"><p className="eyebrow">PROGRAMMATION</p><strong>{sequences.length.toString().padStart(2, '0')}</strong><span>séquence{sequences.length === 1 ? '' : 's'} dans l’année</span><Link to="/programmation" className="stat-link">Explorer le programme ↗</Link></article>
          <article className="dashboard-stat dashboard-stat-alt"><p className="eyebrow">CETTE SEMAINE</p><strong>{plan?.schedules.length.toString().padStart(2, '0') ?? '00'}</strong><span>séance{plan?.schedules.length === 1 ? '' : 's'} sélectionnée{plan?.schedules.length === 1 ? '' : 's'}</span><Link to="/planning" className="stat-link">Ouvrir la semaine ↗</Link></article>
          <div className="dashboard-note"><span>✳</span><p>Une séance commune CE2 + CM1 garde une seule place dans votre programme et dans votre charge hebdomadaire.</p></div>
          <section className="progress-overview"><div className="section-title-row"><div><p className="eyebrow">AVANCEMENT RÉALISÉ</p><h2>Le fil des séquences</h2></div><Link className="stat-link" to="/programmation">Programme ↗</Link></div>
            {progress.length === 0 ? <p className="muted">Ajoutez une séquence pour suivre la progression.</p> : progress.map((item) => <div className="progress-row" key={item.sequenceId}><div className="progress-heading"><span>{item.title}<small>{item.subject} · {item.targetPeriod}</small></span><strong>{item.overall.percentage === null ? '—' : `${item.overall.percentage}%`}</strong></div><div className="progress-bar"><i style={{ width: `${item.overall.percentage ?? 0}%` }} /></div><div className="progress-levels">{item.levels.map(({ level, percentage }) => <span key={level}>{level} <b>{percentage === null ? '—' : `${percentage}%`}</b></span>)}</div></div>)}
          </section>
        </section>}
        <footer className="page-footer"><span>institplanit · préparer ensemble, progresser chacun</span><span>Données conservées dans votre espace</span></footer>
      </main>
    </div>
  </div>;
}

export { App };