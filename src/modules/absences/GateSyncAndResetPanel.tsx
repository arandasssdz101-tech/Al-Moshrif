import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import {
  resetDayAbsences,
  syncAbsencesWithGateEntries,
  type AbsenceWorkspace,
} from '@/db/absences';
import { getEntryDayClosure, listGateEntriesForDate } from '@/db/entries';
import { isCardAbsenceEnabled, updateCardAbsenceEnabled } from '@/db/institutions';
import type { EntryDayClosure, GateEntry } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { isSchoolDay } from '@/utils/absenceReports';
import { isIsoDate } from '@/utils/absences';
import { computeEntryStats } from '@/utils/entry';
import { errorKey } from '@/utils/errors';
import { groupResettableDayAbsences } from '@/utils/gateAbsenceSync';
import { PERIODS } from '@/utils/schedule';
import { normalizeText } from '@/utils/text';

interface GateSyncAndResetPanelProps {
  data: AbsenceWorkspace;
  date: string;
  activeClassId: string;
  activeClassName: string;
  onChanged: () => void;
}

type FullResetScope = 'all' | 'class' | 'gateOnly';

function periodShortLabel(periodNumber: number): string {
  const period = PERIODS.find((item) => item.number === periodNumber);
  return period ? `${periodNumber} (${period.start.slice(0, 2)})` : String(periodNumber);
}

export function GateSyncAndResetPanel({
  data,
  date,
  activeClassId,
  activeClassName,
  onChanged,
}: GateSyncAndResetPanelProps) {
  const { t } = useTranslation();
  const { user, institution, refresh } = useSession();

  const [entries, setEntries] = useState<GateEntry[]>([]);
  const [closure, setClosure] = useState<EntryDayClosure | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [zeroEntriesConfirmOpen, setZeroEntriesConfirmOpen] = useState(false);
  const [fullResetOpen, setFullResetOpen] = useState(false);
  const [fullResetScope, setFullResetScope] = useState<FullResetScope>('all');
  const [manualResetOpen, setManualResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const validDate = isIsoDate(date);
  const schoolDay = validDate && isSchoolDay(date, data.workingDays, new Set(data.holidayDates));
  const cardAbsenceEnabled = isCardAbsenceEnabled(institution);

  useEffect(() => {
    if (!validDate) return;
    let active = true;
    Promise.all([
      listGateEntriesForDate(institution.id, date),
      getEntryDayClosure(institution.id, date),
    ])
      .then(([gateRows, dayClosure]) => {
        if (!active) return;
        setEntries(gateRows);
        setClosure(dayClosure);
      })
      .catch(() => {
        // Keep previous state on transient read error
      });
    return () => {
      active = false;
    };
  }, [institution.id, date, validDate, data.studentAbsences.length]);

  const entryStats = useMemo(
    () => (validDate ? computeEntryStats(data.students, entries, date) : null),
    [data.students, entries, date, validDate],
  );

  const resetSummary = useMemo(
    () =>
      validDate
        ? groupResettableDayAbsences({
            date,
            absences: data.studentAbsences,
            students: data.students,
            classes: data.classes,
          })
        : {
            groups: [],
            totalResettableRecords: 0,
            gateRecordsCount: 0,
            manualRecordsCount: 0,
            continuousRecordsCount: 0,
          },
    [date, validDate, data.studentAbsences, data.students, data.classes],
  );

  const activeClassResetCount = useMemo(
    () =>
      resetSummary.groups
        .filter((g) => g.classId === activeClassId)
        .reduce((sum, g) => sum + g.records.length, 0),
    [resetSummary.groups, activeClassId],
  );

  const totalAbsentStudentsToday = useMemo(() => {
    if (!validDate) return 0;
    return new Set(
      data.studentAbsences
        .filter((record) => record.deletedAt === null && record.date === date && record.status !== 'late')
        .map((record) => record.studentId),
    ).size;
  }, [data.studentAbsences, date, validDate]);

  const handleToggleAutoSync = async () => {
    if (!data.access.isHead || togglingAuto) return;
    setTogglingAuto(true);
    setError(null);
    try {
      await updateCardAbsenceEnabled(institution.id, !cardAbsenceEnabled, user.id);
      await refresh();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setTogglingAuto(false);
    }
  };

  const executeGateSync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncAbsencesWithGateEntries(institution.id, user.id, date);
      const updatedClosure = await getEntryDayClosure(institution.id, date);
      setClosure(updatedClosure);
      setNotice(
        t('absences.gateSync.syncedNotice', {
          added: result.addedCount,
          removed: result.removedCount,
          absentStudents: result.absentStudentsAfterSync,
        }),
      );
      onChanged();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setSyncing(false);
      setZeroEntriesConfirmOpen(false);
    }
  };

  const handleSyncClick = () => {
    if (!validDate || !schoolDay || !data.access.canEdit || syncing) return;
    setError(null);
    setNotice(null);
    if (entryStats && entryStats.entered === 0 && entryStats.enrolled > 0) {
      setZeroEntriesConfirmOpen(true);
      return;
    }
    void executeGateSync();
  };

  const handleConfirmFullReset = async () => {
    if (!validDate || resetting) return;
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resetDayAbsences(institution.id, user.id, date, {
        mode: 'all',
        classId: fullResetScope === 'class' ? activeClassId : null,
        onlyGate: fullResetScope === 'gateOnly',
      });
      const updatedClosure = await getEntryDayClosure(institution.id, date);
      setClosure(updatedClosure);
      setFullResetOpen(false);
      setNotice(
        t('absences.resetDay.resetSuccess', {
          records: result.removedCount,
          students: result.affectedStudentsCount,
        }),
      );
      onChanged();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setResetting(false);
    }
  };

  const handleConfirmManualReset = async (absenceIds: string[]) => {
    if (!validDate || absenceIds.length === 0 || resetting) return;
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resetDayAbsences(institution.id, user.id, date, {
        mode: 'manual',
        absenceIds,
      });
      const updatedClosure = await getEntryDayClosure(institution.id, date);
      setClosure(updatedClosure);
      setManualResetOpen(false);
      setNotice(
        t('absences.resetDay.resetSuccess', {
          records: result.removedCount,
          students: result.affectedStudentsCount,
        }),
      );
      onChanged();
    } catch (cause) {
      setError(t(errorKey(cause)));
    } finally {
      setResetting(false);
    }
  };

  const selectedFullResetCount =
    fullResetScope === 'all'
      ? resetSummary.totalResettableRecords
      : fullResetScope === 'class'
        ? activeClassResetCount
        : resetSummary.gateRecordsCount;

  const isSyncedToday = Boolean(closure?.autoAbsencesSyncedAt);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      {/* Header: Sync with Card Entry */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <DoorOpen className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-neutral-900">{t('absences.gateSync.title')}</h2>
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  isSyncedToday
                    ? 'bg-success-50 text-success-700'
                    : cardAbsenceEnabled
                      ? 'bg-primary-50 text-primary-700'
                      : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {isSyncedToday
                  ? t('absences.gateSync.statusSynced')
                  : cardAbsenceEnabled
                    ? t('absences.gateSync.statusReady')
                    : t('absences.gateSync.statusAutoOff')}
              </span>
            </div>
            <p className="text-xs text-neutral-500">{t('absences.gateSync.subtitle')}</p>
          </div>
        </div>

        {data.access.isHead ? (
          <label className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
            <span>{t('absences.gateSync.autoToggleLabel')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={cardAbsenceEnabled}
              aria-label={t('absences.gateSync.autoToggleLabel')}
              disabled={togglingAuto}
              onClick={() => void handleToggleAutoSync()}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${
                cardAbsenceEnabled ? 'bg-primary-600' : 'bg-neutral-300'
              }`}
            >
              <span
                className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
                  cardAbsenceEnabled ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'
                }`}
              />
            </button>
          </label>
        ) : null}
      </div>

      {/* Live Entry & Absence Summary for Selected Date */}
      {entryStats ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center rounded-xl bg-success-50/70 px-2.5 py-2 text-center ring-1 ring-success-200/70">
            <span className="text-[11px] font-medium text-success-800">{t('absences.gateSync.enteredCount')}</span>
            <span className="text-lg font-extrabold tabular-nums text-success-700">{entryStats.entered}</span>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-warning-50/70 px-2.5 py-2 text-center ring-1 ring-warning-200/70">
            <span className="text-[11px] font-medium text-warning-800">{t('absences.gateSync.notEnteredCount')}</span>
            <span className="text-lg font-extrabold tabular-nums text-warning-700">{entryStats.notEntered}</span>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-danger-50/70 px-2.5 py-2 text-center ring-1 ring-danger-200/70">
            <span className="text-[11px] font-medium text-danger-800">{t('absences.gateSync.recordedAbsentCount')}</span>
            <span className="text-lg font-extrabold tabular-nums text-danger-700">{totalAbsentStudentsToday}</span>
          </div>
        </div>
      ) : null}

      {/* Primary Action Bar: Sync + Reset (Complete / Manual) */}
      {data.access.canEdit ? (
        <div className="flex flex-col gap-3 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handleSyncClick}
              disabled={!validDate || !schoolDay || syncing}
              icon={<RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden />}
            >
              {syncing ? t('absences.gateSync.syncing') : t('absences.gateSync.syncButton')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={!validDate || resetSummary.totalResettableRecords === 0 || resetting}
              onClick={() => {
                setFullResetScope('all');
                setFullResetOpen(true);
              }}
              icon={<RotateCcw className="size-4 text-danger-600" aria-hidden />}
              className="border-danger-200 text-danger-700 hover:bg-danger-50"
            >
              {t('absences.resetDay.fullButton')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              disabled={!validDate || resetSummary.totalResettableRecords === 0 || resetting}
              onClick={() => setManualResetOpen(true)}
              icon={<SlidersHorizontal className="size-4" aria-hidden />}
            >
              {t('absences.resetDay.manualButton')}
            </Button>
          </div>

          {resetSummary.totalResettableRecords === 0 && resetSummary.continuousRecordsCount > 0 ? (
            <p className="text-xs text-neutral-500">
              {t('absences.resetDay.onlyContinuousPresent', { count: resetSummary.continuousRecordsCount })}
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-xs font-semibold text-success-800"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-xs font-bold underline"
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      <FormError message={error} />

      {/* Safeguard Modal when 0 gate entries exist for selected date */}
      <Modal
        open={zeroEntriesConfirmOpen}
        title={t('absences.gateSync.zeroEntriesTitle')}
        description={t('absences.gateSync.zeroEntriesBody', {
          date,
          enrolled: entryStats?.enrolled ?? 0,
        })}
        onClose={() => setZeroEntriesConfirmOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl bg-warning-50 p-3 text-xs font-medium text-warning-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
            <span>{t('absences.gateSync.zeroEntriesHint')}</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              type="button"
              fullWidth
              disabled={syncing}
              onClick={() => void executeGateSync()}
              icon={<RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden />}
            >
              {t('absences.gateSync.confirmSyncAnyway')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              disabled={syncing}
              onClick={() => setZeroEntriesConfirmOpen(false)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Complete Reset Modal */}
      <Modal
        open={fullResetOpen}
        title={t('absences.resetDay.fullModalTitle')}
        description={t('absences.resetDay.fullModalSubtitle', { date })}
        onClose={() => setFullResetOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 has-[:checked]:border-danger-400 has-[:checked]:bg-danger-50/50">
              <input
                type="radio"
                name="fullResetScope"
                value="all"
                checked={fullResetScope === 'all'}
                onChange={() => setFullResetScope('all')}
                className="mt-1 size-4 text-danger-600 focus:ring-danger-500"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-neutral-900">
                  {t('absences.resetDay.scopeAll', {
                    records: resetSummary.totalResettableRecords,
                    students: resetSummary.groups.length,
                  })}
                </span>
                <span className="text-xs text-neutral-500">{t('absences.resetDay.scopeAllHint')}</span>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 has-[:checked]:border-danger-400 has-[:checked]:bg-danger-50/50">
              <input
                type="radio"
                name="fullResetScope"
                value="class"
                checked={fullResetScope === 'class'}
                onChange={() => setFullResetScope('class')}
                className="mt-1 size-4 text-danger-600 focus:ring-danger-500"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-neutral-900">
                  {t('absences.resetDay.scopeClass', {
                    className: activeClassName,
                    records: activeClassResetCount,
                  })}
                </span>
                <span className="text-xs text-neutral-500">{t('absences.resetDay.scopeClassHint')}</span>
              </div>
            </label>

            {resetSummary.gateRecordsCount > 0 ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 has-[:checked]:border-danger-400 has-[:checked]:bg-danger-50/50">
                <input
                  type="radio"
                  name="fullResetScope"
                  value="gateOnly"
                  checked={fullResetScope === 'gateOnly'}
                  onChange={() => setFullResetScope('gateOnly')}
                  className="mt-1 size-4 text-danger-600 focus:ring-danger-500"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-neutral-900">
                    {t('absences.resetDay.scopeGateOnly', { records: resetSummary.gateRecordsCount })}
                  </span>
                  <span className="text-xs text-neutral-500">{t('absences.resetDay.scopeGateOnlyHint')}</span>
                </div>
              </label>
            ) : null}
          </div>

          {resetSummary.continuousRecordsCount > 0 ? (
            <p className="rounded-xl bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
              {t('absences.resetDay.continuousPreservedNote', { count: resetSummary.continuousRecordsCount })}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              type="button"
              variant="danger"
              fullWidth
              disabled={selectedFullResetCount === 0 || resetting}
              onClick={() => void handleConfirmFullReset()}
              icon={<RotateCcw className="size-4" aria-hidden />}
            >
              {t('absences.resetDay.confirmFull', { count: selectedFullResetCount })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              fullWidth
              disabled={resetting}
              onClick={() => setFullResetOpen(false)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Manual Selective Reset Modal */}
      {manualResetOpen ? (
        <ManualResetModal
          open={manualResetOpen}
          date={date}
          resetSummary={resetSummary}
          classes={data.classes}
          submitting={resetting}
          onClose={() => setManualResetOpen(false)}
          onConfirm={(ids) => void handleConfirmManualReset(ids)}
        />
      ) : null}
    </section>
  );
}

interface ManualResetModalProps {
  open: boolean;
  date: string;
  resetSummary: ReturnType<typeof groupResettableDayAbsences>;
  classes: AbsenceWorkspace['classes'];
  submitting: boolean;
  onClose: () => void;
  onConfirm: (absenceIds: string[]) => void;
}

function ManualResetModal({
  open,
  date,
  resetSummary,
  classes,
  submitting,
  onClose,
  onConfirm,
}: ManualResetModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'gate' | 'manual'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const classesWithAbsences = useMemo(() => {
    const ids = new Set(resetSummary.groups.map((group) => group.classId));
    return classes.filter((item) => ids.has(item.id));
  }, [classes, resetSummary.groups]);

  const visibleGroups = useMemo(() => {
    const needle = normalizeText(query);
    return resetSummary.groups
      .filter((group) => {
        if (classFilter !== null && group.classId !== classFilter) return false;
        if (
          needle !== '' &&
          !normalizeText(`${group.lastName} ${group.firstName}`).includes(needle) &&
          !normalizeText(`${group.firstName} ${group.lastName}`).includes(needle) &&
          !normalizeText(group.className).includes(needle)
        ) {
          return false;
        }
        return true;
      })
      .map((group) => ({
        ...group,
        records: group.records.filter((r) => sourceFilter === 'all' || r.source === sourceFilter),
      }))
      .filter((group) => group.records.length > 0);
  }, [resetSummary.groups, classFilter, query, sourceFilter]);

  const visibleRecordIds = useMemo(
    () => visibleGroups.flatMap((group) => group.records.map((record) => record.id)),
    [visibleGroups],
  );

  const allVisibleSelected =
    visibleRecordIds.length > 0 && visibleRecordIds.every((id) => selectedIds.has(id));

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleRecordIds) next.delete(id);
      } else {
        for (const id of visibleRecordIds) next.add(id);
      }
      return next;
    });
  };

  const toggleStudentRecords = (recordIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = recordIds.every((id) => next.has(id));
      for (const id of recordIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleSingleRecord = (recordId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  return (
    <Modal
      open={open}
      title={t('absences.resetDay.manualModalTitle')}
      description={t('absences.resetDay.manualModalSubtitle', { date })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-2.5 rounded-xl border border-neutral-300 bg-white px-3 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-200">
          <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('absences.resetDay.searchPlaceholder')}
            className="min-h-10 w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
          />
        </label>

        {classesWithAbsences.length > 1 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <FilterChip
              label={t('students.allClasses')}
              active={classFilter === null}
              onClick={() => setClassFilter(null)}
            />
            {classesWithAbsences.map((item) => (
              <FilterChip
                key={item.id}
                label={item.name}
                active={classFilter === item.id}
                onClick={() => setClassFilter(item.id)}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'gate', 'manual'] as const).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setSourceFilter(src)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  sourceFilter === src
                    ? 'bg-primary-600 text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {t(`absences.resetDay.sourceFilter.${src}`)}
              </button>
            ))}
          </div>
          {visibleRecordIds.length > 0 ? (
            <button
              type="button"
              onClick={toggleAllVisible}
              className="text-xs font-bold text-primary-700 hover:underline"
            >
              {allVisibleSelected
                ? t('absences.resetDay.deselectAll')
                : t('absences.resetDay.selectAll', { count: visibleRecordIds.length })}
            </button>
          ) : null}
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-50/50 p-2">
          {visibleGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              {t('absences.resetDay.noMatchingAbsences')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleGroups.map((group) => {
                const recordIds = group.records.map((r) => r.id);
                const selectedCount = recordIds.filter((id) => selectedIds.has(id)).length;
                const allStudentSelected = selectedCount === recordIds.length;
                return (
                  <li
                    key={group.studentId}
                    className={`flex flex-col gap-2 rounded-xl border p-3 transition ${
                      selectedCount > 0
                        ? 'border-danger-300 bg-danger-50/40'
                        : 'border-neutral-200 bg-white'
                    }`}
                  >
                    <label className="flex cursor-pointer items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={allStudentSelected}
                          onChange={() => toggleStudentRecords(recordIds)}
                          className="mt-1 size-4 rounded border-neutral-300 text-danger-600 focus:ring-danger-500"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="break-words text-sm leading-snug text-neutral-900">
                            <span className="font-bold">{group.lastName}</span>{' '}
                            <span className="font-medium text-neutral-700">{group.firstName}</span>
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-700">
                              {group.className}
                            </span>
                            {group.hasGate ? (
                              <span className="rounded bg-primary-50 px-1.5 py-0.5 font-semibold text-primary-700">
                                {t('absences.resetDay.sourceBadge.gate')}
                              </span>
                            ) : null}
                            {group.hasManual ? (
                              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-600">
                                {t('absences.resetDay.sourceBadge.manual')}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-500">
                        {selectedCount}/{recordIds.length}
                      </span>
                    </label>

                    <div className="flex flex-wrap gap-1.5 ps-6">
                      {group.records.map((record) => {
                        const checked = selectedIds.has(record.id);
                        return (
                          <button
                            key={record.id}
                            type="button"
                            onClick={() => toggleSingleRecord(record.id)}
                            className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                              checked
                                ? 'bg-danger-600 text-white shadow-xs'
                                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                            }`}
                          >
                            {t('absences.resetDay.periodChip', {
                              period: periodShortLabel(record.period),
                            })}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {resetSummary.continuousRecordsCount > 0 ? (
          <p className="rounded-xl bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
            {t('absences.resetDay.continuousPreservedNote', { count: resetSummary.continuousRecordsCount })}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
          <Button
            type="button"
            variant="danger"
            fullWidth
            disabled={selectedIds.size === 0 || submitting}
            onClick={() => onConfirm([...selectedIds])}
            icon={<RotateCcw className="size-4" aria-hidden />}
          >
            {t('absences.resetDay.confirmManual', { count: selectedIds.size })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            fullWidth
            disabled={submitting}
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
