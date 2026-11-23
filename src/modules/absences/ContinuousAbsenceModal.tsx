import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Search, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import { TextField } from '@/components/ui/TextField';
import { saveContinuousAbsence } from '@/db/continuousAbsences';
import type { ContinuousAbsence, SchoolClass, Student } from '@/db/types';
import { isIsoDate } from '@/utils/absences';
import { computeNoticeSchedule } from '@/utils/continuousAbsences';
import { formatDate } from '@/utils/dailyReportHtml';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { isStudentActive } from '@/utils/statistics';
import { normalizeText } from '@/utils/text';

export interface ContinuousAbsenceModalProps {
  open: boolean;
  institutionId: string;
  actorId: string;
  students: Student[];
  classes: SchoolClass[];
  editing: ContinuousAbsence | null;
  forceCloseMode?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ContinuousAbsenceModal({
  open,
  institutionId,
  actorId,
  students,
  classes,
  editing,
  forceCloseMode = false,
  onClose,
  onSaved,
}: ContinuousAbsenceModalProps) {
  const { t } = useTranslation();
  const today = todayIso();

  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(today);
  const [isOpenAbsence, setIsOpenAbsence] = useState<boolean>(true);
  const [endDate, setEndDate] = useState<string>(today);
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classNameById = useMemo(
    () => new Map(classes.map((item) => [item.id, item.name])),
    [classes],
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setSelectedStudentId(editing.studentId);
      setStartDate(editing.startDate);
      if (forceCloseMode) {
        setIsOpenAbsence(false);
        setEndDate(editing.endDate ?? (today >= editing.startDate ? today : editing.startDate));
      } else {
        setIsOpenAbsence(editing.endDate === null);
        setEndDate(editing.endDate ?? (today >= editing.startDate ? today : editing.startDate));
      }
      setReason(editing.reason);
    } else {
      setSelectedStudentId('');
      setStudentQuery('');
      setStartDate(today);
      setIsOpenAbsence(true);
      setEndDate(today);
      setReason('');
    }
    setError(null);
    setSubmitting(false);
  }, [open, editing, forceCloseMode, today]);

  const activeStudents = useMemo(
    () =>
      students
        .filter((student) => isStudentActive(student, today) || student.id === editing?.studentId)
        .sort(
          (a, b) =>
            (classNameById.get(a.classId) ?? '').localeCompare(
              classNameById.get(b.classId) ?? '',
              undefined,
              { numeric: true },
            ) || a.lastName.localeCompare(b.lastName),
        ),
    [students, today, editing?.studentId, classNameById],
  );

  const selectedStudent = useMemo(
    () => activeStudents.find((item) => item.id === selectedStudentId) ?? null,
    [activeStudents, selectedStudentId],
  );

  const filteredStudents = useMemo(() => {
    const needle = normalizeText(studentQuery);
    const list = needle
      ? activeStudents.filter((student) => {
          const className = classNameById.get(student.classId) ?? '';
          const searchable = normalizeText(
            `${student.lastName} ${student.firstName} ${student.firstName} ${student.lastName} ${className}`,
          );
          return searchable.includes(needle);
        })
      : activeStudents;
    return list.slice(0, 25);
  }, [activeStudents, studentQuery, classNameById]);

  const schedule = useMemo(
    () => (isIsoDate(startDate) ? computeNoticeSchedule(startDate) : null),
    [startDate],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStudentId) {
      setError(t('absences.continuous.errors.selectStudent'));
      return;
    }
    if (!isIsoDate(startDate)) {
      setError(t('validation.invalidDate'));
      return;
    }
    const resolvedEnd = isOpenAbsence ? null : endDate;
    if (resolvedEnd !== null) {
      if (!isIsoDate(resolvedEnd)) {
        setError(t('validation.invalidDate'));
        return;
      }
      if (resolvedEnd < startDate) {
        setError(t('absences.continuous.errors.endBeforeStart'));
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      await saveContinuousAbsence(institutionId, actorId, {
        id: editing?.id,
        studentId: selectedStudentId,
        startDate,
        endDate: resolvedEnd,
        reason,
      });
      onSaved();
      onClose();
    } catch (saveError) {
      setError(t(errorKey(saveError)));
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = forceCloseMode
    ? t('absences.continuous.returnTitle')
    : editing
      ? t('absences.continuous.editTitle')
      : t('absences.continuous.addTitle');

  return (
    <Modal
      open={open}
      title={modalTitle}
      description={t('absences.continuous.subtitle')}
      onClose={submitting ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={error} />

        {/* Student Search / Selection */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-neutral-700">
            {t('absences.continuous.searchStudentLabel')}
          </span>
          {selectedStudent ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50/70 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <UserCheck className="size-5 shrink-0 text-primary-700" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-neutral-900">
                    {selectedStudent.lastName} {selectedStudent.firstName}
                  </p>
                  <p className="text-xs text-neutral-600">
                    {classNameById.get(selectedStudent.classId) ?? ''}
                  </p>
                </div>
              </div>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStudentId('');
                    setError(null);
                  }}
                  disabled={submitting}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-100"
                >
                  {t('absences.continuous.changeStudent')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex min-h-11 items-center gap-2.5 rounded-xl border border-neutral-300 bg-white px-3.5 transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/15">
                <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
                <input
                  type="search"
                  value={studentQuery}
                  onChange={(event) => {
                    setStudentQuery(event.target.value);
                    setError(null);
                  }}
                  placeholder={t('absences.continuous.searchStudentPlaceholder')}
                  className="min-h-10 w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
                  disabled={submitting}
                />
              </label>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                {filteredStudents.length === 0 ? (
                  <p className="p-3 text-center text-sm text-neutral-500">
                    {t('absences.continuous.noMatchingStudents')}
                  </p>
                ) : (
                  filteredStudents.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => {
                        setSelectedStudentId(student.id);
                        setError(null);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-start text-sm transition hover:bg-primary-50/70"
                    >
                      <span className="truncate font-medium text-neutral-900">
                        {student.lastName} {student.firstName}
                      </span>
                      <span className="shrink-0 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                        {classNameById.get(student.classId) ?? ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Start Date */}
        <TextField
          label={t('absences.continuous.startDate')}
          type="date"
          value={startDate}
          onChange={(event) => {
            const next = event.target.value;
            setStartDate(next);
            if (!isOpenAbsence && endDate < next) {
              setEndDate(next);
            }
            setError(null);
          }}
          disabled={submitting}
          required
        />

        {/* Open vs Closed End Date */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-neutral-700">
            {t('absences.continuous.statusType')}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition ${
                isOpenAbsence
                  ? 'border-primary-500 bg-primary-50/60 font-medium text-primary-900'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <input
                type="radio"
                name="continuous-status-type"
                checked={isOpenAbsence}
                onChange={() => {
                  setIsOpenAbsence(true);
                  setError(null);
                }}
                disabled={submitting}
                className="accent-primary-600"
              />
              <span>{t('absences.continuous.openAbsence')}</span>
            </label>
            <label
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition ${
                !isOpenAbsence
                  ? 'border-primary-500 bg-primary-50/60 font-medium text-primary-900'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <input
                type="radio"
                name="continuous-status-type"
                checked={!isOpenAbsence}
                onChange={() => {
                  setIsOpenAbsence(false);
                  if (endDate < startDate) setEndDate(startDate);
                  setError(null);
                }}
                disabled={submitting}
                className="accent-primary-600"
              />
              <span>{t('absences.continuous.closedAbsence')}</span>
            </label>
          </div>
        </div>

        {!isOpenAbsence ? (
          <TextField
            label={t('absences.continuous.endDate')}
            type="date"
            min={startDate}
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
              setError(null);
            }}
            disabled={submitting}
            required
          />
        ) : null}

        {/* Optional Reason */}
        <TextField
          label={t('absences.continuous.reasonLabel')}
          placeholder={t('absences.continuous.reasonPlaceholder')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={submitting}
        />

        {/* Automatic Notice & Strike-off Schedule Preview */}
        {schedule ? (
          <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 text-xs">
            <div className="flex items-center gap-2 font-bold text-neutral-800">
              <CalendarClock className="size-4 text-primary-600" aria-hidden />
              <span>{t('absences.continuous.scheduleTitle')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-neutral-700">
              <div className="rounded-lg bg-white p-2 ring-1 ring-neutral-200">
                <p className="text-[11px] text-neutral-500">{t('absences.continuous.firstNotice')}</p>
                <p dir="ltr" className="mt-0.5 text-end font-semibold text-neutral-900">
                  {formatDate(schedule.firstNoticeDate)}
                </p>
              </div>
              <div className="rounded-lg bg-white p-2 ring-1 ring-neutral-200">
                <p className="text-[11px] text-neutral-500">{t('absences.continuous.secondNotice')}</p>
                <p dir="ltr" className="mt-0.5 text-end font-semibold text-neutral-900">
                  {formatDate(schedule.secondNoticeDate)}
                </p>
              </div>
              <div className="rounded-lg bg-white p-2 ring-1 ring-neutral-200">
                <p className="text-[11px] text-neutral-500">{t('absences.continuous.excuse')}</p>
                <p dir="ltr" className="mt-0.5 text-end font-semibold text-warning-700">
                  {formatDate(schedule.excuseDate)}
                </p>
              </div>
              <div className="rounded-lg bg-white p-2 ring-1 ring-neutral-200">
                <p className="text-[11px] text-neutral-500">{t('absences.continuous.strikeOff')}</p>
                <p dir="ltr" className="mt-0.5 text-end font-semibold text-danger-700">
                  {formatDate(schedule.strikeDate)}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('common.loading') : t('absences.continuous.saveAction')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
