import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  CheckCheck,
  CheckCircle2,
  Download,
  FileArchive,
  GitMerge,
  Layers,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/StatusBlock';
import {
  commitSupervisorBatchMerge,
  exportConsolidatedInstitutionPackage,
  getAvailableRoomsForSlot,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveRoomBookingConflict,
} from '@/db/supervisorBackup';
import type { AppNotification, Room } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { weekdayName } from '@/utils/calendar';
import { downloadBlob } from '@/utils/download';
import { errorKey } from '@/utils/errors';
import {
  parseSupervisorBackupPackage,
  type BatchMergePlan,
  type CategoryMergeCounts,
  type RoomBookingConflict,
  type SupervisorBackupPackage,
} from '@/utils/supervisorMerge';

interface LoadedBackupItem {
  localId: string;
  fileName: string;
  pkg: SupervisorBackupPackage;
  totalRecords: number;
  institutionMismatch: boolean;
}

interface BatchMergeCenterScreenProps {
  onBack: () => void;
}

function countPackageRecords(pkg: SupervisorBackupPackage): number {
  const r = pkg.records;
  return (
    (r.studentAbsences?.length ?? 0) +
    (r.continuousAbsences?.length ?? 0) +
    (r.teacherAbsences?.length ?? 0) +
    (r.timetableSlots?.length ?? 0) +
    (r.rooms?.length ?? 0) +
    (r.notifications?.length ?? 0) +
    (r.entries?.length ?? 0) +
    (r.canteenEntries?.length ?? 0)
  );
}

function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

const CATEGORY_ORDER: (keyof CategoryMergeCounts)[] = [
  'studentAbsences',
  'continuousAbsences',
  'teacherAbsences',
  'timetableSlots',
  'rooms',
  'entries',
  'canteenEntries',
  'notifications',
];

export function BatchMergeCenterScreen({ onBack }: BatchMergeCenterScreenProps) {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();

  const [loadedFiles, setLoadedFiles] = useState<LoadedBackupItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [merging, setMerging] = useState(false);
  const [exportingConsolidated, setExportingConsolidated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<BatchMergePlan | null>(null);
  const [activeConflicts, setActiveConflicts] = useState<RoomBookingConflict[]>([]);
  const [freeRoomsByConflict, setFreeRoomsByConflict] = useState<Record<string, Room[]>>({});
  const [selectedRoomByConflict, setSelectedRoomByConflict] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const loadNotificationsList = useCallback(async () => {
    const rows = await listNotifications(institution.id);
    setNotifications(rows);
  }, [institution.id]);

  useEffect(() => {
    void loadNotificationsList();
  }, [loadNotificationsList]);

  const refreshFreeRoomsForConflicts = useCallback(
    async (conflicts: RoomBookingConflict[]) => {
      if (conflicts.length === 0) {
        setFreeRoomsByConflict({});
        return;
      }
      const entries = await Promise.all(
        conflicts.map(async (c) => {
          const rooms = await getAvailableRoomsForSlot(institution.id, c.day, c.period, c.incomingSlot.id);
          return [c.id, rooms] as const;
        }),
      );
      const nextMap: Record<string, Room[]> = Object.fromEntries(entries);
      setFreeRoomsByConflict(nextMap);
      setSelectedRoomByConflict((prev) => {
        const updated: Record<string, string> = {};
        for (const c of conflicts) {
          const available = nextMap[c.id] ?? [];
          const existingChoice = prev[c.id];
          if (existingChoice && available.some((r) => r.id === existingChoice)) {
            updated[c.id] = existingChoice;
          } else if (available.length > 0) {
            updated[c.id] = available[0].id;
          } else {
            updated[c.id] = '';
          }
        }
        return updated;
      });
    },
    [institution.id],
  );

  const ingestFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setError(null);
    setNotice(null);

    const parsedItems: LoadedBackupItem[] = [];
    const failedNames: string[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const pkg = parseSupervisorBackupPackage(text);
        parsedItems.push({
          localId: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          pkg,
          totalRecords: countPackageRecords(pkg),
          institutionMismatch: pkg.institutionId !== institution.id,
        });
      } catch {
        failedNames.push(file.name);
      }
    }

    if (parsedItems.length > 0) {
      setLoadedFiles((prev) => [...prev, ...parsedItems]);
    }
    if (failedNames.length > 0) {
      setError(`${t('supervisorSync.errors.invalidFormat')} (${failedNames.join(', ')})`);
    }
  };

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      await ingestFiles(event.target.files);
    }
    event.target.value = '';
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) {
      await ingestFiles(event.dataTransfer.files);
    }
  };

  const validFiles = loadedFiles.filter((item) => !item.institutionMismatch);

  const handleRunMerge = async () => {
    if (validFiles.length === 0) {
      setError(t('supervisorSync.errors.noValidFiles'));
      return;
    }
    setMerging(true);
    setError(null);
    setNotice(null);
    try {
      const plan = await commitSupervisorBatchMerge(
        institution.id,
        user.id,
        validFiles.map((item) => item.pkg),
      );
      setLastPlan(plan);
      setActiveConflicts(plan.conflicts);
      await Promise.all([refreshFreeRoomsForConflicts(plan.conflicts), loadNotificationsList()]);
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setMerging(false);
    }
  };

  const handleResolveConflict = async (
    conflict: RoomBookingConflict,
    action: 'assign_room' | 'accept_incoming' | 'keep_existing',
  ) => {
    setResolvingId(conflict.id);
    setError(null);
    setNotice(null);
    try {
      if (action === 'assign_room') {
        const chosenRoomId = selectedRoomByConflict[conflict.id];
        if (!chosenRoomId) {
          setError(t('supervisorSync.noAlternativeRooms'));
          return;
        }
        await resolveRoomBookingConflict(institution.id, user.id, conflict, {
          action: 'assign_room',
          roomId: chosenRoomId,
        });
      } else {
        await resolveRoomBookingConflict(institution.id, user.id, conflict, { action });
      }
      const remaining = activeConflicts.filter((c) => c.id !== conflict.id);
      setActiveConflicts(remaining);
      setNotice(t('supervisorSync.conflictResolvedSuccess'));
      await Promise.all([refreshFreeRoomsForConflicts(remaining), loadNotificationsList()]);
    } catch (err) {
      setError(t(errorKey(err)));
      await refreshFreeRoomsForConflicts(activeConflicts);
    } finally {
      setResolvingId(null);
    }
  };

  const handleExportConsolidated = async () => {
    setExportingConsolidated(true);
    setError(null);
    setNotice(null);
    try {
      const result = await exportConsolidatedInstitutionPackage(institution.id, user.id);
      const json = JSON.stringify(result.pkg, null, 2);
      await downloadBlob(new Blob([json], { type: 'application/json' }), result.filename);
      setNotice(
        t('supervisorSync.consolidatedExportedSuccess', {
          count: result.totalRecords,
          filename: result.filename,
        }),
      );
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setExportingConsolidated(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id, user.id);
    await loadNotificationsList();
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead(institution.id, user.id);
    await loadNotificationsList();
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t('common.back')}
        </button>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">{t('supervisorSync.centerTitle')}</h1>
          <p className="text-sm text-neutral-600 sm:text-base">{t('supervisorSync.centerSubtitle')}</p>
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl bg-success-50 p-4 text-sm text-success-700"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="break-words">{notice}</p>
        </div>
      ) : null}

      <FormError message={error} />

      {/* Multi-file dropzone & selector */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition ${
          dragging
            ? 'border-primary-500 bg-primary-50/70'
            : 'border-neutral-300 bg-white'
        }`}
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
          <Upload className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-neutral-900">{t('supervisorSync.dropTitle')}</h2>
          <p className="max-w-lg text-sm text-neutral-600">{t('supervisorSync.dropHint')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 active:scale-[0.98]">
            <FileArchive className="size-4" aria-hidden />
            {t('supervisorSync.chooseFiles')}
            <input
              type="file"
              multiple
              accept=".edutrack,.json,application/json"
              className="sr-only"
              onChange={handleFileInput}
            />
          </label>
          {loadedFiles.length > 0 ? (
            <Button
              variant="ghost"
              onClick={() => {
                setLoadedFiles([]);
                setError(null);
              }}
            >
              {t('supervisorSync.clearFiles')}
            </Button>
          ) : null}
        </div>
      </section>

      {/* Loaded files list */}
      {loadedFiles.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-neutral-900">
              {t('supervisorSync.loadedFilesTitle', { count: loadedFiles.length })}
            </h2>
          </div>

          <ul className="flex flex-col gap-2.5">
            {loadedFiles.map((item) => (
              <li
                key={item.localId}
                className={`flex flex-col gap-2 rounded-xl p-3.5 ring-1 sm:flex-row sm:items-center sm:justify-between ${
                  item.institutionMismatch
                    ? 'bg-danger-50/60 ring-danger-200'
                    : 'bg-neutral-50 ring-neutral-200'
                }`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-neutral-900">{item.pkg.supervisor.name}</span>
                    <span className="rounded-lg bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {item.pkg.scope.scopeLabel}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {t('supervisorSync.recordsCount', { count: item.totalRecords })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                    <span className="truncate">{item.fileName}</span>
                    <span>
                      {t('supervisorSync.exportedAtLabel')}: {formatDateTime(item.pkg.exportedAt, i18n.language)}
                    </span>
                  </div>
                  {item.institutionMismatch ? (
                    <p className="text-xs font-medium text-danger-700">
                      {t('supervisorSync.institutionMismatchWarning', {
                        name: item.pkg.institutionName || item.pkg.institutionId,
                      })}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setLoadedFiles((prev) => prev.filter((f) => f.localId !== item.localId))}
                  aria-label={t('common.remove')}
                  className="inline-flex size-9 shrink-0 items-center justify-center self-end rounded-lg text-neutral-500 transition hover:bg-neutral-200/70 hover:text-danger-600 sm:self-center"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>

          <div className="pt-1">
            <Button
              fullWidth
              onClick={handleRunMerge}
              disabled={merging || validFiles.length === 0}
              icon={<GitMerge className="size-5" aria-hidden />}
            >
              {merging
                ? t('supervisorSync.merging')
                : t('supervisorSync.runMerge', { count: validFiles.length })}
            </Button>
          </div>
        </section>
      ) : null}

      {/* Merge summary */}
      {lastPlan ? (
        <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
          <div className="flex items-center gap-2">
            <Layers className="size-5 text-primary-600" aria-hidden />
            <h2 className="text-lg font-bold text-neutral-900">{t('supervisorSync.summaryTitle')}</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-success-50 p-3.5 ring-1 ring-success-200">
              <div className="text-xs font-medium text-success-700">{t('supervisorSync.summaryAdded')}</div>
              <div className="mt-1 text-2xl font-bold text-success-800">{lastPlan.totals.added}</div>
            </div>
            <div className="rounded-xl bg-primary-50 p-3.5 ring-1 ring-primary-200">
              <div className="text-xs font-medium text-primary-700">{t('supervisorSync.summaryUpdated')}</div>
              <div className="mt-1 text-2xl font-bold text-primary-800">{lastPlan.totals.updated}</div>
            </div>
            <div className="rounded-xl bg-neutral-100 p-3.5 ring-1 ring-neutral-200">
              <div className="text-xs font-medium text-neutral-600">{t('supervisorSync.summarySkipped')}</div>
              <div className="mt-1 text-2xl font-bold text-neutral-800">{lastPlan.totals.skipped}</div>
            </div>
            <div
              className={`rounded-xl p-3.5 ring-1 ${
                lastPlan.totals.conflicts > 0
                  ? 'bg-danger-50 ring-danger-200'
                  : 'bg-neutral-50 ring-neutral-200'
              }`}
            >
              <div
                className={`text-xs font-medium ${
                  lastPlan.totals.conflicts > 0 ? 'text-danger-700' : 'text-neutral-600'
                }`}
              >
                {t('supervisorSync.summaryConflicts')}
              </div>
              <div
                className={`mt-1 text-2xl font-bold ${
                  lastPlan.totals.conflicts > 0 ? 'text-danger-800' : 'text-neutral-800'
                }`}
              >
                {lastPlan.totals.conflicts}
              </div>
            </div>
          </div>

          {lastPlan.totals.added === 0 &&
          lastPlan.totals.updated === 0 &&
          lastPlan.totals.conflicts === 0 ? (
            <p className="text-sm text-neutral-600">{t('supervisorSync.summaryNoChanges')}</p>
          ) : null}

          <div className="overflow-x-auto rounded-xl ring-1 ring-neutral-200">
            <table className="w-full text-start text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{t('supervisorSync.breakdownTitle')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('supervisorSync.summaryAdded')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('supervisorSync.summaryUpdated')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('supervisorSync.summarySkipped')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('supervisorSync.summaryConflicts')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {CATEGORY_ORDER.map((cat) => {
                  const row = lastPlan.counts[cat];
                  if (row.added + row.updated + row.skipped + row.conflicts === 0) return null;
                  return (
                    <tr key={cat}>
                      <td className="px-3 py-2 font-medium text-neutral-800">
                        {t(`supervisorSync.categories.${cat}`)}
                      </td>
                      <td className="px-3 py-2 text-center text-success-700">{row.added}</td>
                      <td className="px-3 py-2 text-center text-primary-700">{row.updated}</td>
                      <td className="px-3 py-2 text-center text-neutral-600">{row.skipped}</td>
                      <td className="px-3 py-2 text-center font-semibold text-danger-700">
                        {row.conflicts > 0 ? row.conflicts : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Interactive Room Booking Conflict Resolver */}
      {activeConflicts.length > 0 ? (
        <section className="flex flex-col gap-4 rounded-2xl bg-danger-50/40 p-5 ring-1 ring-danger-200">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger-100 text-danger-700">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold text-danger-900">
                {t('supervisorSync.conflictsTitle', { count: activeConflicts.length })}
              </h2>
              <p className="text-sm text-danger-800/90">{t('supervisorSync.conflictsSubtitle')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {activeConflicts.map((conflict) => {
              const freeRooms = freeRoomsByConflict[conflict.id] ?? [];
              const selectedRoomId = selectedRoomByConflict[conflict.id] ?? '';
              const busy = resolvingId === conflict.id;

              return (
                <article
                  key={conflict.id}
                  className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-danger-200"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-bold text-danger-800">
                        {t('supervisorSync.conflictRoomLabel')}: {conflict.roomName}
                      </span>
                      <span className="text-sm font-semibold text-neutral-800">
                        {weekdayName(conflict.day, i18n.language, 'long')} ·{' '}
                        {t('timetable.periodLabel', { number: conflict.period })} ({conflict.timeRange})
                      </span>
                    </div>
                    <span className="text-xs text-neutral-500">
                      {t('supervisorSync.conflictSourceLabel')}: {conflict.sourceSupervisorName}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="rounded-lg bg-neutral-50 p-3 ring-1 ring-neutral-200">
                      <div className="text-xs font-medium text-neutral-500">
                        {t('supervisorSync.conflictExistingLabel')}
                      </div>
                      <div className="mt-1 font-bold text-neutral-900">{conflict.existingClassName}</div>
                      <div className="text-xs text-neutral-600">
                        {conflict.existingSlot.subject}
                        {conflict.existingGroupNumber
                          ? ` (${t('supervisorSync.conflictGroupLabel', { number: conflict.existingGroupNumber })})`
                          : ''}
                      </div>
                    </div>

                    <div className="rounded-lg bg-danger-50/60 p-3 ring-1 ring-danger-200">
                      <div className="text-xs font-medium text-danger-700">
                        {t('supervisorSync.conflictIncomingLabel')}
                      </div>
                      <div className="mt-1 font-bold text-danger-950">{conflict.incomingClassName}</div>
                      <div className="text-xs text-danger-800">
                        {conflict.incomingSlot.subject}
                        {conflict.incomingGroupNumber
                          ? ` (${t('supervisorSync.conflictGroupLabel', { number: conflict.incomingGroupNumber })})`
                          : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5 rounded-xl bg-neutral-50 p-3">
                    <label className="text-xs font-semibold text-neutral-700">
                      {t('supervisorSync.alternativeRoomLabel')}
                    </label>
                    {freeRooms.length > 0 ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          value={selectedRoomId}
                          disabled={busy}
                          onChange={(e) =>
                            setSelectedRoomByConflict((prev) => ({ ...prev, [conflict.id]: e.target.value }))
                          }
                          className="min-h-11 flex-1 rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        >
                          {freeRooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          onClick={() => handleResolveConflict(conflict, 'assign_room')}
                          disabled={busy || !selectedRoomId}
                        >
                          {t('supervisorSync.assignAlternativeAction')}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-neutral-600">{t('supervisorSync.noAlternativeRooms')}</p>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => handleResolveConflict(conflict, 'accept_incoming')}
                      >
                        {t('supervisorSync.acceptIncomingAction')}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => handleResolveConflict(conflict, 'keep_existing')}
                      >
                        {t('supervisorSync.keepExistingAction')}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Consolidated Institution Package Export */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-neutral-900">{t('supervisorSync.consolidatedTitle')}</h2>
          <p className="text-sm text-neutral-600">{t('supervisorSync.consolidatedHint')}</p>
        </div>
        <Button
          variant="secondary"
          fullWidth
          onClick={handleExportConsolidated}
          disabled={exportingConsolidated}
          icon={<Download className="size-5" aria-hidden />}
        >
          {exportingConsolidated
            ? t('supervisorSync.exporting')
            : t('supervisorSync.exportConsolidatedButton')}
        </Button>
      </section>

      {/* Persisted Notifications & Conflict Log */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-primary-600" aria-hidden />
            <h2 className="text-lg font-bold text-neutral-900">
              {t('supervisorSync.notificationsLogTitle')}
            </h2>
            {unreadCount > 0 ? (
              <span className="rounded-lg bg-danger-100 px-2 py-0.5 text-xs font-bold text-danger-700">
                {t('notifications.unreadCount', { count: unreadCount })}
              </span>
            ) : null}
          </div>
          {unreadCount > 0 ? (
            <Button
              variant="ghost"
              onClick={handleMarkAllRead}
              icon={<CheckCheck className="size-4" aria-hidden />}
            >
              {t('notifications.markAllRead')}
            </Button>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('supervisorSync.notificationsLogEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notifications.slice(0, 25).map((notif) => (
              <li
                key={notif.id}
                className={`flex flex-col gap-1.5 rounded-xl p-3.5 ring-1 ${
                  notif.kind === 'room_conflict' && !notif.resolved
                    ? 'bg-danger-50/50 ring-danger-200'
                    : notif.read
                      ? 'bg-neutral-50/60 ring-neutral-200/80'
                      : 'bg-primary-50/40 ring-primary-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                        notif.kind === 'room_conflict'
                          ? 'bg-danger-100 text-danger-800'
                          : 'bg-primary-100 text-primary-800'
                      }`}
                    >
                      {notif.kind === 'room_conflict'
                        ? t('notifications.roomConflictTag')
                        : notif.kind === 'merge_summary'
                          ? t('notifications.mergeSummaryTag')
                          : t('notifications.infoTag')}
                    </span>
                    <span className="font-semibold text-neutral-900">{notif.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {notif.kind === 'room_conflict' ? (
                      <span
                        className={`text-xs font-semibold ${
                          notif.resolved ? 'text-success-700' : 'text-danger-700'
                        }`}
                      >
                        {notif.resolved ? t('notifications.resolved') : t('notifications.unresolved')}
                      </span>
                    ) : null}
                    {!notif.read ? (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(notif.id)}
                        className="text-xs font-medium text-primary-700 underline hover:text-primary-800"
                      >
                        {t('notifications.markRead')}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="text-sm text-neutral-700">{notif.message}</p>
                <span className="text-xs text-neutral-400">
                  {formatDateTime(notif.updatedAt, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
