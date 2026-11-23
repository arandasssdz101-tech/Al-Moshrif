import { useMemo, useState } from 'react';
import {
  CalendarRange,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { FilterChip } from '@/components/ui/FilterChip';
import { EmptyState, FormError } from '@/components/ui/StatusBlock';
import type { AbsenceWorkspace } from '@/db/absences';
import { canAccessClass } from '@/db/access';
import { deleteContinuousAbsence } from '@/db/continuousAbsences';
import type { ContinuousAbsence } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { ContinuousAbsenceModal } from '@/modules/absences/ContinuousAbsenceModal';
import {
  evaluateContinuousAbsenceStatus,
  type ContinuousAbsenceStage,
} from '@/utils/continuousAbsences';
import { formatDate } from '@/utils/dailyReportHtml';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { normalizeText } from '@/utils/text';

type FilterMode = 'all' | 'open' | 'closed' | 'struck';

interface ContinuousAbsencesViewProps {
  data: AbsenceWorkspace;
  onChanged: () => void;
}

const STAGE_BADGE_CLASSES: Record<ContinuousAbsenceStage, string> = {
  upcoming: 'bg-neutral-100 text-neutral-700',
  active: 'bg-primary-50 text-primary-700',
  firstNotice: 'bg-warning-50 text-warning-800',
  secondNotice: 'bg-warning-100 text-warning-900',
  excuse: 'bg-danger-50 text-danger-700',
  struck: 'bg-danger-600 text-white',
  closed: 'bg-success-50 text-success-700',
};

export function ContinuousAbsencesView({ data, onChanged }: ContinuousAbsencesViewProps) {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const today = todayIso();

  const [filter, setFilter] = useState<FilterMode>('all');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContinuousAbsence | null>(null);
  const [forceCloseMode, setForceCloseMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContinuousAbsence | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const studentById = useMemo(
    () => new Map(data.students.map((student) => [student.id, student])),
    [data.students],
  );
  const classNameById = useMemo(
    () => new Map(data.classes.map((item) => [item.id, item.name])),
    [data.classes],
  );

  const enriched = useMemo(
    () =>
      data.continuousAbsences.map((record) => {
        const student = studentById.get(record.studentId);
        const className =
          classNameById.get(student?.classId ?? record.classId) ?? t('students.unknownClass');
        const studentName = student
          ? `${student.lastName} ${student.firstName}`.trim()
          : t('students.import.unnamedRow');
        const status = evaluateContinuousAbsenceStatus(record, today);
        return { record, studentName, className, status };
      }),
    [data.continuousAbsences, studentById, classNameById, today, t],
  );

  const summary = useMemo(() => {
    let openCount = 0;
    let noticesCount = 0;
    let struckCount = 0;
    for (const item of enriched) {
      if (item.status.stage === 'struck') {
        struckCount += 1;
      } else if (item.status.stage !== 'closed') {
        openCount += 1;
        if (item.status.firstNoticeReached) noticesCount += 1;
      }
    }
    return { openCount, noticesCount, struckCount };
  }, [enriched]);

  const visible = useMemo(() => {
    const needle = normalizeText(query);
    return enriched.filter((item) => {
      if (filter === 'open' && (item.status.stage === 'closed' || item.status.stage === 'struck')) {
        return false;
      }
      if (filter === 'closed' && item.status.stage !== 'closed') return false;
      if (filter === 'struck' && item.status.stage !== 'struck') return false;
      if (needle) {
        const hay = normalizeText(`${item.studentName} ${item.className} ${item.record.reason}`);
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [enriched, filter, query]);

  const handleOpenAdd = () => {
    setEditing(null);
    setForceCloseMode(false);
    setError(null);
    setNotice(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (record: ContinuousAbsence, recordReturn = false) => {
    setEditing(record);
    setForceCloseMode(recordReturn);
    setError(null);
    setNotice(null);
    setModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await deleteContinuousAbsence(deleteTarget.id, user.id);
      setDeleteTarget(null);
      setNotice(t('absences.continuous.deletedNotice'));
      onChanged();
    } catch (deleteError) {
      setDeleteTarget(null);
      setError(t(errorKey(deleteError)));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top action + summary stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data.access.canEdit && data.students.length > 0 ? (
          <Button onClick={handleOpenAdd} icon={<Plus className="size-5" aria-hidden />}>
            {t('absences.continuous.addButton')}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-neutral-200">
          <p className="text-xs text-neutral-500">{t('absences.continuous.summaryOpen')}</p>
          <p className="mt-1 text-2xl font-bold text-primary-700">{summary.openCount}</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-neutral-200">
          <p className="text-xs text-neutral-500">{t('absences.continuous.summaryNotices')}</p>
          <p className="mt-1 text-2xl font-bold text-warning-700">{summary.noticesCount}</p>
        </div>
        <div className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-neutral-200">
          <p className="text-xs text-neutral-500">{t('absences.continuous.summaryStruck')}</p>
          <p className="mt-1 text-2xl font-bold text-danger-700">{summary.struckCount}</p>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl bg-success-50 p-4 text-sm text-success-700 animate-fade-in"
        >
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          <p>{notice}</p>
        </div>
      ) : null}

      <FormError message={error} />

      {/* Search & Filters */}
      {enriched.length > 0 ? (
        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-2.5 rounded-xl bg-white px-3.5 ring-1 ring-neutral-300 transition focus-within:ring-4 focus-within:ring-primary-500/15">
            <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('absences.continuous.searchRecordsPlaceholder')}
              className="min-h-10 w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label={t('absences.continuous.filterAll')}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <FilterChip
              label={t('absences.continuous.filterOpen')}
              active={filter === 'open'}
              onClick={() => setFilter('open')}
            />
            <FilterChip
              label={t('absences.continuous.filterClosed')}
              active={filter === 'closed'}
              onClick={() => setFilter('closed')}
            />
            <FilterChip
              label={t('absences.continuous.filterStruck')}
              active={filter === 'struck'}
              onClick={() => setFilter('struck')}
            />
          </div>
        </div>
      ) : null}

      {/* Records List */}
      {enriched.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="size-7" aria-hidden />}
          title={t('absences.continuous.emptyTitle')}
          body={t('absences.continuous.emptyBody')}
        />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl bg-white px-6 py-10 text-center text-base text-neutral-500 ring-1 ring-neutral-200">
          {t('students.noMatches')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map(({ record, studentName, className, status }) => {
            const canEditRecord = data.access.canEdit && canAccessClass(data.access, record.classId);
            const rangeText =
              record.endDate === null
                ? t('absences.continuous.dateRangeOpen', { start: formatDate(record.startDate) })
                : t('absences.continuous.dateRangeClosed', {
                    start: formatDate(record.startDate),
                    end: formatDate(record.endDate),
                  });

            const milestones = [
              {
                label: t('absences.continuous.firstNotice'),
                date: formatDate(status.schedule.firstNoticeDate),
                reached: status.firstNoticeReached,
                tone: 'warning' as const,
              },
              {
                label: t('absences.continuous.secondNotice'),
                date: formatDate(status.schedule.secondNoticeDate),
                reached: status.secondNoticeReached,
                tone: 'warning' as const,
              },
              {
                label: t('absences.continuous.excuse'),
                date: formatDate(status.schedule.excuseDate),
                reached: status.excuseReached,
                tone: 'danger' as const,
              },
              {
                label: t('absences.continuous.strikeOff'),
                date: formatDate(status.schedule.strikeDate),
                reached: status.struck,
                tone: 'danger' as const,
              },
            ];

            return (
              <li
                key={record.id}
                className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200 animate-fade-in"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-neutral-900">{studentName}</span>
                      <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {className}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_BADGE_CLASSES[status.stage]}`}
                      >
                        {t(`absences.continuous.stages.${status.stage}`)}
                      </span>
                      {status.dayNumber > 0 && status.stage !== 'closed' ? (
                        <span className="text-xs font-medium text-neutral-500">
                          ({t('absences.continuous.dayCounter', { day: status.dayNumber })})
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-neutral-600">{rangeText}</p>
                    {record.reason ? (
                      <p className="text-xs text-neutral-500">{record.reason}</p>
                    ) : null}
                  </div>

                  {canEditRecord ? (
                    <div className="flex items-center gap-1.5">
                      {record.endDate === null && !status.struck ? (
                        <Button
                          variant="secondary"
                          onClick={() => handleOpenEdit(record, true)}
                          icon={<UserCheck className="size-4" aria-hidden />}
                          className="min-h-9 px-3 text-xs"
                        >
                          {t('absences.continuous.recordReturn')}
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(record, false)}
                        aria-label={t('absences.continuous.editAction')}
                        title={t('absences.continuous.editAction')}
                        className="flex size-9 items-center justify-center rounded-xl text-neutral-600 transition hover:bg-neutral-100"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(record)}
                        aria-label={t('absences.continuous.deleteAction')}
                        title={t('absences.continuous.deleteAction')}
                        className="flex size-9 items-center justify-center rounded-xl text-danger-600 transition hover:bg-danger-50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* 4-Stage Escalation Timeline */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {milestones.map((step) => {
                    const activeClasses = step.reached
                      ? step.tone === 'danger'
                        ? 'border-danger-200 bg-danger-50/80 text-danger-900'
                        : 'border-warning-200 bg-warning-50/80 text-warning-900'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-500';
                    return (
                      <div
                        key={step.label}
                        className={`flex flex-col gap-0.5 rounded-xl border px-2.5 py-2 text-xs ${activeClasses}`}
                      >
                        <span className="font-medium leading-tight">{step.label}</span>
                        <span dir="ltr" className="self-start font-mono text-[11px] font-semibold">
                          {step.date}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ContinuousAbsenceModal
        open={modalOpen}
        institutionId={institution.id}
        actorId={user.id}
        students={data.students}
        classes={data.classes}
        editing={editing}
        forceCloseMode={forceCloseMode}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setNotice(t('absences.continuous.savedNotice'));
          onChanged();
        }}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        title={t('absences.continuous.deleteTitle')}
        body={t('absences.continuous.deleteBody')}
        confirmLabel={t('absences.continuous.deleteAction')}
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
