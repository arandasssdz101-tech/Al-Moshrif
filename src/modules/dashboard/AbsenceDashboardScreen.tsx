import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  DoorOpen,
  LayoutDashboard,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState, ErrorState, FormError, LoadingState } from '@/components/ui/StatusBlock';
import { loadAbsenceWorkspace, syncAbsencesWithGateEntries } from '@/db/absences';
import { getEntryDayClosure, listGateEntriesForDate } from '@/db/entries';
import type { EntryDayClosure, GateEntry } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import {
  ClassAbsenceComparisonChart,
  MonthlyAbsenceChart,
  WeeklyAbsenceChart,
  type DashboardMetricMode,
} from '@/modules/dashboard/AbsenceDashboardCharts';
import type { TabId } from '@/modules/shell/AppShell';
import { buildAbsenceDashboard } from '@/utils/absenceDashboard';
import { isSchoolDay } from '@/utils/absenceReports';
import { isIsoDate } from '@/utils/absences';
import { CLASS_LEVELS, classLevelOf } from '@/utils/classLevel';
import { subscribeAppDataChanged } from '@/utils/dataEvents';
import { todayIso } from '@/utils/dates';
import { computeEntryStats } from '@/utils/entry';
import { errorKey } from '@/utils/errors';
import { useAsyncData } from '@/utils/useAsyncData';

type LevelFilter = 'all' | 1 | 2 | 3 | 4;
type TableTab = 'weekly' | 'monthly';

interface AbsenceDashboardScreenProps {
  onNavigate?: (tab: TabId) => void;
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function formatShortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

function formatMonthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function formatTimeHm(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function AbsenceDashboardScreen({ onNavigate }: AbsenceDashboardScreenProps) {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const workspace = useAsyncData(
    () => loadAbsenceWorkspace(institution.id, user.id),
    [institution.id, user.id],
  );
  const today = todayIso();

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [classId, setClassId] = useState<'all' | string>('all');
  const [metricMode, setMetricMode] = useState<DashboardMetricMode>('rate');
  const [weeksCount, setWeeksCount] = useState<8 | 12>(8);
  const [monthsCount, setMonthsCount] = useState<6 | 12>(6);
  const [tableTab, setTableTab] = useState<TableTab>('weekly');

  // Live link with Gate Entries & Absence Sync
  const [syncDate, setSyncDate] = useState(today);
  const [gateEntries, setGateEntries] = useState<GateEntry[]>([]);
  const [dayClosure, setDayClosure] = useState<EntryDayClosure | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [zeroEntriesConfirmOpen, setZeroEntriesConfirmOpen] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(() => new Date().toISOString());

  const loadSyncSnapshot = useCallback(async () => {
    if (!isIsoDate(syncDate)) return;
    try {
      const [entries, closure] = await Promise.all([
        listGateEntriesForDate(institution.id, syncDate),
        getEntryDayClosure(institution.id, syncDate),
      ]);
      setGateEntries(entries);
      setDayClosure(closure);
      setLastRefreshedAt(new Date().toISOString());
    } catch {
      // Preserve last loaded snapshot on transient read failure
    }
  }, [institution.id, syncDate]);

  useEffect(() => {
    loadSyncSnapshot();
  }, [loadSyncSnapshot]);

  const reloadWorkspace = workspace.reload;

  const reloadDashboardAndSync = useCallback(async () => {
    setRefreshing(true);
    try {
      reloadWorkspace();
      await loadSyncSnapshot();
    } finally {
      setRefreshing(false);
    }
  }, [reloadWorkspace, loadSyncSnapshot]);

  // Auto-refresh whenever absences, gate entries, syncs, merges, or resets happen anywhere in the app
  useEffect(() => {
    const unsub = subscribeAppDataChanged(
      ['absences', 'entries', 'sync', 'students', 'timetable'],
      () => {
        reloadWorkspace();
        loadSyncSnapshot();
      },
    );
    const onFocus = () => {
      reloadWorkspace();
      loadSyncSnapshot();
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        reloadWorkspace();
        loadSyncSnapshot();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      unsub();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [reloadWorkspace, loadSyncSnapshot]);

  const data = workspace.data;

  const availableLevels = useMemo(() => {
    if (!data) return [];
    const present = new Set<number>();
    for (const c of data.classes) {
      const lvl = classLevelOf(c);
      if (lvl !== null) present.add(lvl);
    }
    return CLASS_LEVELS.filter((lvl) => present.has(lvl));
  }, [data]);

  const classesInLevel = useMemo(() => {
    if (!data) return [];
    if (levelFilter === 'all') return data.classes;
    return data.classes.filter((c) => classLevelOf(c) === levelFilter);
  }, [data, levelFilter]);

  const activeClassId =
    classId !== 'all' && !classesInLevel.some((c) => c.id === classId) ? 'all' : classId;

  const summary = useMemo(() => {
    if (!data) return null;
    return buildAbsenceDashboard({
      classes: data.classes,
      students: data.students,
      slots: data.slots,
      studentAbsences: data.studentAbsences,
      workingDays: data.workingDays,
      holidayDates: data.holidayDates,
      referenceDate: today,
      weeksCount,
      monthsCount,
      levelFilter,
      classId: activeClassId,
    });
  }, [data, today, weeksCount, monthsCount, levelFilter, activeClassId]);

  const validSyncDate = isIsoDate(syncDate);
  const syncDateIsSchoolDay = Boolean(
    data && validSyncDate && isSchoolDay(syncDate, data.workingDays, new Set(data.holidayDates)),
  );

  const syncDayStats = useMemo(() => {
    if (!data || !validSyncDate) return null;
    const entryStats = computeEntryStats(data.students, gateEntries, syncDate);
    const dayAbsences = data.studentAbsences.filter(
      (record) => record.deletedAt === null && record.date === syncDate && record.status !== 'late',
    );
    const absentStudentsCount = new Set(dayAbsences.map((item) => item.studentId)).size;
    return {
      ...entryStats,
      absentStudentsCount,
      absentHoursCount: dayAbsences.length,
    };
  }, [data, gateEntries, syncDate, validSyncDate]);

  const executeSync = async () => {
    if (!validSyncDate) return;
    setSyncing(true);
    setSyncError(null);
    setSyncNotice(null);
    try {
      const result = await syncAbsencesWithGateEntries(institution.id, user.id, syncDate);
      workspace.reload();
      await loadSyncSnapshot();
      setSyncNotice(
        t('dashboard.sync.syncedNotice', {
          added: result.addedCount,
          removed: result.removedCount,
          absent: result.absentStudentsAfterSync,
        }),
      );
    } catch (cause) {
      setSyncError(t(errorKey(cause)));
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncClick = () => {
    if (!syncDateIsSchoolDay || syncing) return;
    if (syncDayStats && syncDayStats.entered === 0 && syncDayStats.enrolled > 0) {
      setZeroEntriesConfirmOpen(true);
      return;
    }
    executeSync();
  };

  if (workspace.loading && !data) return <LoadingState />;
  if (workspace.error || !data || !summary) {
    return <ErrorState message={t(errorKey(workspace.error))} onRetry={workspace.reload} />;
  }

  const isHead = data.access.isHead;
  const useHoursFallback = !summary.hasTimetable;
  const lastSyncTimeLabel = formatTimeHm(dayClosure?.autoAbsencesSyncedAt, i18n.language);
  const lastUpdatedLabel = formatTimeHm(lastRefreshedAt, i18n.language);

  if (data.classes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl text-neutral-900">{t('dashboard.title')}</h1>
          <p className="text-base text-neutral-600">{t('dashboard.subtitle')}</p>
        </header>
        <div className="flex flex-col items-center gap-4">
          <div className="w-full">
            <EmptyState
              icon={<LayoutDashboard className="size-7" aria-hidden />}
              title={t('dashboard.emptyClassesTitle')}
              body={t('dashboard.emptyClassesBody')}
            />
          </div>
          {onNavigate ? (
            <Button onClick={() => onNavigate('students')}>
              {t('dashboard.goToStudents')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl text-neutral-900">{t('dashboard.title')}</h1>
          <p className="text-sm text-neutral-600">
            {isHead ? t('dashboard.subtitleHead') : t('dashboard.subtitleSupervisor')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={reloadDashboardAndSync}
            disabled={refreshing}
            className="whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            {t('dashboard.sync.refreshButton')}
          </Button>
          {onNavigate ? (
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => onNavigate('entry')}
                className="whitespace-nowrap shrink-0"
              >
                <DoorOpen className="size-4" aria-hidden />
                {t('dashboard.openEntryAction')}
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => onNavigate('absences')}
                className="whitespace-nowrap shrink-0"
              >
                {t('dashboard.recordAbsencesAction')}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* Live Absence & Gate Sync Bar */}
      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-neutral-900">{t('dashboard.sync.title')}</h2>
              {lastUpdatedLabel ? (
                <span className="text-xs text-neutral-500">
                  · {t('dashboard.sync.lastUpdated', { time: lastUpdatedLabel })}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-neutral-500">{t('dashboard.sync.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="dashboard-sync-date">
              {t('dashboard.sync.dateLabel')}
            </label>
            <input
              id="dashboard-sync-date"
              type="date"
              value={syncDate}
              max={today}
              onChange={(e) => {
                setSyncDate(e.target.value);
                setSyncNotice(null);
                setSyncError(null);
              }}
              className="min-h-10 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs font-semibold text-neutral-900 focus:border-primary-500 focus:bg-white"
            />
            {syncDate !== today ? (
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setSyncDate(today);
                  setSyncNotice(null);
                  setSyncError(null);
                }}
              >
                {t('entry.today.backToToday')}
              </Button>
            ) : null}
            {data.access.canEdit ? (
              <Button
                type="button"
                onClick={handleSyncClick}
                disabled={syncing || !syncDateIsSchoolDay}
                className="whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
                {syncing ? t('dashboard.sync.syncing') : t('dashboard.sync.syncButton')}
              </Button>
            ) : null}
          </div>
        </div>

        {syncDayStats ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="flex flex-col rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
              <span className="text-[11px] font-medium text-neutral-500">
                {t('dashboard.sync.statEntered')}
              </span>
              <span className="mt-0.5 text-base font-bold tabular-nums text-success-700">
                {syncDayStats.entered}{' '}
                <span className="text-xs font-medium text-neutral-500">
                  / {syncDayStats.enrolled}
                </span>
              </span>
            </div>

            <div className="flex flex-col rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
              <span className="text-[11px] font-medium text-neutral-500">
                {t('dashboard.sync.statNotEntered')}
              </span>
              <span className="mt-0.5 text-base font-bold tabular-nums text-warning-700">
                {syncDayStats.notEntered}
              </span>
            </div>

            <div className="flex flex-col rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
              <span className="text-[11px] font-medium text-neutral-500">
                {t('dashboard.sync.statRecordedAbsences')}
              </span>
              <span className="mt-0.5 text-base font-bold tabular-nums text-danger-700">
                {syncDayStats.absentStudentsCount}{' '}
                <span className="text-xs font-medium text-neutral-500">
                  ({syncDayStats.absentHoursCount} {t('dashboard.hoursAbbr')})
                </span>
              </span>
            </div>

            <div className="flex flex-col rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
              <span className="text-[11px] font-medium text-neutral-500">
                {t('dashboard.sync.statStatus')}
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-xs font-bold text-neutral-800">
                {!syncDateIsSchoolDay ? (
                  <span className="text-neutral-500">{t('dashboard.sync.statusNonSchoolDay')}</span>
                ) : lastSyncTimeLabel ? (
                  <>
                    <CheckCircle2 className="size-3.5 shrink-0 text-success-600" aria-hidden />
                    <span className="text-success-700">
                      {t('dashboard.sync.statusSyncedAt', { time: lastSyncTimeLabel })}
                    </span>
                  </>
                ) : (
                  <span className="text-warning-700">{t('dashboard.sync.statusNotSynced')}</span>
                )}
              </span>
            </div>
          </div>
        ) : null}

        {syncNotice ? (
          <div className="flex items-center gap-2 rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-xs font-medium text-success-900">
            <CheckCircle2 className="size-4 shrink-0 text-success-700" aria-hidden />
            <span>{syncNotice}</span>
          </div>
        ) : null}

        <FormError message={syncError} />
      </section>

      <Modal
        open={zeroEntriesConfirmOpen}
        onClose={() => setZeroEntriesConfirmOpen(false)}
        title={t('dashboard.sync.zeroEntriesTitle')}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
            <span>
              {t('dashboard.sync.zeroEntriesBody', {
                date: syncDate,
                count: syncDayStats?.enrolled ?? 0,
              })}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setZeroEntriesConfirmOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={() => {
                setZeroEntriesConfirmOpen(false);
                executeSync();
              }}
            >
              {t('dashboard.sync.zeroEntriesConfirm')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Filters & Metric Mode */}
      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {availableLevels.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                label={t('dashboard.allLevels')}
                active={levelFilter === 'all'}
                onClick={() => {
                  setLevelFilter('all');
                  setClassId('all');
                }}
              />
              {availableLevels.map((lvl) => (
                <FilterChip
                  key={lvl}
                  label={t(`statistics.levelShort.${lvl}`)}
                  active={levelFilter === lvl}
                  onClick={() => {
                    setLevelFilter(lvl);
                    setClassId('all');
                  }}
                />
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="dashboard-class-filter">
              {t('dashboard.classFilterLabel')}
            </label>
            <select
              id="dashboard-class-filter"
              value={activeClassId}
              onChange={(e) => setClassId(e.target.value)}
              className="min-h-10 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-900 focus:border-primary-500 focus:bg-white"
            >
              <option value="all">{t('dashboard.allClasses')}</option>
              {classesInLevel.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SegmentedControl<DashboardMetricMode>
          value={metricMode}
          onChange={setMetricMode}
          options={[
            {
              id: 'rate',
              label: useHoursFallback
                ? t('dashboard.modeTotalHours')
                : t('dashboard.modeRate'),
            },
            {
              id: 'split',
              label: t('dashboard.modeJustifiedSplit'),
            },
          ]}
        />
      </section>

      {useHoursFallback ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-700" aria-hidden />
            <span>{t('dashboard.noTimetableNotice')}</span>
          </div>
          {onNavigate ? (
            <Button variant="secondary" onClick={() => onNavigate('timetable')}>
              {t('dashboard.goToTimetable')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* KPI Strip */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={t('dashboard.kpiCurrentWeek')}
          value={
            useHoursFallback
              ? String(summary.currentWeek?.absentHours ?? 0)
              : formatRate(summary.currentWeek?.rate)
          }
          subtext={
            useHoursFallback
              ? t('dashboard.hoursUnit')
              : t('dashboard.hoursShort', { count: summary.currentWeek?.absentHours ?? 0 })
          }
          delta={useHoursFallback ? null : summary.weekDelta}
          deltaLabel={t('dashboard.vsPreviousWeek')}
        />

        <KpiCard
          label={t('dashboard.kpiCurrentMonth')}
          value={
            useHoursFallback
              ? String(summary.currentMonth?.absentHours ?? 0)
              : formatRate(summary.currentMonth?.rate)
          }
          subtext={
            useHoursFallback
              ? t('dashboard.hoursUnit')
              : t('dashboard.hoursShort', { count: summary.currentMonth?.absentHours ?? 0 })
          }
          delta={useHoursFallback ? null : summary.monthDelta}
          deltaLabel={t('dashboard.vsPreviousMonth')}
        />

        <KpiCard
          label={t('dashboard.kpiPeriodAverage', { count: monthsCount })}
          value={
            useHoursFallback
              ? String(summary.totalAbsentHours)
              : formatRate(summary.monthlyAverageRate)
          }
          subtext={
            useHoursFallback
              ? t('dashboard.totalAbsentHoursShort')
              : t('dashboard.requiredHoursShort', { count: summary.totalRequiredHours })
          }
          delta={null}
        />

        <div className="flex flex-col justify-between gap-2 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-neutral-500">
              {t('dashboard.kpiUnjustifiedShare')}
            </span>
            <Clock className="size-4 text-neutral-400" aria-hidden />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-neutral-900">
              {summary.unjustifiedShare !== null ? formatRate(summary.unjustifiedShare) : '—'}
            </span>
            <span className="text-xs tabular-nums text-neutral-500">
              ({summary.totalAbsentHours} {t('dashboard.hoursAbbr')})
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full bg-danger-500 transition-all"
                style={{ width: `${summary.unjustifiedShare ?? 0}%` }}
              />
              <div
                className="h-full bg-secondary-500 transition-all"
                style={{
                  width: `${
                    summary.unjustifiedShare !== null ? Math.max(0, 100 - summary.unjustifiedShare) : 0
                  }%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] tabular-nums text-neutral-500">
              <span className="text-danger-700">
                {t('dashboard.unjustified')}: {summary.totalUnjustifiedHours}
              </span>
              <span className="text-secondary-700">
                {t('dashboard.justified')}: {summary.totalJustifiedHours}
              </span>
            </div>
          </div>
        </div>
      </section>

      {!summary.hasAnyAbsences ? (
        <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">
          <CalendarDays className="size-4 shrink-0 text-primary-600" aria-hidden />
          <span>{t('dashboard.noAbsencesRecordedHint')}</span>
        </div>
      ) : null}

      {/* Weekly & Monthly Recharts */}
      <div className="grid grid-cols-1 gap-5">
        <WeeklyAbsenceChart
          data={summary.weekly}
          averageRate={summary.weeklyAverageRate}
          metricMode={metricMode}
          useHoursFallback={useHoursFallback}
          range={weeksCount}
          onRangeChange={setWeeksCount}
        />

        <MonthlyAbsenceChart
          data={summary.monthly}
          averageRate={summary.monthlyAverageRate}
          metricMode={metricMode}
          useHoursFallback={useHoursFallback}
          range={monthsCount}
          onRangeChange={setMonthsCount}
        />

        {summary.byClass.length > 1 ? (
          <ClassAbsenceComparisonChart
            data={summary.byClass}
            useHoursFallback={useHoursFallback}
          />
        ) : null}
      </div>

      {/* Compact Numeric Breakdown Table */}
      <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-neutral-900">
            {t('dashboard.breakdownTableTitle')}
          </h2>
          <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-50 p-0.5">
            {(['weekly', 'monthly'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setTableTab(tab)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  tableTab === tab
                    ? 'bg-white text-primary-700 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {tab === 'weekly' ? t('dashboard.weeklyTab') : t('dashboard.monthlyTab')}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b border-neutral-200 text-xs text-neutral-500">
              <tr>
                <th className="py-2.5 pe-3 text-start font-semibold">{t('dashboard.colPeriod')}</th>
                <th className="px-2 py-2.5 text-end font-semibold">{t('dashboard.colDays')}</th>
                <th className="px-2 py-2.5 text-end font-semibold">{t('dashboard.colUnjustified')}</th>
                <th className="px-2 py-2.5 text-end font-semibold">{t('dashboard.colJustified')}</th>
                <th className="px-2 py-2.5 text-end font-semibold">{t('dashboard.colTotalHours')}</th>
                {!useHoursFallback ? (
                  <th className="py-2.5 ps-2 text-end font-semibold">{t('dashboard.colRate')}</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {tableTab === 'weekly'
                ? [...summary.weekly].reverse().map((row) => (
                    <tr key={row.key} className="transition hover:bg-neutral-50">
                      <td className="py-2.5 pe-3 text-start font-medium text-neutral-900">
                        <span>
                          {formatShortDate(row.startDate, i18n.language)} –{' '}
                          {formatShortDate(row.endDate, i18n.language)}
                        </span>
                        {row.isCurrent ? (
                          <span className="ms-2 text-xs font-semibold text-primary-700">
                            ({t('dashboard.currentWeekTag')})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums text-neutral-600">
                        {row.schoolDays}
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums text-danger-700">
                        {row.unjustifiedHours}
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums text-secondary-700">
                        {row.justifiedHours}
                      </td>
                      <td className="px-2 py-2.5 text-end font-semibold tabular-nums text-neutral-900">
                        {row.absentHours}
                      </td>
                      {!useHoursFallback ? (
                        <td className="py-2.5 ps-2 text-end font-bold tabular-nums text-neutral-900">
                          {formatRate(row.rate)}
                        </td>
                      ) : null}
                    </tr>
                  ))
                : [...summary.monthly].reverse().map((row) => (
                    <tr key={row.month} className="transition hover:bg-neutral-50">
                      <td className="py-2.5 pe-3 text-start font-medium text-neutral-900">
                        <span>{formatMonthLabel(row.month, i18n.language)}</span>
                        {row.isCurrent ? (
                          <span className="ms-2 text-xs font-semibold text-primary-700">
                            ({t('dashboard.currentMonthTag')})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums text-neutral-600">
                        {row.schoolDays}
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums text-danger-700">
                        {row.unjustifiedHours}
                      </td>
                      <td className="px-2 py-2.5 text-end tabular-nums text-secondary-700">
                        {row.justifiedHours}
                      </td>
                      <td className="px-2 py-2.5 text-end font-semibold tabular-nums text-neutral-900">
                        {row.absentHours}
                      </td>
                      {!useHoursFallback ? (
                        <td className="py-2.5 ps-2 text-end font-bold tabular-nums text-neutral-900">
                          {formatRate(row.rate)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  subtext: string;
  delta: number | null;
  deltaLabel?: string;
}

function KpiCard({ label, value, subtext, delta, deltaLabel }: KpiCardProps) {
  const isUp = delta !== null && delta > 0;
  const isDown = delta !== null && delta < 0;

  return (
    <div className="flex flex-col justify-between gap-2 rounded-2xl border border-neutral-200 bg-white p-4">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-neutral-900">{value}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
        <span className="tabular-nums text-neutral-500">{subtext}</span>
        {delta !== null ? (
          <span
            className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${
              isUp
                ? 'text-danger-700'
                : isDown
                  ? 'text-success-700'
                  : 'text-neutral-500'
            }`}
            title={deltaLabel}
          >
            {isUp ? (
              <TrendingUp className="size-3.5" aria-hidden />
            ) : isDown ? (
              <TrendingDown className="size-3.5" aria-hidden />
            ) : (
              <Minus className="size-3.5" aria-hidden />
            )}
            <span dir="ltr">
              {delta > 0 ? `+${delta.toFixed(delta % 1 === 0 ? 0 : 2)}%` : `${delta.toFixed(delta % 1 === 0 ? 0 : 2)}%`}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
