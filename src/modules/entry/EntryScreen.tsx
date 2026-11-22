import { useCallback, useEffect, useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import {
  getEntryDayClosure,
  listGateEntriesForDate,
  listStudentAbsencesForDate,
  loadEntryWorkspace,
} from '@/db/entries';
import type { EntryDayClosure, GateEntry, StudentAbsence } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';
import { useAsyncData } from '@/utils/useAsyncData';
import { EntryLogTab } from './EntryLogTab';
import { EntryScanTab } from './EntryScanTab';
import { EntryTodayTab } from './EntryTodayTab';

type EntryTabId = 'scan' | 'today' | 'log';

export function EntryScreen() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const today = todayIso();
  const [activeTab, setActiveTab] = useState<EntryTabId>('scan');
  const [selectedDate, setSelectedDate] = useState(today);
  const [entriesToday, setEntriesToday] = useState<GateEntry[]>([]);
  const [entriesForSelected, setEntriesForSelected] = useState<GateEntry[]>([]);
  const [absencesToday, setAbsencesToday] = useState<StudentAbsence[]>([]);
  const [closureToday, setClosureToday] = useState<EntryDayClosure | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const workspaceState = useAsyncData(
    () => loadEntryWorkspace(institution.id, user.id),
    [institution.id, user.id, institution.updatedAt],
  );

  const refreshDayData = useCallback(async () => {
    const [todayRows, selectedRows, absRows, closure] = await Promise.all([
      listGateEntriesForDate(institution.id, today),
      selectedDate === today
        ? Promise.resolve<GateEntry[] | null>(null)
        : listGateEntriesForDate(institution.id, selectedDate),
      listStudentAbsencesForDate(institution.id, today),
      getEntryDayClosure(institution.id, today),
    ]);

    setEntriesToday(todayRows);
    setEntriesForSelected(selectedRows ?? todayRows);
    setAbsencesToday(absRows);
    setClosureToday(closure);
    setDataLoading(false);
  }, [institution.id, today, selectedDate]);

  useEffect(() => {
    let active = true;
    setDataLoading(true);
    refreshDayData().catch(() => {
      if (active) setDataLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refreshDayData]);

  if (workspaceState.loading) return <LoadingState />;
  if (workspaceState.error || !workspaceState.data) {
    return (
      <ErrorState
        message={t(errorKey(workspaceState.error))}
        onRetry={workspaceState.reload}
      />
    );
  }

  const workspace = workspaceState.data;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
              <DoorOpen className="size-6" aria-hidden />
            </span>
            <div className="flex flex-col">
              <h1 className="text-2xl font-extrabold text-neutral-900">{t('entry.title')}</h1>
              <p className="text-sm text-neutral-500">{t('entry.subtitle')}</p>
            </div>
          </div>
          {!workspace.access.canEdit ? (
            <span className="rounded-xl bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600">
              {t('supervisors.access.view')}
            </span>
          ) : null}
        </div>
      </header>

      <SegmentedControl<EntryTabId>
        options={[
          { id: 'scan', label: t('entry.tabs.scan') },
          { id: 'today', label: t('entry.tabs.today') },
          { id: 'log', label: t('entry.tabs.log') },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {dataLoading && entriesToday.length === 0 && entriesForSelected.length === 0 ? (
        <LoadingState />
      ) : activeTab === 'scan' ? (
        <EntryScanTab
          workspace={workspace}
          actorId={user.id}
          today={today}
          entries={entriesToday}
          absencesToday={absencesToday}
          closure={closureToday}
          onRefresh={refreshDayData}
        />
      ) : activeTab === 'today' ? (
        <EntryTodayTab
          workspace={workspace}
          actorId={user.id}
          today={today}
          date={selectedDate}
          onDateChange={setSelectedDate}
          entries={entriesForSelected}
          onRefresh={refreshDayData}
        />
      ) : (
        <EntryLogTab
          workspace={workspace}
          actorId={user.id}
          today={today}
          date={selectedDate}
          onDateChange={setSelectedDate}
          entries={entriesForSelected}
          onRefresh={refreshDayData}
        />
      )}
    </div>
  );
}
