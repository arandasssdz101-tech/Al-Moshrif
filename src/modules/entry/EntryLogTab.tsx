import { useMemo, useState, type ChangeEvent } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Keyboard,
  Upload,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { EntrySession, GateEntry } from '@/db/types';
import { importGateEntries, listAllGateEntries, type EntryWorkspace } from '@/db/entries';
import { downloadBlob } from '@/utils/download';
import { computeEntryStats, getEntrySettings, resolveEntrySession } from '@/utils/entry';
import { exportEntryLogExcel, exportEntryLogPdf, type EntryLogExportRow } from '@/utils/entryExport';
import { buildEntryExport, parseEntryExport } from '@/utils/entryMerge';
import { studentFullName } from '@/utils/studentQr';

type LogResultFilter = 'all' | 'accepted' | 'late' | 'duplicate' | 'unknown' | 'left' | 'holiday';

interface EntryLogTabProps {
  workspace: EntryWorkspace;
  actorId: string;
  today: string;
  date: string;
  onDateChange: (date: string) => void;
  entries: GateEntry[];
  onRefresh: () => Promise<void>;
}

export function EntryLogTab({
  workspace,
  actorId,
  today,
  date,
  onDateChange,
  entries,
  onRefresh,
}: EntryLogTabProps) {
  const { t, i18n } = useTranslation();
  const { access, institution, classes, students } = workspace;
  const settings = useMemo(() => getEntrySettings(institution), [institution]);
  const [sessionFilter, setSessionFilter] = useState<'all' | EntrySession>('all');
  const [resultFilter, setResultFilter] = useState<LogResultFilter>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | 'json' | null>(null);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const isRtl = i18n.language === 'ar';
  const scopedSession = sessionFilter === 'all' ? undefined : sessionFilter;
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const studentById = useMemo(() => new Map(students.map((item) => [item.id, item])), [students]);
  const stats = useMemo(
    () => computeEntryStats(students, entries, date, scopedSession, settings.eveningStartTime),
    [students, entries, date, scopedSession, settings.eveningStartTime],
  );

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (
        sessionFilter !== 'all' &&
        resolveEntrySession(entry, settings.eveningStartTime) !== sessionFilter
      ) {
        return false;
      }

      if (resultFilter === 'late') {
        if (entry.result !== 'accepted' || !entry.late) return false;
      } else if (resultFilter !== 'all') {
        if (entry.result !== resultFilter) return false;
      }

      if (classFilter !== 'all') {
        const student = entry.studentId ? studentById.get(entry.studentId) : undefined;
        if (!student || student.classId !== classFilter) return false;
      }

      return true;
    });
  }, [entries, sessionFilter, settings.eveningStartTime, resultFilter, classFilter, studentById]);

  const buildExportRows = (): EntryLogExportRow[] =>
    filteredEntries.map((entry) => {
      const student = entry.studentId ? studentById.get(entry.studentId) : undefined;
      const entrySession = resolveEntrySession(entry, settings.eveningStartTime);
      return {
        time: entry.time.slice(0, 8),
        periodLabel: t(`entry.sessions.${entrySession}Short`),
        studentName: student ? studentFullName(student) : t('entry.log.unknownStudent'),
        className: student ? (classById.get(student.classId) ?? '—') : '—',
        boardingLabel: student
          ? student.boardingStatus === 'half-boarder'
            ? t('students.boarding.halfBoarder')
            : t('students.boarding.external')
          : '—',
        resultLabel:
          entry.result === 'accepted' && entry.late
            ? t('entry.results.late')
            : t(`entry.results.${entry.result}`),
        lateLabel: entry.late ? `${entry.minutesLate} ${t('entry.today.minShort')}` : '—',
        sourceLabel: t(`entry.sources.${entry.source}`),
        scannedCode: entry.scannedCode,
        result: entry.result,
        late: entry.late,
      };
    });

  const exportMeta = () => ({
    title: t('entry.log.exportTitle'),
    institutionName: institution.name,
    date,
    isRtl,
    stats,
    labels: {
      date: t('entry.log.colDate'),
      entered: t('entry.stats.entered'),
      notEntered: t('entry.stats.notEntered'),
      late: t('entry.stats.late'),
      duplicates: t('entry.stats.duplicates'),
      unknown: t('entry.stats.unknown'),
      time: t('entry.log.colTime'),
      period: t('entry.log.colPeriod'),
      student: t('entry.log.colStudent'),
      className: t('entry.today.colClass'),
      status: t('entry.log.colStatus'),
      result: t('entry.log.colResult'),
      delay: t('entry.log.colDelay'),
      source: t('entry.log.colSource'),
      code: t('entry.log.colCode'),
    },
  });

  const handleExportExcel = async () => {
    setExporting('excel');
    try {
      await exportEntryLogExcel(buildExportRows(), exportMeta(), `entry-log-${date}.xlsx`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    setExporting('pdf');
    try {
      await exportEntryLogPdf(buildExportRows(), exportMeta(), `entry-log-${date}.pdf`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportJson = async () => {
    setExporting('json');
    try {
      const all = await listAllGateEntries(institution.id, date);
      const json = buildEntryExport(institution.id, all);
      await downloadBlob(new Blob([json], { type: 'application/json' }), `gate-entries-${date}.json`);
    } finally {
      setExporting(null);
    }
  };

  const handleMergeFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMergeMessage(null);
    setMergeError(null);

    try {
      const text = await file.text();
      const parsed = parseEntryExport(text);
      if (!parsed) {
        setMergeError(t('entry.transfer.invalidFile'));
        return;
      }
      const plan = await importGateEntries(institution.id, actorId, parsed);
      setMergeMessage(
        t('entry.transfer.mergedSummary', {
          added: plan.addedCount,
          duplicates: plan.downgradedToDuplicateCount,
          skipped: plan.skippedCount,
        }),
      );
      await onRefresh();
    } catch {
      setMergeError(t('entry.transfer.mergeFailed'));
    }
  };

  const filterChips: { id: LogResultFilter; label: string }[] = [
    { id: 'all', label: t('entry.filters.all') },
    { id: 'accepted', label: t('entry.results.accepted') },
    { id: 'late', label: t('entry.results.late') },
    { id: 'duplicate', label: t('entry.results.duplicate') },
    { id: 'unknown', label: t('entry.results.unknown') },
    { id: 'left', label: t('entry.results.left') },
    { id: 'holiday', label: t('entry.results.holiday') },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Daily summary strip */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              {t('entry.today.selectDate')}
              <input
                type="date"
                value={date}
                max={today}
                onChange={(event) => {
                  if (event.target.value) onDateChange(event.target.value);
                }}
                className="min-h-11 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900"
              />
            </label>
            {date !== today ? (
              <Button type="button" variant="secondary" onClick={() => onDateChange(today)}>
                {t('entry.today.backToToday')}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void handleExportExcel()}
              icon={<FileSpreadsheet className="size-4" aria-hidden />}
            >
              {t('entry.log.exportExcel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={exporting !== null}
              onClick={() => void handleExportPdf()}
              icon={<FileText className="size-4" aria-hidden />}
            >
              {t('entry.log.exportPdf')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-xl bg-emerald-50 p-2.5 text-center">
            <span className="block text-[11px] font-medium text-emerald-800">{t('entry.stats.entered')}</span>
            <span className="text-lg font-extrabold text-emerald-700 tabular-nums">{stats.entered}</span>
          </div>
          <div className="rounded-xl bg-neutral-100 p-2.5 text-center">
            <span className="block text-[11px] font-medium text-neutral-600">{t('entry.stats.notEntered')}</span>
            <span className="text-lg font-extrabold text-neutral-900 tabular-nums">{stats.notEntered}</span>
          </div>
          <div className="rounded-xl bg-amber-50 p-2.5 text-center">
            <span className="block text-[11px] font-medium text-amber-800">{t('entry.stats.late')}</span>
            <span className="text-lg font-extrabold text-amber-700 tabular-nums">{stats.late}</span>
          </div>
          <div className="rounded-xl bg-danger-50 p-2.5 text-center">
            <span className="block text-[11px] font-medium text-danger-700">{t('entry.stats.duplicates')}</span>
            <span className="text-lg font-extrabold text-danger-700 tabular-nums">{stats.duplicates}</span>
          </div>
          <div className="col-span-2 rounded-xl bg-danger-50/70 p-2.5 text-center sm:col-span-1">
            <span className="block text-[11px] font-medium text-danger-700">{t('entry.stats.unknown')}</span>
            <span className="text-lg font-extrabold text-danger-700 tabular-nums">{stats.unknown}</span>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <SegmentedControl<'all' | EntrySession>
          options={[
            { id: 'all', label: t('entry.sessions.all') },
            { id: 'morning', label: t('entry.sessions.morning') },
            { id: 'evening', label: `${t('entry.sessions.evening')} (${settings.eveningStartTime})` },
          ]}
          value={sessionFilter}
          onChange={setSessionFilter}
        />

        <div className="flex flex-wrap gap-1.5">
          {filterChips.map((chip) => {
            const active = resultFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setResultFilter(chip.id)}
                className={`min-h-10 rounded-xl px-3 text-xs font-bold transition ${
                  active
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-neutral-600 sm:max-w-xs">
          {t('entry.filters.byClass')}
          <select
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
            className="min-h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm text-neutral-900"
          >
            <option value="all">{t('entry.filters.allClasses')}</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Scans list */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-neutral-900">{t('entry.log.scansTitle')}</h2>
          <span className="text-xs font-semibold text-neutral-500 tabular-nums">
            {filteredEntries.length}
          </span>
        </div>

        {filteredEntries.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">{t('entry.log.empty')}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {filteredEntries.map((entry) => {
              const student = entry.studentId ? studentById.get(entry.studentId) : undefined;
              const toneClass =
                entry.result === 'accepted' && !entry.late
                  ? 'bg-emerald-50 text-emerald-700'
                  : entry.result === 'accepted' && entry.late
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-danger-50 text-danger-700';

              return (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${toneClass}`}
                    >
                      {entry.result === 'accepted' ? (
                        entry.late ? (
                          <Clock className="size-4" aria-hidden />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden />
                        )
                      ) : (
                        <XCircle className="size-4" aria-hidden />
                      )}
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-bold text-neutral-900">
                        {student ? studentFullName(student) : t('entry.log.unknownStudent')}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
                        {student ? (
                          <span className="font-semibold">{classById.get(student.classId) ?? ''}</span>
                        ) : null}
                        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-700">
                          {t(`entry.sessions.${resolveEntrySession(entry, settings.eveningStartTime)}Short`)}
                        </span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${toneClass}`}>
                          {entry.result === 'accepted' && entry.late
                            ? t('entry.results.lateMinutes', { minutes: entry.minutesLate })
                            : t(`entry.results.${entry.result}`)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-neutral-500">
                          {entry.source === 'camera' ? (
                            <Camera className="size-3" aria-hidden />
                          ) : entry.source === 'usb' ? (
                            <Keyboard className="size-3" aria-hidden />
                          ) : (
                            <UserCheck className="size-3" aria-hidden />
                          )}
                          {t(`entry.sources.${entry.source}`)}
                        </span>
                      </div>
                      <span className="break-all font-mono text-[11px] text-neutral-400" dir="ltr">
                        {entry.scannedCode}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold text-neutral-600 tabular-nums">
                    {entry.time.slice(0, 8)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Multi-device Export & Merge */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold text-neutral-900">{t('entry.transfer.title')}</h2>
          <p className="text-xs text-neutral-500">{t('entry.transfer.hint')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void handleExportJson()}
            icon={<Download className="size-4" aria-hidden />}
          >
            {t('entry.transfer.exportButton')}
          </Button>

          {access.canEdit ? (
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 active:scale-[0.98]">
              <Upload className="size-4" aria-hidden />
              <span>{t('entry.transfer.mergeButton')}</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleMergeFile(event)}
                className="sr-only"
              />
            </label>
          ) : null}
        </div>

        {mergeMessage ? (
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
            {mergeMessage}
          </p>
        ) : null}
        {mergeError ? (
          <p role="alert" className="rounded-xl bg-danger-50 p-3 text-sm font-semibold text-danger-700">
            {mergeError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
