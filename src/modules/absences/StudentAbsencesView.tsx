import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { CalendarOff, CheckCircle2, ClipboardList, QrCode, Save, ScanLine, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { EmptyState, FormError } from '@/components/ui/StatusBlock';
import {
  recordQuickStudentAttendance,
  saveClassDayAbsences,
  type AbsenceWorkspace,
  type StudentAbsenceEntry,
} from '@/db/absences';
import { isCardAbsenceEnabled, updateCardAbsenceEnabled } from '@/db/institutions';
import type { Student, StudentAbsence } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { GateSyncAndResetPanel } from '@/modules/absences/GateSyncAndResetPanel';
import { CardScanner } from '@/modules/canteen/CardScanner';
import { playScanFeedback } from '@/modules/canteen/scanFeedback';
import { classLessonsForDay, isIsoDate, summarizeStudentAbsences, weekdayOfDate, type ClassLesson } from '@/utils/absences';
import { PERIODS } from '@/utils/schedule';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { isStudentActive } from '@/utils/statistics';
import { currentPeriodNumber, matchStudentFromScan } from '@/utils/studentQr';

type DraftEntries = Map<string, StudentAbsenceEntry>;

function draftKey(studentId: string, period: number): string {
  return `${studentId}|${period}`;
}

function toDraft(records: StudentAbsence[]): DraftEntries {
  return new Map(
    records.map((record) => [
      draftKey(record.studentId, record.period),
      { studentId: record.studentId, period: record.period, justified: record.justified },
    ]),
  );
}

function snapshot(entries: StudentAbsenceEntry[]): string {
  return JSON.stringify(
    [...entries]
      .sort((a, b) => a.period - b.period || a.studentId.localeCompare(b.studentId))
      .map((entry) => [entry.period, entry.studentId, entry.justified]),
  );
}

function periodStartHour(periodNumber: number): string {
  const period = PERIODS.find((p) => p.number === periodNumber);
  return period ? period.start.slice(0, 2) : String(periodNumber);
}

interface StudentAbsencesViewProps {
  data: AbsenceWorkspace;
  onSaved: () => void;
  selectedClassId?: string | null;
  onSelectClass?: (classId: string) => void;
  date?: string;
  onDateChange?: (date: string) => void;
  canAddStudent?: boolean;
  onAddStudent?: (classId: string | null) => void;
}

export function StudentAbsencesView({
  data,
  onSaved,
  selectedClassId: controlledClassId,
  onSelectClass,
  date: controlledDate,
  onDateChange,
  canAddStudent = false,
  onAddStudent,
}: StudentAbsencesViewProps) {
  const { t, i18n } = useTranslation();
  const { user, institution, refresh } = useSession();
  const [localClassId, setLocalClassId] = useState<string | null>(null);
  const [localDate, setLocalDate] = useState(todayIso);
  const selectedClassId = controlledClassId !== undefined ? controlledClassId : localClassId;
  const setSelectedClassId = (classId: string) => {
    setLocalClassId(classId);
    onSelectClass?.(classId);
  };
  const date = controlledDate !== undefined ? controlledDate : localDate;
  const setDate = (nextDate: string) => {
    setLocalDate(nextDate);
    onDateChange?.(nextDate);
  };
  const [togglingCardAbsence, setTogglingCardAbsence] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanPeriod, setScanPeriod] = useState<number>(() => currentPeriodNumber() ?? 1);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanVersion, setScanVersion] = useState(0);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const manualFocusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (manualFocusTimerRef.current !== null) {
        window.clearTimeout(manualFocusTimerRef.current);
      }
    };
  }, []);

  const cardAbsenceEnabled = isCardAbsenceEnabled(institution);
  const activeClassId = data.classes.some((item) => item.id === selectedClassId) ? selectedClassId : (data.classes[0]?.id ?? null);

  const handleToggleCardAbsence = async () => {
    if (!data.access.isHead || togglingCardAbsence) return;
    setTogglingCardAbsence(true);
    setScanError(null);
    setScanNotice(null);
    try {
      await updateCardAbsenceEnabled(institution.id, !cardAbsenceEnabled, user.id);
      await refresh();
    } catch (cause) {
      setScanError(t(errorKey(cause)));
    } finally {
      setTogglingCardAbsence(false);
    }
  };

  const handleScanAbsence = async (rawCode: string) => {
    const cleaned = rawCode.trim();
    if (!cleaned || scanBusy || !cardAbsenceEnabled || !data.access.canEdit) return;
    setScanError(null);
    setScanNotice(null);

    if (!isIsoDate(date)) {
      setScanError(t('validation.invalidDate'));
      return;
    }

    const matched = matchStudentFromScan(data.students, cleaned, institution.canteenMatchField);
    if (!matched) {
      playScanFeedback('error');
      setScanError(t('absences.cardAbsence.studentNotFound'));
      return;
    }

    setScanBusy(true);
    try {
      const studentLessons = classLessonsForDay(data.slots, matched.classId, weekdayOfDate(date));
      const matchedLesson = studentLessons.find((lesson) => lesson.period === scanPeriod);
      const subject = matchedLesson?.subject || t('cards.scanner.defaultSubject');

      await recordQuickStudentAttendance(institution.id, user.id, {
        classId: matched.classId,
        studentId: matched.id,
        date,
        period: scanPeriod,
        subject,
        status: 'absent',
      });
      playScanFeedback('success');
      setCameraOpen(false);
      setScanInput('');
      setSelectedClassId(matched.classId);
      setScanVersion((v) => v + 1);
      const classLabel = data.classes.find((c) => c.id === matched.classId)?.name ?? '';
      setScanNotice(
        t('absences.cardAbsence.recordedSuccess', {
          name: `${matched.lastName} ${matched.firstName}`,
          className: classLabel,
          period: scanPeriod,
        }),
      );
      onSaved();
    } catch (cause) {
      playScanFeedback('error');
      setScanError(t(errorKey(cause)));
    } finally {
      setScanBusy(false);
    }
  };

  const handleScanFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    void handleScanAbsence(scanInput);
  };

  if (activeClassId === null) {
    return (
      <EmptyState
        icon={<ClipboardList className="size-7" aria-hidden />}
        title={t('timetable.noClassesTitle')}
        body={data.access.isHead ? t('timetable.noClassesBody') : t('timetable.noAssignedClasses')}
      />
    );
  }

  const validDate = isIsoDate(date);
  const workingDay = validDate && data.workingDays.includes(weekdayOfDate(date));
  const lessons = workingDay ? classLessonsForDay(data.slots, activeClassId, weekdayOfDate(date)) : [];
  const locale = i18n.language.startsWith('ar') ? 'ar' : 'en';
  const students = data.students
    .filter((student) => student.deletedAt == null && student.classId === activeClassId)
    .sort((a, b) => {
      const lastA = (a.lastName ?? '').trim();
      const lastB = (b.lastName ?? '').trim();
      const byLast = lastA.localeCompare(lastB, locale, { sensitivity: 'base' });
      if (byLast !== 0) return byLast;
      return (a.firstName ?? '').trim().localeCompare((b.firstName ?? '').trim(), locale, { sensitivity: 'base' });
    });
  const classStudentIds = new Set(students.map((student) => student.id));
  const records = data.studentAbsences.filter(
    (record) =>
      record.deletedAt == null &&
      record.date === date &&
      record.status !== 'late' &&
      (record.classId === activeClassId || classStudentIds.has(record.studentId)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {data.classes.map((schoolClass) => (
          <FilterChip
            key={schoolClass.id}
            label={schoolClass.name}
            active={schoolClass.id === activeClassId}
            onClick={() => setSelectedClassId(schoolClass.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 sm:min-w-[14rem]">
          {t('absences.date')}
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="min-h-11 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-neutral-600 tabular-nums">
            {t('absences.studentsCountLabel', { count: students.length })}
          </span>
          {canAddStudent && onAddStudent ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onAddStudent(activeClassId)}
              icon={<UserPlus className="size-4" aria-hidden />}
            >
              {t('absences.addStudentButton')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Sync with Gate Card Entry + Reset Today's Absences (Full / Manual) */}
      <GateSyncAndResetPanel
        data={data}
        date={date}
        activeClassId={activeClassId}
        activeClassName={data.classes.find((schoolClass) => schoolClass.id === activeClassId)?.name ?? ''}
        onChanged={() => {
          setScanVersion((v) => v + 1);
          onSaved();
        }}
      />

      {/* Card-based absence toggle & QR scanner bar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <QrCode className="size-5 shrink-0 text-primary-700" aria-hidden />
            <span className="text-sm font-semibold text-neutral-900">{t('absences.cardAbsence.title')}</span>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                cardAbsenceEnabled ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {cardAbsenceEnabled ? t('absences.cardAbsence.enabled') : t('absences.cardAbsence.disabled')}
            </span>
          </div>

          {data.access.isHead ? (
            <button
              type="button"
              role="switch"
              aria-checked={cardAbsenceEnabled}
              aria-label={t('absences.cardAbsence.toggleLabel')}
              disabled={togglingCardAbsence}
              onClick={() => void handleToggleCardAbsence()}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${
                cardAbsenceEnabled ? 'bg-primary-600' : 'bg-neutral-300'
              }`}
            >
              <span
                className={`inline-block size-5 transform rounded-full bg-[#ffffff] shadow transition-transform ${
                  cardAbsenceEnabled ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'
                }`}
              />
            </button>
          ) : null}
        </div>

        {!cardAbsenceEnabled ? (
          <p className="text-xs text-neutral-500">{t('absences.cardAbsence.disabledHint')}</p>
        ) : data.access.canEdit ? (
          <form onSubmit={handleScanFormSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-600">
              <span className="font-semibold">{t('absences.cardAbsence.periodLabel')}:</span>
              <select
                value={scanPeriod}
                onChange={(event) => setScanPeriod(Number(event.target.value))}
                className="min-h-10 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-900 tabular-nums focus:border-primary-500 focus:outline-none"
              >
                {PERIODS.map((p) => (
                  <option key={p.number} value={p.number}>
                    {t('absences.period', { number: p.number })} ({p.start})
                  </option>
                ))}
              </select>
            </label>
            <input
              ref={scanInputRef}
              type="text"
              value={scanInput}
              onChange={(event) => {
                setScanInput(event.target.value);
                if (scanError) setScanError(null);
              }}
              placeholder={t('absences.cardAbsence.inputPlaceholder')}
              aria-label={t('absences.cardAbsence.inputPlaceholder')}
              className="min-h-10 flex-1 rounded-xl border border-neutral-300 bg-neutral-50/50 px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:bg-white focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <Button type="submit" variant="secondary" disabled={!scanInput.trim() || scanBusy}>
                {t('absences.cardAbsence.recordAction')}
              </Button>
              <Button
                type="button"
                onClick={() => setCameraOpen(true)}
                disabled={scanBusy}
                icon={<ScanLine className="size-4" aria-hidden />}
              >
                {t('absences.cardAbsence.scanCamera')}
              </Button>
            </div>
          </form>
        ) : null}

        {scanNotice ? (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-xs font-semibold text-success-800"
          >
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            <span>{scanNotice}</span>
          </div>
        ) : null}
        <FormError message={scanError} />
      </section>

      {!validDate ? <FormError message={t('validation.invalidDate')} /> : null}
      {validDate && !workingDay ? (
        <EmptyState icon={<CalendarOff className="size-7" aria-hidden />} title={t('absences.noLessonsTitle')} body={t('absences.notWorkingDay')} />
      ) : null}
      {workingDay && lessons.length === 0 ? (
        <EmptyState icon={<CalendarOff className="size-7" aria-hidden />} title={t('absences.noLessonsTitle')} body={t('absences.noLessonsBody')} />
      ) : null}
      {workingDay && lessons.length > 0 ? (
        <ClassDayEditor
          key={`${activeClassId}|${date}|${scanVersion}`}
          classId={activeClassId}
          className={data.classes.find((schoolClass) => schoolClass.id === activeClassId)?.name ?? ''}
          date={date}
          lessons={lessons}
          students={students}
          records={records}
          canEdit={data.access.canEdit}
          canAddStudent={canAddStudent}
          onAddStudent={onAddStudent ? () => onAddStudent(activeClassId) : undefined}
          onSaved={onSaved}
        />
      ) : null}

      {cameraOpen && cardAbsenceEnabled ? (
        <CardScanner
          paused={scanBusy}
          onDetect={(code) => void handleScanAbsence(code)}
          onManual={() => {
            setCameraOpen(false);
            if (manualFocusTimerRef.current !== null) {
              window.clearTimeout(manualFocusTimerRef.current);
            }
            manualFocusTimerRef.current = window.setTimeout(() => {
              manualFocusTimerRef.current = null;
              scanInputRef.current?.focus();
            }, 50);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface ClassDayEditorProps {
  classId: string;
  className: string;
  date: string;
  lessons: ClassLesson[];
  students: Student[];
  records: StudentAbsence[];
  canEdit: boolean;
  canAddStudent?: boolean;
  onAddStudent?: () => void;
  onSaved: () => void;
}

function ClassDayEditor({
  classId,
  className,
  date,
  lessons,
  students,
  records,
  canEdit,
  canAddStudent = false,
  onAddStudent,
  onSaved,
}: ClassDayEditorProps) {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const [draft, setDraft] = useState<DraftEntries>(() => toDraft(records));
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot([...toDraft(records).values()]));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const incomingSnapshot = snapshot([...toDraft(records).values()]);
  useEffect(() => {
    if (incomingSnapshot === savedSnapshot) return;
    const nextDraft = toDraft(records);
    setDraft(nextDraft);
    setSavedSnapshot(incomingSnapshot);
    setJustSaved(false);
  }, [incomingSnapshot, savedSnapshot, records]);

  const entries = [...draft.values()];
  const dirty = snapshot(entries) !== savedSnapshot;
  const hoursByStudent = summarizeStudentAbsences(
    entries.map((entry) => ({ studentId: entry.studentId, justified: entry.justified, date })),
  );

  const absentStudentIds = new Set(entries.map((e) => e.studentId));
  const totalAbsentStudents = absentStudentIds.size;
  const totalAbsentHours = entries.length;

  const updateDraft = (update: (next: DraftEntries) => void) => {
    setJustSaved(false);
    setDraft((current) => {
      const next = new Map(current);
      update(next);
      return next;
    });
  };

  const toggleAbsent = (studentId: string, period: number) =>
    updateDraft((next) => {
      const key = draftKey(studentId, period);
      if (next.has(key)) next.delete(key);
      else next.set(key, { studentId, period, justified: false });
    });

  const toggleJustified = (studentId: string, period: number) =>
    updateDraft((next) => {
      const key = draftKey(studentId, period);
      const entry = next.get(key);
      if (entry) next.set(key, { ...entry, justified: !entry.justified });
    });

  const cancelPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  useEffect(() => () => cancelPress(), []);

  const startPress = (studentId: string, period: number) => {
    if (!canEdit) return;
    cancelPress();
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      const entry = draftRef.current.get(draftKey(studentId, period));
      if (!entry) return;
      longPressTriggered.current = true;
      toggleJustified(studentId, period);
    }, 550);
  };

  const finishPress = (studentId: string, period: number) => {
    cancelPress();
    if (!longPressTriggered.current) toggleAbsent(studentId, period);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      await saveClassDayAbsences(institution.id, user.id, classId, date, entries);
      setSavedSnapshot(snapshot(entries));
      setJustSaved(true);
      onSaved();
    } catch (cause) {
      setSaveError(t(errorKey(cause)));
    } finally {
      setSaving(false);
    }
  };

  const gridTemplateColumns = `11.5rem repeat(${lessons.length}, 7rem)`;
  const gridStyle: CSSProperties = { gridTemplateColumns };
  const stickyColumnClass = 'sticky z-20 bg-white ltr:left-0 rtl:right-0';

  return (
    <div className="flex flex-col gap-3">
      {!canEdit ? <p className="rounded-2xl bg-neutral-100 p-4 text-sm text-neutral-700">{t('absences.readOnly')}</p> : null}

      <div className="max-h-[70vh] overflow-auto overscroll-contain rounded-2xl bg-white ring-1 ring-neutral-200 [scrollbar-width:thin]">
        <div className="min-w-max">
          <div className="sticky top-0 z-30 border-b border-neutral-300 bg-white shadow-sm">
            <div className="grid min-w-max items-stretch" style={gridStyle}>
              <div className={`${stickyColumnClass} flex min-h-[4.75rem] items-center justify-between gap-2 border-e border-neutral-200 px-3 py-2`}>
                <div className="flex min-w-0 flex-col justify-center">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    {t('reports.columns.student')} ({students.length})
                  </span>
                  <span className="text-xs font-semibold text-neutral-900 tabular-nums">{date}</span>
                  <span className="truncate text-xs text-neutral-600">{t('timetable.classLabel')}: {className}</span>
                </div>
                {canAddStudent && onAddStudent ? (
                  <button
                    type="button"
                    onClick={onAddStudent}
                    title={t('absences.addStudentButton')}
                    aria-label={t('absences.addStudentButton')}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary-200 bg-primary-50 text-primary-700 transition hover:bg-primary-100"
                  >
                    <UserPlus className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              {lessons.map((lesson) => {
                const absentCount = entries.filter((entry) => entry.period === lesson.period).length;
                return (
                  <div key={lesson.period} className="flex min-h-[4.75rem] flex-col items-center justify-center border-e border-neutral-100 px-1 py-2 text-center">
                    <span className="text-xs font-bold text-neutral-900 tabular-nums">{periodStartHour(lesson.period)}</span>
                    <span className="max-w-[6.75rem] whitespace-normal break-words text-[10px] font-medium leading-tight text-neutral-600" title={lesson.subject}>{lesson.subject}</span>
                    <span className="text-[10px] text-neutral-500">{t('absences.period', { number: lesson.period })}</span>
                    {absentCount > 0 ? (
                      <span className="mt-0.5 rounded-full bg-danger-100 px-1.5 text-[10px] font-semibold text-danger-700 tabular-nums">{absentCount}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {students.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-600">{t('absences.noStudents')}</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {students.map((student, idx) => {
                const hours = hoursByStudent.get(student.id)?.hours ?? 0;
                const hasLeft = !isStudentActive(student, date);
                return (
                  <li key={student.id} className="grid min-w-max items-stretch transition hover:bg-neutral-50" style={gridStyle}>
                    <div className={`${stickyColumnClass} flex min-h-[4.75rem] flex-col justify-center border-e border-neutral-200 px-3 py-2.5`}>
                      <div className="flex items-baseline gap-1.5">
                        <span className="shrink-0 text-[11px] font-bold text-neutral-400 tabular-nums">{idx + 1}.</span>
                        <p className="break-words text-sm leading-snug text-neutral-900">
                          <span className="font-bold">{student.lastName}</span>{' '}
                          <span className="font-medium text-neutral-700">{student.firstName}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] text-neutral-500 tabular-nums">{t('absences.hours', { count: hours })}</p>
                        {hasLeft ? (
                          <span className="text-[10px] font-semibold text-neutral-500">
                            ({t('absences.studentLeftBadge')})
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {lessons.map((lesson) => {
                      const entry = draft.get(draftKey(student.id, lesson.period));
                      const isAbsent = entry !== undefined;
                      return (
                        <div key={lesson.period} className="flex items-center justify-center px-1 py-3">
                          <button
                            type="button"
                            disabled={!canEdit}
                            aria-pressed={isAbsent}
                            aria-label={`${student.lastName} ${student.firstName}, ${t('absences.period', { number: lesson.period })}`}
                            onPointerDown={() => startPress(student.id, lesson.period)}
                            onPointerUp={() => finishPress(student.id, lesson.period)}
                            onPointerCancel={cancelPress}
                            onPointerLeave={cancelPress}
                            className={`relative flex min-h-11 w-full flex-col items-center justify-center rounded-xl px-1 text-center text-[10px] font-medium leading-tight transition duration-150 ring-1 disabled:cursor-not-allowed ${
                              isAbsent
                                ? 'bg-danger-600 text-white ring-danger-700 hover:bg-danger-700'
                                : 'bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50'
                            }`}
                          >
                            <span className="font-bold">{periodStartHour(lesson.period)}</span>
                            <span>{isAbsent ? t('absences.absent') : t('absences.present')}</span>
                            {entry?.justified ? <span className="absolute end-1 top-1 size-1.5 rounded-full bg-[#ffffff]" title={t('absences.justified')} aria-label={t('absences.justified')} /> : null}
                          </button>
                        </div>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <FormError message={saveError} />

      {/* Floating summary bar above bottom navigation on mobile, cleanly docked on desktop */}
      <div className="bottom-above-tabs fixed inset-x-0 z-30 mx-auto max-w-3xl px-4 lg:bottom-6 lg:max-w-4xl">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-neutral-200 backdrop-blur">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm">
            <span className="font-semibold text-neutral-900">
              {t('absences.summaryAbsent', { count: totalAbsentStudents })}
            </span>
            <span className="font-medium text-neutral-600">
              {t('absences.summaryHours', { count: totalAbsentHours })}
            </span>
            <span className="text-neutral-500">
              {dirty ? t('absences.unsaved') : justSaved ? t('absences.saved') : ''}
            </span>
          </div>
          {canEdit ? (
            <Button
              onClick={handleSave}
              disabled={!dirty || saving}
              icon={<Save className="size-5" aria-hidden />}
              className="min-h-10 px-3 text-sm sm:px-5 sm:text-base"
            >
              {t('absences.save')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Bottom padding so last student isn't hidden behind summary bar + nav */}
      <div className="h-40" />
    </div>
  );
}
