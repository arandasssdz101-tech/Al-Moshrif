import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, DoorOpen, Printer, UserX, Utensils } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import { db } from '@/db/database';
import { recordQuickStudentAttendance } from '@/db/absences';
import { listCanteenEntries, loadWholeDayAbsentStudentIds, recordCanteenScan } from '@/db/canteen';
import { isCardAbsenceEnabled } from '@/db/institutions';
import type { CanteenEntry, Room, Student, StudentAbsence, Teacher, TimetableSlot } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { playScanFeedback } from '@/modules/canteen/scanFeedback';
import { weekdayOfDate } from '@/utils/absences';
import { decideScan } from '@/utils/canteen';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { PERIODS } from '@/utils/schedule';
import { currentPeriodNumber, formatStudentRegime, studentFullName, studentRegistrationNumber } from '@/utils/studentQr';
import { slotLessons } from '@/utils/timetableLessons';

interface ScannedStudentSheetProps {
  student: Student;
  classNameLabel: string;
  allStudents: Student[];
  scannedCode: string;
  onClose: () => void;
  onViewCard: () => void;
  onPrintCard: () => void;
}

interface ActionNotice {
  tone: 'success' | 'warning' | 'error';
  text: string;
}

interface TodayLessonItem {
  period: number;
  start: string;
  end: string;
  subject: string;
  teacherName: string;
  roomName: string;
  isCurrent: boolean;
}

function nowTime(): string {
  return new Date().toTimeString().slice(0, 5);
}

export function ScannedStudentSheet({
  student,
  classNameLabel,
  allStudents,
  scannedCode,
  onClose,
  onViewCard,
  onPrintCard,
}: ScannedStudentSheetProps) {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const cardAbsenceEnabled = isCardAbsenceEnabled(institution);
  const today = todayIso();
  const weekday = weekdayOfDate(today);
  const activePeriod = currentPeriodNumber();

  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [todayAbsences, setTodayAbsences] = useState<StudentAbsence[]>([]);
  const [todayCanteen, setTodayCanteen] = useState<CanteenEntry[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(activePeriod ?? 1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [confirmAbsentCanteen, setConfirmAbsentCanteen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadContext = async () => {
    const [slotRows, teacherRows, roomRows, absenceRows, canteenRows] = await Promise.all([
      db.timetableSlots.where('classId').equals(student.classId).filter((slot) => slot.deletedAt == null).toArray(),
      db.teachers.where('institutionId').equals(institution.id).filter((row) => row.deletedAt == null).toArray(),
      db.rooms.where('institutionId').equals(institution.id).filter((row) => row.deletedAt == null).toArray(),
      db.studentAbsences
        .where('classId')
        .equals(student.classId)
        .filter((row) => row.deletedAt == null && row.studentId === student.id && row.date === today)
        .toArray(),
      listCanteenEntries(institution.id, today),
    ]);
    setSlots(slotRows);
    setTeachers(teacherRows);
    setRooms(roomRows);
    setTodayAbsences(absenceRows.sort((a, b) => a.period - b.period));
    setTodayCanteen(canteenRows);
  };

  useEffect(() => {
    void loadContext().catch((loadErr) => setError(t(errorKey(loadErr))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id, institution.id, today]);

  const teacherById = useMemo(() => new Map(teachers.map((item) => [item.id, item.name])), [teachers]);
  const roomById = useMemo(() => new Map(rooms.map((item) => [item.id, item.name])), [rooms]);

  const todayLessons: TodayLessonItem[] = useMemo(() => {
    return slots
      .filter((slot) => slot.day === weekday)
      .sort((a, b) => a.period - b.period)
      .map((slot) => {
        const periodInfo = PERIODS.find((p) => p.number === slot.period);
        const lessons = slotLessons(slot);
        const subject = [...new Set(lessons.map((l) => l.subject))].join(' / ');
        const teacherName = [...new Set(lessons.map((l) => (l.teacherId ? teacherById.get(l.teacherId) ?? '' : '')).filter(Boolean))].join(' / ');
        const roomName = [...new Set(lessons.map((l) => (l.roomId ? roomById.get(l.roomId) ?? '' : '')).filter(Boolean))].join(' / ');
        return {
          period: slot.period,
          start: periodInfo?.start ?? '',
          end: periodInfo?.end ?? '',
          subject,
          teacherName,
          roomName,
          isCurrent: activePeriod === slot.period,
        };
      });
  }, [slots, weekday, teacherById, roomById, activePeriod]);

  useEffect(() => {
    if (activePeriod) {
      setSelectedPeriod(activePeriod);
    } else if (todayLessons.length > 0) {
      setSelectedPeriod(todayLessons[0].period);
    }
  }, [activePeriod, todayLessons]);

  const currentLesson = todayLessons.find((item) => item.isCurrent) ?? null;
  const studentCanteenEntry = todayCanteen.find(
    (entry) => entry.studentId === student.id && entry.result === 'accepted',
  );

  const handleCanteenAction = async (confirmedAbsent = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirmAbsentCanteen(false);
    try {
      const absentIds = await loadWholeDayAbsentStudentIds(institution, allStudents, today);
      const decision = decideScan({
        student,
        date: today,
        todayEntries: todayCanteen,
        absentToday: absentIds.has(student.id),
        confirmedAbsent,
      });

      if (decision.kind === 'needsConfirmation') {
        setConfirmAbsentCanteen(true);
        setNotice({ tone: 'warning', text: t('canteen.result.absent') });
        playScanFeedback('warning');
        return;
      }

      const accepted = decision.kind === 'accepted';
      await recordCanteenScan(
        institution.id,
        {
          studentId: student.id,
          scannedCode,
          date: today,
          time: nowTime(),
          result: accepted ? 'accepted' : 'rejected',
          reason: accepted ? null : decision.reason,
          manual: false,
        },
        user.id,
      );
      await loadContext();

      if (accepted) {
        setNotice({ tone: 'success', text: t('cards.scanner.canteenRecorded') });
        playScanFeedback('success');
      } else {
        const reasonMap: Record<string, string> = {
          duplicate: t('canteen.result.duplicate'),
          external: t('canteen.result.external'),
          left: t('canteen.result.left'),
          unknown: t('canteen.result.unknown'),
        };
        setNotice({ tone: 'error', text: reasonMap[decision.reason] ?? t('canteen.result.unknown') });
        playScanFeedback('error');
      }
    } catch (actionError) {
      setError(t(errorKey(actionError)));
    } finally {
      setBusy(false);
    }
  };

  const handleAttendanceAction = async (status: 'absent' | 'late') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const lesson = todayLessons.find((item) => item.period === selectedPeriod);
      const subject = lesson?.subject || t('cards.scanner.defaultSubject');
      await recordQuickStudentAttendance(institution.id, user.id, {
        classId: student.classId,
        studentId: student.id,
        date: today,
        period: selectedPeriod,
        subject,
        status,
      });
      await loadContext();
      setNotice({
        tone: 'success',
        text:
          status === 'late'
            ? t('cards.scanner.lateRecorded', { period: selectedPeriod })
            : t('cards.scanner.absenceRecorded', { period: selectedPeriod }),
      });
      playScanFeedback('success');
    } catch (actionError) {
      setError(t(errorKey(actionError)));
    } finally {
      setBusy(false);
    }
  };

  const fullName = studentFullName(student);
  const regId = studentRegistrationNumber(student);
  const regime = formatStudentRegime(student.boardingStatus);

  return (
    <Modal open title={t('cards.scanner.profileTitle')} onClose={onClose}>
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pe-1">
        {/* Highlighted student summary */}
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4">
          <h3 className="text-lg font-bold text-neutral-900">{fullName}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
            <span className="font-semibold text-primary-800">{classNameLabel}</span>
            <span aria-hidden>·</span>
            <span>{regime}</span>
            <span aria-hidden>·</span>
            <span className="font-mono text-xs tabular-nums text-neutral-600" dir="ltr">
              {regId}
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-primary-100 pt-2.5 text-xs text-neutral-600">
            <span>
              {t('cards.scanner.canteenStatus')}:{' '}
              <strong className={studentCanteenEntry ? 'text-success-700' : 'text-neutral-800'}>
                {studentCanteenEntry
                  ? t('cards.scanner.enteredAt', { time: studentCanteenEntry.time })
                  : t('cards.scanner.notEntered')}
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>
              {t('cards.scanner.todayMarks')}:{' '}
              <strong className="tabular-nums text-neutral-900">{todayAbsences.length}</strong>
            </span>
          </div>
        </div>

        {notice ? (
          <div
            role="status"
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium ${
              notice.tone === 'success'
                ? 'border-success-200 bg-success-50 text-success-800'
                : notice.tone === 'warning'
                  ? 'border-warning-200 bg-warning-50 text-warning-800'
                  : 'border-danger-200 bg-danger-50 text-danger-800'
            }`}
          >
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{notice.text}</span>
            {confirmAbsentCanteen ? (
              <Button variant="secondary" onClick={() => void handleCanteenAction(true)} disabled={busy}>
                {t('canteen.result.confirmAccept')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <FormError message={error} />

        {/* One-tap offline actions */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-neutral-700">{t('cards.scanner.quickActions')}</h4>
            {cardAbsenceEnabled ? (
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                <span>{t('cards.scanner.periodLabel')}</span>
                <select
                  value={selectedPeriod}
                  onChange={(event) => setSelectedPeriod(Number(event.target.value))}
                  className="min-h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm font-semibold text-neutral-900 tabular-nums focus:border-primary-500 focus:outline-none"
                >
                  {PERIODS.map((p) => {
                    const match = todayLessons.find((l) => l.period === p.number);
                    return (
                      <option key={p.number} value={p.number}>
                        {t('cards.scanner.periodOption', { n: p.number })}
                        {match ? ` — ${match.subject}` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : null}
          </div>

          <div className={`grid grid-cols-1 gap-2 ${cardAbsenceEnabled ? 'sm:grid-cols-3' : ''}`}>
            <Button
              fullWidth
              onClick={() => void handleCanteenAction(false)}
              disabled={busy}
              icon={<Utensils className="size-4" aria-hidden />}
            >
              {t('cards.scanner.recordCanteen')}
            </Button>
            {cardAbsenceEnabled ? (
              <>
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => void handleAttendanceAction('absent')}
                  disabled={busy}
                  icon={<UserX className="size-4" aria-hidden />}
                >
                  {t('cards.scanner.recordAbsence')}
                </Button>
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => void handleAttendanceAction('late')}
                  disabled={busy}
                  icon={<Clock className="size-4" aria-hidden />}
                >
                  {t('cards.scanner.recordLate')}
                </Button>
              </>
            ) : null}
          </div>

          {!cardAbsenceEnabled ? (
            <p className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              {t('cards.scanner.cardAbsenceDisabled')}
            </p>
          ) : null}
        </section>

        {/* Current room & Today's schedule */}
        <section className="flex flex-col gap-2.5 border-t border-neutral-200 pt-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
            <CalendarClock className="size-4 text-primary-700" aria-hidden />
            <h4>{t('cards.scanner.todaySchedule')}</h4>
          </div>

          {currentLesson ? (
            <div className="rounded-xl border border-primary-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-primary-700">
                <span>{t('cards.scanner.currentLessonNow')}</span>
                <span className="tabular-nums" dir="ltr">
                  {currentLesson.start} – {currentLesson.end}
                </span>
              </div>
              <p className="mt-1 text-base font-bold text-neutral-900">{currentLesson.subject}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-600">
                {currentLesson.roomName ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-neutral-800">
                    <DoorOpen className="size-3.5 text-primary-600" aria-hidden />
                    {currentLesson.roomName}
                  </span>
                ) : null}
                {currentLesson.roomName && currentLesson.teacherName ? <span aria-hidden>·</span> : null}
                {currentLesson.teacherName ? <span>{currentLesson.teacherName}</span> : null}
              </div>
            </div>
          ) : null}

          {todayLessons.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('cards.scanner.noLessonsToday')}</p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
              {todayLessons.map((lesson) => {
                const existingMark = todayAbsences.find((a) => a.period === lesson.period);
                return (
                  <li
                    key={lesson.period}
                    className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                      lesson.isCurrent ? 'bg-primary-50/60' : ''
                    }`}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-neutral-900">
                        {t('cards.scanner.periodShort', { n: lesson.period })} · {lesson.subject}
                      </span>
                      <span className="truncate text-xs text-neutral-500">
                        {[lesson.roomName, lesson.teacherName].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                      <span className="tabular-nums text-neutral-500" dir="ltr">
                        {lesson.start}
                      </span>
                      {existingMark ? (
                        <span
                          className={`font-semibold ${
                            existingMark.status === 'late' ? 'text-warning-700' : 'text-danger-700'
                          }`}
                        >
                          {existingMark.status === 'late'
                            ? t('cards.scanner.markedLate')
                            : t('cards.scanner.markedAbsent')}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Footer actions */}
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-3">
          <Button variant="ghost" onClick={onViewCard}>
            {t('cards.viewCard')}
          </Button>
          <Button variant="secondary" onClick={onPrintCard} icon={<Printer className="size-4" aria-hidden />}>
            {t('cards.printSingle')}
          </Button>
          <div className="ms-auto">
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
