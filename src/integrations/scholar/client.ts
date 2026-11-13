import { invoke } from '@tauri-apps/api/core'
import type { MasteryLevel } from '@/features/scholar/lib/lessonContent'

export interface Subject {
  id: string
  name: string
  color: string
  createdAt: string
  /** False only for EGD, which is exempt from lesson generation — the UI
   *  offers it notes and past papers but no "Add Chapter". */
  lessonsEnabled: boolean
  /** Fixed curriculum order for the ten seeded streams. */
  position: number
}

interface RawSubject {
  id: string
  name: string
  color: string
  created_at: string
  lessons_enabled: boolean
  position: number
}

function fromRawSubject(r: RawSubject): Subject {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    createdAt: r.created_at,
    lessonsEnabled: r.lessons_enabled,
    position: r.position,
  }
}
function toRawSubject(s: Subject): RawSubject {
  return {
    id: s.id,
    name: s.name,
    color: s.color,
    created_at: s.createdAt,
    lessons_enabled: s.lessonsEnabled,
    position: s.position,
  }
}

export interface StudyBlock {
  id: string
  subjectId: string
  date: string
  startTime: string
  endTime: string
  topic: string
  chapter: string
  notes: string
  completed: boolean
  createdAt: string
}

interface RawBlock {
  id: string
  subject_id: string
  date: string
  start_time: string
  end_time: string
  topic: string
  chapter: string
  notes: string
  completed: boolean
  created_at: string
}

function fromRawBlock(r: RawBlock): StudyBlock {
  return {
    id: r.id,
    subjectId: r.subject_id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    topic: r.topic,
    chapter: r.chapter,
    notes: r.notes,
    completed: r.completed,
    createdAt: r.created_at,
  }
}
function toRawBlock(b: StudyBlock): RawBlock {
  return {
    id: b.id,
    subject_id: b.subjectId,
    date: b.date,
    start_time: b.startTime,
    end_time: b.endTime,
    topic: b.topic,
    chapter: b.chapter,
    notes: b.notes,
    completed: b.completed,
    created_at: b.createdAt,
  }
}

export interface DailyReflection {
  date: string
  text: string
}

export interface SubjectStreak {
  subjectId: string
  currentStreak: number
  longestStreak: number
  lastStudied: string | null
}

interface RawStreak {
  subject_id: string
  current_streak: number
  longest_streak: number
  last_studied: string | null
}

function fromRawStreak(r: RawStreak): SubjectStreak {
  return {
    subjectId: r.subject_id,
    currentStreak: r.current_streak,
    longestStreak: r.longest_streak,
    lastStudied: r.last_studied,
  }
}
function toRawStreak(s: SubjectStreak): RawStreak {
  return {
    subject_id: s.subjectId,
    current_streak: s.currentStreak,
    longest_streak: s.longestStreak,
    last_studied: s.lastStudied,
  }
}

export async function listSubjects(): Promise<Subject[]> {
  const raw = await invoke<RawSubject[]>('scholar_list_subjects')
  return raw.map(fromRawSubject)
}
export function createSubject(subject: Subject): Promise<void> {
  return invoke('scholar_create_subject', { subject: toRawSubject(subject) })
}
export function updateSubject(subject: Subject): Promise<void> {
  return invoke('scholar_update_subject', { subject: toRawSubject(subject) })
}
export function deleteSubject(id: string): Promise<void> {
  return invoke('scholar_delete_subject', { id })
}

export async function listBlocksForWeek(
  weekStart: string,
  weekEnd: string,
): Promise<StudyBlock[]> {
  const raw = await invoke<RawBlock[]>('scholar_list_blocks_for_week', {
    weekStart,
    weekEnd,
  })
  return raw.map(fromRawBlock)
}
export async function listBlocksForDate(date: string): Promise<StudyBlock[]> {
  const raw = await invoke<RawBlock[]>('scholar_list_blocks_for_date', { date })
  return raw.map(fromRawBlock)
}
export function createBlock(block: StudyBlock): Promise<void> {
  return invoke('scholar_create_block', { block: toRawBlock(block) })
}
export function updateBlock(block: StudyBlock): Promise<void> {
  return invoke('scholar_update_block', { block: toRawBlock(block) })
}
export function setBlockCompleted(
  id: string,
  completed: boolean,
): Promise<void> {
  return invoke('scholar_set_block_completed', { id, completed })
}
export function deleteBlock(id: string): Promise<void> {
  return invoke('scholar_delete_block', { id })
}

export async function getReflection(
  date: string,
): Promise<DailyReflection | null> {
  return invoke<DailyReflection | null>('scholar_get_reflection', { date })
}
export function setReflection(reflection: DailyReflection): Promise<void> {
  return invoke('scholar_set_reflection', { reflection })
}

export async function listStreaks(): Promise<SubjectStreak[]> {
  const raw = await invoke<RawStreak[]>('scholar_list_streaks')
  return raw.map(fromRawStreak)
}
export function updateStreak(streak: SubjectStreak): Promise<void> {
  return invoke('scholar_update_streak', { streak: toRawStreak(streak) })
}

// --- Resources ------------------------------------------------------------

/** What kind of file a resource is, decided from its extension when added
 *  so the UI can pick an icon without re-parsing the path. */
export type ResourceKind = 'video' | 'image' | 'document'

export interface Resource {
  id: string
  subjectId: string
  chapterId: string | null
  title: string
  path: string
  kind: ResourceKind
  createdAt: string
}

interface RawResource {
  id: string
  subject_id: string
  chapter_id: string | null
  title: string
  path: string
  kind: string
  created_at: string
}

function fromRawResource(r: RawResource): Resource {
  return {
    id: r.id,
    subjectId: r.subject_id,
    chapterId: r.chapter_id,
    title: r.title,
    path: r.path,
    kind: (['video', 'image', 'document'] as const).includes(
      r.kind as ResourceKind,
    )
      ? (r.kind as ResourceKind)
      : 'document',
    createdAt: r.created_at,
  }
}
function toRawResource(r: Resource): RawResource {
  return {
    id: r.id,
    subject_id: r.subjectId,
    chapter_id: r.chapterId,
    title: r.title,
    path: r.path,
    kind: r.kind,
    created_at: r.createdAt,
  }
}

export async function listResources(subjectId: string): Promise<Resource[]> {
  const raw = await invoke<RawResource[]>('scholar_list_resources', {
    subjectId,
  })
  return raw.map(fromRawResource)
}
export function createResource(resource: Resource): Promise<void> {
  return invoke('scholar_create_resource', {
    resource: toRawResource(resource),
  })
}
export function deleteResource(id: string): Promise<void> {
  return invoke('scholar_delete_resource', { id })
}

/** Classifies a picked file by extension, for the `kind` column. */
export function resourceKindFor(path: string): ResourceKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'].includes(ext)) return 'video'
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic'].includes(ext))
    return 'image'
  return 'document'
}

// --- Settings -------------------------------------------------------------

/** Scholar's own small key/value preferences store, in its own database.
 *  Values are opaque strings; callers choose the encoding. */
export function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('scholar_get_setting', { key })
}
export function setSetting(key: string, value: string): Promise<void> {
  return invoke('scholar_set_setting', { key, value })
}

// --- Chapters -------------------------------------------------------------

/** Where a chapter is in the ingestion pipeline. `failed` keeps the error
 *  so the UI can offer a retry rather than showing an empty chapter. */
export type ChapterStatus = 'pending' | 'generating' | 'ready' | 'failed'

export interface Chapter {
  id: string
  subjectId: string
  /** CAPS term 1-4 — chapters are the library's topics, filed by term. */
  term: number
  name: string
  /** Absolute paths of the page images this chapter was ingested from. */
  sourcePaths: string[]
  status: ChapterStatus
  error: string | null
  completed: boolean
  createdAt: string
}

interface RawChapter {
  id: string
  subject_id: string
  term: number
  name: string
  source_paths: string
  status: string
  error: string | null
  completed: boolean
  created_at: string
}

/** Path/id lists are stored as a JSON string column rather than a join
 *  table — they are only ever read and written whole. A row written by an
 *  older build (or hand-edited) could still hold something unparseable,
 *  so a bad value degrades to an empty list instead of throwing and
 *  taking out the whole subject view. */
function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

function fromRawChapter(r: RawChapter): Chapter {
  return {
    id: r.id,
    subjectId: r.subject_id,
    term: r.term,
    name: r.name,
    sourcePaths: parseList(r.source_paths),
    status: (r.status as ChapterStatus) ?? 'pending',
    error: r.error,
    completed: r.completed,
    createdAt: r.created_at,
  }
}
function toRawChapter(c: Chapter): RawChapter {
  return {
    id: c.id,
    subject_id: c.subjectId,
    term: c.term,
    name: c.name,
    source_paths: JSON.stringify(c.sourcePaths),
    status: c.status,
    error: c.error,
    completed: c.completed,
    created_at: c.createdAt,
  }
}

export async function listChapters(subjectId: string): Promise<Chapter[]> {
  const raw = await invoke<RawChapter[]>('scholar_list_chapters', { subjectId })
  return raw.map(fromRawChapter)
}
export function createChapter(chapter: Chapter): Promise<void> {
  return invoke('scholar_create_chapter', { chapter: toRawChapter(chapter) })
}
export function setChapterStatus(
  id: string,
  status: ChapterStatus,
  error: string | null = null,
): Promise<void> {
  return invoke('scholar_set_chapter_status', { id, status, error })
}
export function setChapterCompleted(
  id: string,
  completed: boolean,
): Promise<void> {
  return invoke('scholar_set_chapter_completed', { id, completed })
}
export function renameChapter(id: string, name: string): Promise<void> {
  return invoke('scholar_rename_chapter', { id, name })
}
export function deleteChapter(id: string): Promise<void> {
  return invoke('scholar_delete_chapter', { id })
}

// --- Lessons --------------------------------------------------------------

export interface Lesson {
  id: string
  chapterId: string
  subjectId: string
  topic: string
  /** The full step-by-step lesson, as Markdown. */
  body: string
  /** The structured lesson as JSON — objectives, worked examples,
   *  misconceptions, practice, quiz, remediation. Empty for a lesson
   *  generated before structured content existed. */
  content: string
  mastery: MasteryLevel
  /** Best quiz result so far, as "correct/total"; empty until attempted. */
  lastScore: string
  position: number
  createdAt: string
}

interface RawLesson {
  id: string
  chapter_id: string
  subject_id: string
  topic: string
  body: string
  content: string
  mastery: string
  last_score: string
  position: number
  created_at: string
}

function fromRawLesson(r: RawLesson): Lesson {
  return {
    id: r.id,
    chapterId: r.chapter_id,
    subjectId: r.subject_id,
    topic: r.topic,
    body: r.body,
    content: r.content,
    mastery: (['not_started', 'needs_practice', 'mastered'] as const).includes(
      r.mastery as MasteryLevel,
    )
      ? (r.mastery as MasteryLevel)
      : 'not_started',
    lastScore: r.last_score,
    position: r.position,
    createdAt: r.created_at,
  }
}
function toRawLesson(l: Lesson): RawLesson {
  return {
    id: l.id,
    chapter_id: l.chapterId,
    subject_id: l.subjectId,
    topic: l.topic,
    body: l.body,
    content: l.content,
    mastery: l.mastery,
    last_score: l.lastScore,
    position: l.position,
    created_at: l.createdAt,
  }
}

export async function listLessons(chapterId: string): Promise<Lesson[]> {
  const raw = await invoke<RawLesson[]>('scholar_list_lessons', { chapterId })
  return raw.map(fromRawLesson)
}
/** Every lesson for a subject — the corpus the tutor chat is grounded in. */
export async function listLessonsForSubject(
  subjectId: string,
): Promise<Lesson[]> {
  const raw = await invoke<RawLesson[]>('scholar_list_lessons_for_subject', {
    subjectId,
  })
  return raw.map(fromRawLesson)
}
/** Replaces a chapter's lessons atomically — a re-ingest must not leave
 *  the previous run's topics beside the new ones. */
/** Records a quiz attempt. Mastery only ever improves — see the Rust
 *  side; a revision re-take can't demote an earned 'mastered'. */
export function setLessonMastery(
  id: string,
  mastery: MasteryLevel,
  lastScore?: string,
): Promise<void> {
  return invoke('scholar_set_lesson_mastery', { id, mastery, lastScore })
}

export function replaceLessons(
  chapterId: string,
  lessons: Lesson[],
): Promise<void> {
  return invoke('scholar_replace_lessons', {
    chapterId,
    lessons: lessons.map(toRawLesson),
  })
}

// --- Notes ----------------------------------------------------------------

export interface Note {
  id: string
  subjectId: string
  chapterId: string | null
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

interface RawNote {
  id: string
  subject_id: string
  chapter_id: string | null
  title: string
  body: string
  created_at: string
  updated_at: string
}

function fromRawNote(r: RawNote): Note {
  return {
    id: r.id,
    subjectId: r.subject_id,
    chapterId: r.chapter_id,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
function toRawNote(n: Note): RawNote {
  return {
    id: n.id,
    subject_id: n.subjectId,
    chapter_id: n.chapterId,
    title: n.title,
    body: n.body,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  }
}

export async function listNotes(subjectId: string): Promise<Note[]> {
  const raw = await invoke<RawNote[]>('scholar_list_notes', { subjectId })
  return raw.map(fromRawNote)
}
export function upsertNote(note: Note): Promise<void> {
  return invoke('scholar_upsert_note', { note: toRawNote(note) })
}
export function deleteNote(id: string): Promise<void> {
  return invoke('scholar_delete_note', { id })
}

// --- Tests ----------------------------------------------------------------

export interface Test {
  id: string
  subjectId: string
  /** The chapters this test draws on — more than one for a cross-chapter test. */
  chapterIds: string[]
  title: string
  /** The paper, as Markdown. */
  body: string
  /** The memo, withheld in the UI until the paper has been attempted. */
  memo: string
  score: number | null
  total: number | null
  takenAt: string | null
  createdAt: string
}

interface RawTest {
  id: string
  subject_id: string
  chapter_ids: string
  title: string
  body: string
  memo: string
  score: number | null
  total: number | null
  taken_at: string | null
  created_at: string
}

function fromRawTest(r: RawTest): Test {
  return {
    id: r.id,
    subjectId: r.subject_id,
    chapterIds: parseList(r.chapter_ids),
    title: r.title,
    body: r.body,
    memo: r.memo,
    score: r.score,
    total: r.total,
    takenAt: r.taken_at,
    createdAt: r.created_at,
  }
}
function toRawTest(t: Test): RawTest {
  return {
    id: t.id,
    subject_id: t.subjectId,
    chapter_ids: JSON.stringify(t.chapterIds),
    title: t.title,
    body: t.body,
    memo: t.memo,
    score: t.score,
    total: t.total,
    taken_at: t.takenAt,
    created_at: t.createdAt,
  }
}

export async function listTests(subjectId: string): Promise<Test[]> {
  const raw = await invoke<RawTest[]>('scholar_list_tests', { subjectId })
  return raw.map(fromRawTest)
}
/** Every attempted test across all subjects, newest first — the Progress
 *  view's results history. Unattempted papers are excluded in SQL. */
export async function listResults(): Promise<Test[]> {
  const raw = await invoke<RawTest[]>('scholar_list_results')
  return raw.map(fromRawTest)
}
export function createTest(test: Test): Promise<void> {
  return invoke('scholar_create_test', { test: toRawTest(test) })
}
/** Records an attempt. The moment is stamped in Rust, so a result can
 *  never be stored without the time it was achieved. */
export function recordTestResult(
  id: string,
  score: number,
  total: number,
): Promise<void> {
  return invoke('scholar_record_test_result', { id, score, total })
}
export function deleteTest(id: string): Promise<void> {
  return invoke('scholar_delete_test', { id })
}

// --- Past papers ----------------------------------------------------------

export interface PastPaper {
  id: string
  subjectId: string
  title: string
  /** One PDF, or several page images. Scholar stores paths, not copies. */
  sourcePaths: string[]
  chapterIds: string[]
  year: number | null
  createdAt: string
}

interface RawPastPaper {
  id: string
  subject_id: string
  title: string
  source_paths: string
  chapter_ids: string
  year: number | null
  created_at: string
}

function fromRawPastPaper(r: RawPastPaper): PastPaper {
  return {
    id: r.id,
    subjectId: r.subject_id,
    title: r.title,
    sourcePaths: parseList(r.source_paths),
    chapterIds: parseList(r.chapter_ids),
    year: r.year,
    createdAt: r.created_at,
  }
}
function toRawPastPaper(p: PastPaper): RawPastPaper {
  return {
    id: p.id,
    subject_id: p.subjectId,
    title: p.title,
    source_paths: JSON.stringify(p.sourcePaths),
    chapter_ids: JSON.stringify(p.chapterIds),
    year: p.year,
    created_at: p.createdAt,
  }
}

export async function listPastPapers(subjectId: string): Promise<PastPaper[]> {
  const raw = await invoke<RawPastPaper[]>('scholar_list_past_papers', {
    subjectId,
  })
  return raw.map(fromRawPastPaper)
}
export function createPastPaper(paper: PastPaper): Promise<void> {
  return invoke('scholar_create_past_paper', { paper: toRawPastPaper(paper) })
}
export function setPastPaperChapters(
  id: string,
  chapterIds: string[],
): Promise<void> {
  return invoke('scholar_set_past_paper_chapters', {
    id,
    chapterIds: JSON.stringify(chapterIds),
  })
}
export function deletePastPaper(id: string): Promise<void> {
  return invoke('scholar_delete_past_paper', { id })
}

// --- Timetable ------------------------------------------------------------

/** A row in the timetable grid — either a subject period or a break. */
export interface TimetableSlot {
  id: string
  /** e.g. "Assembly", "Period 1", "Break", "Break and Salah" */
  label: string
  startTime: string | null
  endTime: string | null
  /** Entries for Mon(1)–Fri(5). Key = day 1-5. */
  entries: Record<number, TimetableEntry>
  /** This row is a break row (rendered differently). */
  isBreak: boolean
}

export interface TimetableEntry {
  subject: string
  teacher: string
  room: string
}

export const EMPTY_ENTRY: TimetableEntry = { subject: '', teacher: '', room: '' }

const TIMETABLE_KEY = 'timetable_v1'

export async function loadTimetable(): Promise<TimetableSlot[]> {
  const raw = await getSetting(TIMETABLE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as TimetableSlot[]
  } catch {
    return []
  }
}

export function saveTimetable(slots: TimetableSlot[]): Promise<void> {
  return setSetting(TIMETABLE_KEY, JSON.stringify(slots))
}

// --- Page ingestion -------------------------------------------------------

/** Checks every picked page is present and usable before a generation
 *  turn is spent on it. The images are not read here — the vision path
 *  passes these same paths to the model, which opens them itself. Rejects
 *  with a message naming the offending page. */
export function verifyPages(paths: string[]): Promise<void> {
  return invoke<void>('scholar_verify_pages', { paths })
}

/** Where Phone Link drops phone photos, for the picker's starting
 *  directory. `null` when the usual location isn't present — the dialog
 *  then opens wherever the OS would. */
export function phonePhotosDir(): Promise<string | null> {
  return invoke<string | null>('scholar_phone_photos_dir')
}
