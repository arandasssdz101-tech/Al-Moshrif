import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Keyboard,
  Lock,
  LockOpen,
  RotateCcw,
  Search,
  Undo2,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { EntryDayClosure, EntrySource, GateEntry, Student, StudentAbsence } from '@/db/types';
import type { EntryWorkspace } from '@/db/entries';
import {
  recordGateEntry,
  removeStudentDayAbsences,
  reopenEntryDay,
  softDeleteGateEntry,
  undoCloseEntryDay,
} from '@/db/entries';
import {
  computeEntryStats,
  decideGateScan,
  getEntrySettings,
  isInstitutionHolidayOrClosed,
  nowTimeHms,
} from '@/utils/entry';
import { playEntryFeedback } from '@/utils/entryFeedback';
import { studentFullName } from '@/utils/studentQr';
import { EntryCameraScanner } from './EntryCameraScanner';
import { EntryCloseModal } from './EntryCloseModal';
import { EntryUsbScanner } from './EntryUsbScanner';

interface EntryScanTabProps {
  workspace: EntryWorkspace;
  actorId: string;
  today: string;
  entries: GateEntry[];
  absencesToday: StudentAbsence[];
  closure: EntryDayClosure | null;
  onRefresh: () => Promise<void>;
}

interface ActiveBanner {
  id: number;
  tone: 'green' | 'orange' | 'red';
  headline: string;
  studentId: string | null;
  studentName: string | null;
  className: string | null;
  boardingStatus: Student['boardingStatus'] | null;
  time: string;
  scannedCode?: string;
  hasManualAbsence: boolean;
  absenceRemoved?: boolean;
}

export function EntryScanTab({
  workspace,
  actorId,
  today,
  entries,
  absencesToday,
  closure,
  onRefresh,
}: EntryScanTabProps) {
  const { t } = useTranslation();
  const { access, institution, classes, students, slots } = workspace;
  const settings = useMemo(() => getEntrySettings(institution), [institution]);
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const studentById = useMemo(() => new Map(students.map((item) => [item.id, item])), [students]);

  const [cameraOn, setCameraOn] = useState(false);
  const [usbOn, setUsbOn] = useState(true);
  const [azertyFix, setAzertyFix] = useState(true);
  const [banner, setBanner] = useState<ActiveBanner | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [undoTarget, setUndoTarget] = useState<GateEntry | null>(null);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bannerTimerRef = useRef<number | null>(null);
  const bannerSeqRef = useRef(0);
  const entriesRef = useRef(entries);
  const absencesRef = useRef(absencesToday);
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    absencesRef.current = absencesToday;
  }, [absencesToday]);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current !== null) {
        window.clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  const holidayInfo = useMemo(() => isInstitutionHolidayOrClosed(today, institution), [today, institution]);
  const stats = useMemo(() => computeEntryStats(students, entries, today), [students, entries, today]);

  const absentStudentIdsToday = useMemo(
    () => new Set(absencesToday.filter((item) => item.deletedAt === null).map((item) => item.studentId)),
    [absencesToday],
  );

  const enteredStudentIdsToday = useMemo(
    () =>
      new Set(
        entries
          .filter((item) => item.deletedAt === null && item.date === today && item.result === 'accepted' && item.studentId)
          .map((item) => item.studentId as string),
      ),
    [entries, today],
  );

  const latestScans = useMemo(() => entries.slice(0, 10), [entries]);
  const lastAcceptedEntry = useMemo(
    () => entries.find((item) => item.deletedAt === null && item.result === 'accepted') ?? null,
    [entries],
  );

  const showBanner = useCallback((next: Omit<ActiveBanner, 'id'>, durationMs: number) => {
    if (bannerTimerRef.current !== null) {
      window.clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
    bannerSeqRef.current += 1;
    const id = bannerSeqRef.current;
    setBanner({ ...next, id });
    bannerTimerRef.current = window.setTimeout(() => {
      setBanner((prev) => (prev && prev.id === id ? null : prev));
    }, durationMs);
  }, []);

  const processCode = useCallback(
    (rawCode: string, source: EntrySource) => {
      if (!access.canEdit) return;
      scanQueueRef.current = scanQueueRef.current.then(async () => {
        const time = nowTimeHms();
        const decision = decideGateScan({
          rawCode,
          date: today,
          time,
          students,
          entriesForDate: entriesRef.current,
          slots,
          settings,
          preferredField: institution.canteenMatchField ?? 'cardCode',
          convertAzertyDigits: source === 'usb' ? azertyFix : false,
        });

        if (!decision.scannedCode) return;

        const saved = await recordGateEntry(institution.id, actorId, {
          studentId: decision.student?.id ?? null,
          scannedCode: decision.scannedCode,
          date: today,
          time,
          result: decision.result,
          late: decision.late,
          minutesLate: decision.minutesLate,
          source,
        });

        entriesRef.current = [saved, ...entriesRef.current];

        const student = decision.student;
        const studentName = student ? studentFullName(student) : null;
        const className = student ? (classById.get(student.classId) ?? '') : null;
        const hasManualAbsence = Boolean(
          student &&
            decision.result === 'accepted' &&
            absencesRef.current.some((item) => item.deletedAt === null && item.studentId === student.id),
        );

        if (decision.result === 'accepted' && !decision.late) {
          playEntryFeedback('accepted', {
            soundEnabled: settings.soundEnabled,
            vibrationEnabled: settings.vibrationEnabled,
          });
          showBanner(
            {
              tone: 'green',
              headline: t('entry.banner.accepted'),
              studentId: student?.id ?? null,
              studentName,
              className,
              boardingStatus: student?.boardingStatus ?? null,
              time: time.slice(0, 5),
              hasManualAbsence,
            },
            hasManualAbsence ? 7000 : 1400,
          );
        } else if (decision.result === 'accepted' && decision.late) {
          playEntryFeedback('late', {
            soundEnabled: settings.soundEnabled,
            vibrationEnabled: settings.vibrationEnabled,
          });
          showBanner(
            {
              tone: 'orange',
              headline: t('entry.banner.late', { minutes: decision.minutesLate }),
              studentId: student?.id ?? null,
              studentName,
              className,
              boardingStatus: student?.boardingStatus ?? null,
              time: time.slice(0, 5),
              hasManualAbsence,
            },
            hasManualAbsence ? 7000 : 1600,
          );
        } else if (decision.result === 'duplicate') {
          playEntryFeedback('duplicate', {
            soundEnabled: settings.soundEnabled,
            vibrationEnabled: settings.vibrationEnabled,
          });
          showBanner(
            {
              tone: 'red',
              headline: t('entry.banner.duplicate', { time: decision.existingTime ?? '' }),
              studentId: student?.id ?? null,
              studentName,
              className,
              boardingStatus: student?.boardingStatus ?? null,
              time: time.slice(0, 5),
              hasManualAbsence: false,
            },
            1500,
          );
        } else if (decision.result === 'left') {
          playEntryFeedback('error', {
            soundEnabled: settings.soundEnabled,
            vibrationEnabled: settings.vibrationEnabled,
          });
          showBanner(
            {
              tone: 'red',
              headline: t('entry.banner.left'),
              studentId: student?.id ?? null,
              studentName,
              className,
              boardingStatus: student?.boardingStatus ?? null,
              time: time.slice(0, 5),
              hasManualAbsence: false,
            },
            1600,
          );
        } else {
          playEntryFeedback('error', {
            soundEnabled: settings.soundEnabled,
            vibrationEnabled: settings.vibrationEnabled,
          });
          showBanner(
            {
              tone: 'red',
              headline: t('entry.banner.unknown'),
              studentId: null,
              studentName: null,
              className: null,
              boardingStatus: null,
              time: time.slice(0, 5),
              scannedCode: decision.scannedCode,
              hasManualAbsence: false,
            },
            1800,
          );
        }

        await onRefresh();
      });
    },
    [access.canEdit, today, students, slots, settings, institution.canteenMatchField, institution.id, actorId, azertyFix, classById, t, showBanner, onRefresh],
  );

  const handleCameraDetect = useCallback(
    (rawCode: string) => {
      processCode(rawCode, 'camera');
    },
    [processCode],
  );

  const handleUsbDetect = useCallback(
    (code: string) => {
      processCode(code, 'usb');
    },
    [processCode],
  );

  const handleManualMark = (student: Student) => {
    const code = student.cardCode?.trim() || student.id;
    processCode(code, 'manual');
    setManualQuery('');
  };

  const handleRemoveAbsenceFromBanner = async (studentId: string) => {
    setBusy(true);
    try {
      await removeStudentDayAbsences(institution.id, actorId, studentId, today);
      setBanner((prev) => (prev && prev.studentId === studentId ? { ...prev, absenceRemoved: true } : prev));
      setStatusNotice(t('entry.notices.absenceRemoved'));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmUndo = async () => {
    if (!undoTarget) return;
    setBusy(true);
    try {
      await softDeleteGateEntry(undoTarget.id, actorId);
      setUndoTarget(null);
      setStatusNotice(t('entry.notices.scanUndone'));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    setBusy(true);
    try {
      await reopenEntryDay(institution.id, actorId, today);
      setStatusNotice(t('entry.notices.dayReopened'));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleUndoClose = async () => {
    setBusy(true);
    try {
      const removed = await undoCloseEntryDay(institution.id, actorId, today);
      setStatusNotice(t('entry.notices.closeUndone', { count: removed }));
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const manualMatches = useMemo(() => {
    const query = manualQuery.trim().toLowerCase();
    if (query.length < 1) return [];
    return students
      .filter((student) => {
        if (student.leaveDate !== null && student.leaveDate <= today) return false;
        const name = studentFullName(student).toLowerCase();
        const code = (student.cardCode ?? '').toLowerCase();
        const cls = (classById.get(student.classId) ?? '').toLowerCase();
        return name.includes(query) || code.includes(query) || cls.includes(query);
      })
      .slice(0, 8);
  }, [manualQuery, students, today, classById]);

  const progressWidth = Math.max(0, Math.min(100, stats.percentage));

  return (
    <div className="flex flex-col gap-5">
      {/* Huge live counter + progress bar + mini counters */}
      <section className="flex flex-col gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-neutral-500">{t('entry.scan.counterLabel')}</span>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-4xl font-extrabold tracking-tight text-primary-700 sm:text-5xl">
                {stats.entered}
              </span>
              <span className="text-xl font-bold text-neutral-500 sm:text-2xl">
                {t('entry.scan.ofTotal', { total: stats.enrolled })}
              </span>
            </div>
          </div>
          <span className="rounded-2xl bg-primary-50 px-3.5 py-1.5 text-lg font-extrabold text-primary-700 tabular-nums">
            {stats.percentage}%
          </span>
        </div>

        <svg
          viewBox="0 0 100 3"
          preserveAspectRatio="none"
          role="progressbar"
          aria-valuenow={stats.entered}
          aria-valuemin={0}
          aria-valuemax={stats.enrolled}
          aria-label={t('entry.scan.counterLabel')}
          className="h-3.5 w-full overflow-hidden rounded-full bg-neutral-100"
        >
          <rect
            x="0"
            y="0"
            width={progressWidth}
            height="3"
            rx="1.5"
            className="fill-primary-600 transition-all duration-300"
          />
        </svg>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="flex flex-col rounded-2xl bg-neutral-50 p-3 text-center ring-1 ring-neutral-200/70">
            <span className="text-xs font-medium text-neutral-500">{t('entry.stats.notEntered')}</span>
            <span className="mt-0.5 text-2xl font-extrabold text-neutral-900 tabular-nums">{stats.notEntered}</span>
          </div>
          <div className="flex flex-col rounded-2xl bg-amber-50 p-3 text-center ring-1 ring-amber-200/70">
            <span className="text-xs font-medium text-amber-800">{t('entry.stats.late')}</span>
            <span className="mt-0.5 text-2xl font-extrabold text-amber-700 tabular-nums">{stats.late}</span>
          </div>
          <div className="flex flex-col rounded-2xl bg-danger-50 p-3 text-center ring-1 ring-danger-200/70">
            <span className="text-xs font-medium text-danger-700">{t('entry.stats.rejected')}</span>
            <span className="mt-0.5 text-2xl font-extrabold text-danger-700 tabular-nums">{stats.rejected}</span>
          </div>
        </div>
      </section>

      {/* Holiday / non-working day warning */}
      {holidayInfo.closed ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold">
              {holidayInfo.holidayName
                ? t('entry.holidayWarningNamed', { name: holidayInfo.holidayName })
                : t('entry.holidayWarningClosed')}
            </span>
            <span className="text-xs text-amber-800">{t('entry.holidayStillAllowed')}</span>
          </div>
        </div>
      ) : null}

      {/* Closed day banner */}
      {closure?.closed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4">
          <div className="flex items-center gap-2.5 text-sm font-bold text-primary-900">
            <Lock className="size-5 shrink-0 text-primary-700" aria-hidden />
            <span>{t('entry.closeDay.dayClosedBanner')}</span>
          </div>
          {access.canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              {closure.createdAbsenceIds.length > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void handleUndoClose()}
                  icon={<Undo2 className="size-4" aria-hidden />}
                >
                  {t('entry.closeDay.undoAbsences')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleReopen()}
                icon={<LockOpen className="size-4" aria-hidden />}
              >
                {t('entry.closeDay.reopen')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {statusNotice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200"
        >
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-xs font-bold underline"
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {/* Large colored Result Banner */}
      {banner ? (
        <div
          role="status"
          aria-live="assertive"
          className={`flex flex-col gap-3 rounded-3xl p-5 text-white shadow-lg animate-fade-in ${
            banner.tone === 'green'
              ? 'bg-emerald-600'
              : banner.tone === 'orange'
                ? 'bg-amber-600'
                : 'bg-danger-600'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {banner.tone === 'green' ? (
                <CheckCircle2 className="size-9 shrink-0" aria-hidden />
              ) : banner.tone === 'orange' ? (
                <Clock className="size-9 shrink-0" aria-hidden />
              ) : (
                <XCircle className="size-9 shrink-0" aria-hidden />
              )}
              <div className="flex flex-col">
                <span className="text-xl font-extrabold sm:text-2xl">{banner.headline}</span>
                {banner.studentName ? (
                  <span className="text-lg font-bold text-white/95">{banner.studentName}</span>
                ) : null}
              </div>
            </div>
            <span className="rounded-xl bg-black/20 px-3 py-1 font-mono text-base font-bold tabular-nums">
              {banner.time}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {banner.className ? (
              <span className="rounded-lg bg-white/20 px-2.5 py-1">{banner.className}</span>
            ) : null}
            {banner.boardingStatus ? (
              <span className="rounded-lg bg-white/20 px-2.5 py-1">
                {banner.boardingStatus === 'half-boarder'
                  ? t('students.boarding.halfBoarder')
                  : t('students.boarding.external')}
              </span>
            ) : null}
            {banner.scannedCode ? (
              <span className="break-all rounded-lg bg-black/25 px-2.5 py-1 font-mono text-xs" dir="ltr">
                {banner.scannedCode}
              </span>
            ) : null}
          </div>

          {banner.hasManualAbsence && banner.studentId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-black/20 p-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                <span>
                  {banner.absenceRemoved
                    ? t('entry.banner.absenceRemovedInline')
                    : t('entry.banner.hasAbsenceWarning')}
                </span>
              </div>
              {!banner.absenceRemoved ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemoveAbsenceFromBanner(banner.studentId!)}
                  className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-neutral-900 shadow-sm transition active:scale-95"
                >
                  {t('entry.banner.removeAbsence')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Camera & USB Scanners (both can be ON simultaneously) */}
      {access.canEdit ? (
        <div className="flex flex-col gap-3">
          <EntryCameraScanner
            active={cameraOn}
            cooldownSeconds={settings.cooldownSeconds}
            disabled={!access.canEdit}
            onDetect={handleCameraDetect}
            onToggleActive={() => setCameraOn((prev) => !prev)}
          />
          <EntryUsbScanner
            enabled={usbOn}
            azertyFix={azertyFix}
            cooldownSeconds={settings.cooldownSeconds}
            disabled={!access.canEdit}
            onToggleEnabled={() => setUsbOn((prev) => !prev)}
            onToggleAzertyFix={() => setAzertyFix((prev) => !prev)}
            onDetect={handleUsbDetect}
          />
        </div>
      ) : null}

      {/* Manual entry search box */}
      {access.canEdit ? (
        <section
          data-entry-keep-focus="true"
          className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-800">
            <UserCheck className="size-4 text-primary-600" aria-hidden />
            <span>{t('entry.manual.title')}</span>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
              aria-hidden
            />
            <input
              type="search"
              value={manualQuery}
              onChange={(event) => setManualQuery(event.target.value)}
              placeholder={t('entry.manual.placeholder')}
              className="min-h-12 w-full rounded-xl border border-neutral-300 bg-neutral-50 pe-4 ps-10 text-base text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>

          {manualMatches.length > 0 ? (
            <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-neutral-50">
              {manualMatches.map((student) => {
                const alreadyIn = enteredStudentIdsToday.has(student.id);
                const hasAbs = absentStudentIdsToday.has(student.id);
                return (
                  <li
                    key={student.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-bold text-neutral-900">
                        {studentFullName(student)}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {classById.get(student.classId) ?? ''} ·{' '}
                        {student.boardingStatus === 'half-boarder'
                          ? t('students.boarding.halfBoarder')
                          : t('students.boarding.external')}
                        {hasAbs ? ` · ${t('entry.manual.markedAbsentTag')}` : ''}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant={alreadyIn ? 'secondary' : 'primary'}
                      onClick={() => handleManualMark(student)}
                    >
                      {alreadyIn ? t('entry.manual.alreadyIn') : t('entry.manual.markEntered')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : manualQuery.trim().length > 0 ? (
            <p className="text-sm text-neutral-500">{t('entry.manual.noMatch')}</p>
          ) : null}
        </section>
      ) : null}

      {/* Latest 10 scans + Undo on last accepted */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-neutral-900">{t('entry.recent.title')}</h2>
          {access.canEdit && lastAcceptedEntry ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setUndoTarget(lastAcceptedEntry)}
              icon={<RotateCcw className="size-4" aria-hidden />}
            >
              {t('entry.recent.undoLast')}
            </Button>
          ) : null}
        </div>

        {latestScans.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-500">{t('entry.recent.empty')}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {latestScans.map((entry) => {
              const student = entry.studentId ? studentById.get(entry.studentId) : undefined;
              const isLastAccepted = lastAcceptedEntry?.id === entry.id;
              const badgeClass =
                entry.result === 'accepted' && !entry.late
                  ? 'bg-emerald-50 text-emerald-700'
                  : entry.result === 'accepted' && entry.late
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-danger-50 text-danger-700';

              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${badgeClass}`}
                    >
                      {entry.result === 'accepted' ? (
                        entry.late ? (
                          <Clock className="size-4" aria-hidden />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden />
                        )
                      ) : (
                        <UserX className="size-4" aria-hidden />
                      )}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-bold text-neutral-900">
                        {student ? studentFullName(student) : entry.scannedCode}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                        {student ? <span>{classById.get(student.classId) ?? ''}</span> : null}
                        <span>
                          {entry.result === 'accepted' && entry.late
                            ? t('entry.results.lateMinutes', { minutes: entry.minutesLate })
                            : t(`entry.results.${entry.result}`)}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-neutral-400">
                          {entry.source === 'camera' ? (
                            <Camera className="size-3" aria-hidden />
                          ) : entry.source === 'usb' ? (
                            <Keyboard className="size-3" aria-hidden />
                          ) : (
                            <UserCheck className="size-3" aria-hidden />
                          )}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-neutral-600 tabular-nums">
                      {entry.time.slice(0, 5)}
                    </span>
                    {access.canEdit && isLastAccepted ? (
                      <button
                        type="button"
                        onClick={() => setUndoTarget(entry)}
                        aria-label={t('entry.recent.undoLast')}
                        className="flex min-h-9 items-center gap-1 rounded-lg bg-neutral-100 px-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-200"
                      >
                        <Undo2 className="size-3.5" aria-hidden />
                        <span>{t('common.undo')}</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Close Today's Entry button */}
      {access.canEdit && !closure?.closed ? (
        <Button
          type="button"
          variant="secondary"
          fullWidth
          onClick={() => setCloseModalOpen(true)}
          icon={<Lock className="size-4" aria-hidden />}
        >
          {t('entry.closeDay.button')}
        </Button>
      ) : null}

      {/* Undo confirmation modal */}
      <Modal
        open={undoTarget !== null}
        title={t('entry.recent.undoConfirmTitle')}
        description={
          undoTarget
            ? t('entry.recent.undoConfirmBody', {
                name:
                  (undoTarget.studentId && studentById.get(undoTarget.studentId)
                    ? studentFullName(studentById.get(undoTarget.studentId)!)
                    : undoTarget.scannedCode),
                time: undoTarget.time.slice(0, 5),
              })
            : undefined
        }
        onClose={() => setUndoTarget(null)}
      >
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" fullWidth onClick={() => setUndoTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            fullWidth
            disabled={busy}
            onClick={() => void handleConfirmUndo()}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Modal>

      {/* Close Day confirmation modal */}
      <EntryCloseModal
        open={closeModalOpen}
        institutionId={institution.id}
        actorId={actorId}
        date={today}
        onClose={() => setCloseModalOpen(false)}
        onClosed={(createdAbsencesCount) => {
          setStatusNotice(t('entry.notices.dayClosed', { count: createdAbsencesCount }));
          void onRefresh();
        }}
      />
    </div>
  );
}
