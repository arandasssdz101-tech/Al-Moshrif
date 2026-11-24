import { Fragment, useMemo, useState } from 'react';
import { BarChart2, Clock, UserCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { EntrySession, GateEntry, Student } from '@/db/types';
import {
  ensureGateAutoAbsencesStarted,
  recordGateEntry,
  syncStudentGateAbsenceOnAcceptedScan,
  type EntryWorkspace,
} from '@/db/entries';
import { isEnrolledOn } from '@/utils/absenceReports';
import {
  acceptedEntryByStudent,
  computeClassEntryBreakdown,
  computeLateStatus,
  computeTenMinuteBuckets,
  defaultEntrySession,
  getEntrySettings,
  nowTimeHms,
  resolveExpectedStartTime,
} from '@/utils/entry';
import { studentFullName } from '@/utils/studentQr';

interface EntryTodayTabProps {
  workspace: EntryWorkspace;
  actorId: string;
  today: string;
  date: string;
  onDateChange: (date: string) => void;
  entries: GateEntry[];
  onRefresh: () => Promise<void>;
}

export function EntryTodayTab({
  workspace,
  actorId,
  today,
  date,
  onDateChange,
  entries,
  onRefresh,
}: EntryTodayTabProps) {
  const { t } = useTranslation();
  const { access, institution, classes, students, slots } = workspace;
  const settings = useMemo(() => getEntrySettings(institution), [institution]);
  const [sessionFilter, setSessionFilter] = useState<'all' | EntrySession>('all');
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const isToday = date === today;
  const canMark = access.canEdit && isToday;
  const scopedSession = sessionFilter === 'all' ? undefined : sessionFilter;

  const breakdown = useMemo(
    () =>
      computeClassEntryBreakdown(
        classes,
        students,
        entries,
        date,
        scopedSession,
        settings.eveningStartTime,
      ),
    [classes, students, entries, date, scopedSession, settings.eveningStartTime],
  );

  const acceptedMap = useMemo(
    () => acceptedEntryByStudent(entries, date, scopedSession, settings.eveningStartTime),
    [entries, date, scopedSession, settings.eveningStartTime],
  );
  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item])), [classes]);
  const studentById = useMemo(() => new Map(students.map((item) => [item.id, item])), [students]);

  const notEnteredInClass = useMemo(() => {
    if (!selectedClassId) return [];
    return students
      .filter(
        (student) =>
          student.deletedAt == null &&
          student.classId === selectedClassId &&
          isEnrolledOn(student, date) &&
          !acceptedMap.has(student.id),
      )
      .sort((a, b) => studentFullName(a).localeCompare(studentFullName(b)));
  }, [selectedClassId, students, date, acceptedMap]);

  const lateArrivals = useMemo(() => {
    return Array.from(acceptedMap.values())
      .filter((entry) => entry.late && entry.studentId != null)
      .sort((a, b) => b.minutesLate - a.minutesLate || (b.time ?? '').localeCompare(a.time ?? ''))
      .map((entry) => {
        const student = entry.studentId ? studentById.get(entry.studentId) : undefined;
        return {
          studentId: entry.studentId as string,
          studentName: student ? studentFullName(student) : entry.studentId ?? '',
          className: student ? (classById.get(student.classId)?.name ?? '') : '',
          time: entry.time.slice(0, 5),
          minutesLate: entry.minutesLate,
        };
      });
  }, [acceptedMap, studentById, classById]);

  const buckets = useMemo(
    () => computeTenMinuteBuckets(entries, date, scopedSession, settings.eveningStartTime),
    [entries, date, scopedSession, settings.eveningStartTime],
  );
  const maxBucketCount = useMemo(
    () => Math.max(1, ...buckets.map((item) => item.count)),
    [buckets],
  );

  const handleMarkStudentEntered = async (student: Student) => {
    if (!canMark) return;
    setMarkingId(student.id);
    try {
      const targetSession =
        sessionFilter === 'all'
          ? defaultEntrySession(new Date(), settings.eveningStartTime)
          : sessionFilter;
      const time = nowTimeHms();
      const expectedStart = resolveExpectedStartTime(
        student.classId,
        date,
        slots,
        settings,
        targetSession,
      );
      const { late, minutesLate } = computeLateStatus(time, expectedStart, settings.lateAfterMinutes);
      await recordGateEntry(institution.id, actorId, {
        studentId: student.id,
        scannedCode: student.cardCode?.trim() || student.id,
        date,
        time,
        session: targetSession,
        result: 'accepted',
        late,
        minutesLate,
        source: 'manual',
      });
      await ensureGateAutoAbsencesStarted(institution.id, actorId, date, targetSession);
      await syncStudentGateAbsenceOnAcceptedScan(
        institution.id,
        actorId,
        student,
        date,
        time,
        late,
        targetSession,
      );
      await onRefresh();
    } finally {
      setMarkingId(null);
    }
  };

  const selectedClass = selectedClassId ? classById.get(selectedClassId) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Date & Period picker */}
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-neutral-700">
            {t('entry.today.selectDate')}
            <input
              type="date"
              value={date}
              max={today}
              onChange={(event) => {
                if (event.target.value) onDateChange(event.target.value);
              }}
              className="min-h-11 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </label>

          {!isToday ? (
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
                {t('entry.today.readOnlyPast')}
              </span>
              <Button type="button" variant="secondary" onClick={() => onDateChange(today)}>
                {t('entry.today.backToToday')}
              </Button>
            </div>
          ) : null}
        </div>

        <SegmentedControl<'all' | EntrySession>
          options={[
            { id: 'all', label: t('entry.sessions.all') },
            { id: 'morning', label: t('entry.sessions.morning') },
            { id: 'evening', label: `${t('entry.sessions.evening')} (${settings.eveningStartTime})` },
          ]}
          value={sessionFilter}
          onChange={setSessionFilter}
        />
      </div>

      {/* Per-class breakdown table with level subtotals and total row */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold text-neutral-900">{t('entry.today.byClassTitle')}</h2>
          <p className="text-xs text-neutral-500">{t('entry.today.tapClassHint')}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs font-bold text-neutral-500">
                <th className="py-2.5 text-start">{t('entry.today.colClass')}</th>
                <th className="px-2 py-2.5 text-center">{t('entry.today.colEnrolled')}</th>
                <th className="px-2 py-2.5 text-center">{t('entry.today.colEntered')}</th>
                <th className="px-2 py-2.5 text-center">{t('entry.today.colNotYet')}</th>
                <th className="px-2 py-2.5 text-center">{t('entry.today.colLate')}</th>
                <th className="py-2.5 text-end">{t('entry.today.colPct')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 tabular-nums">
              {breakdown.groups.map((group) => (
                <Fragment key={group.level === null ? 'other' : `lvl-${group.level}`}>
                  {group.rows.map((row) => (
                    <tr
                      key={row.classId}
                      onClick={() => setSelectedClassId(row.classId)}
                      className="cursor-pointer transition hover:bg-primary-50/50"
                    >
                      <td className="py-3 font-bold text-primary-700">{row.className}</td>
                      <td className="px-2 py-3 text-center text-neutral-700">{row.enrolled}</td>
                      <td className="px-2 py-3 text-center font-bold text-emerald-700">{row.entered}</td>
                      <td className="px-2 py-3 text-center font-semibold text-neutral-800">{row.notEntered}</td>
                      <td className="px-2 py-3 text-center font-semibold text-amber-700">{row.late}</td>
                      <td className="py-3 text-end font-bold text-neutral-900">{row.percentage}%</td>
                    </tr>
                  ))}
                  {breakdown.groups.length > 1 ? (
                    <tr className="bg-neutral-50 font-bold text-neutral-800">
                      <td className="py-2.5 text-start">
                        {group.level !== null
                          ? t('entry.today.levelSubtotal', { level: group.level })
                          : t('entry.today.otherSubtotal')}
                      </td>
                      <td className="px-2 py-2.5 text-center">{group.subtotal.enrolled}</td>
                      <td className="px-2 py-2.5 text-center text-emerald-700">{group.subtotal.entered}</td>
                      <td className="px-2 py-2.5 text-center">{group.subtotal.notEntered}</td>
                      <td className="px-2 py-2.5 text-center text-amber-700">{group.subtotal.late}</td>
                      <td className="py-2.5 text-end">{group.subtotal.percentage}%</td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-300 bg-primary-50/60 font-extrabold text-neutral-900 tabular-nums">
                <td className="py-3 text-start">{t('entry.today.totalRow')}</td>
                <td className="px-2 py-3 text-center">{breakdown.total.enrolled}</td>
                <td className="px-2 py-3 text-center text-emerald-700">{breakdown.total.entered}</td>
                <td className="px-2 py-3 text-center">{breakdown.total.notEntered}</td>
                <td className="px-2 py-3 text-center text-amber-700">{breakdown.total.late}</td>
                <td className="py-3 text-end">{breakdown.total.percentage}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Entries per 10 minutes small bar chart */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex items-center gap-2">
          <BarChart2 className="size-4 text-primary-600" aria-hidden />
          <h2 className="text-base font-bold text-neutral-900">{t('entry.today.chartTitle')}</h2>
        </div>

        {buckets.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-500">{t('entry.today.chartEmpty')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {buckets.map((bucket) => {
              const barPct = Math.max(4, Math.round((bucket.count / maxBucketCount) * 100));
              const latePct = bucket.count > 0 ? Math.round((bucket.lateCount / bucket.count) * barPct) : 0;
              return (
                <div key={bucket.label} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-neutral-600 tabular-nums">{bucket.label}</span>
                  <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-4 w-full rounded-full bg-neutral-100">
                    <rect x="0" y="0" width={barPct} height="6" rx="3" className="fill-primary-600" />
                    {latePct > 0 ? (
                      <rect
                        x={Math.max(0, barPct - latePct)}
                        y="0"
                        width={latePct}
                        height="6"
                        rx="3"
                        className="fill-amber-500"
                      />
                    ) : null}
                  </svg>
                  <span className="text-end font-bold text-neutral-800 tabular-nums">{bucket.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Late-arrivals list sorted by minutesLate desc */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-600" aria-hidden />
            <h2 className="text-base font-bold text-neutral-900">{t('entry.today.lateTitle')}</h2>
          </div>
          <span className="rounded-lg bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800 tabular-nums">
            {lateArrivals.length}
          </span>
        </div>

        {lateArrivals.length === 0 ? (
          <p className="py-3 text-center text-sm text-neutral-500">{t('entry.today.noLate')}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {lateArrivals.map((item) => (
              <li key={item.studentId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold text-neutral-900">{item.studentName}</span>
                  <span className="text-xs text-neutral-500">{item.className}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 tabular-nums">
                  <span className="font-mono text-xs text-neutral-500">{item.time}</span>
                  <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                    +{item.minutesLate} {t('entry.today.minShort')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Class modal: students not yet entered */}
      <Modal
        open={selectedClass !== null}
        title={
          selectedClass
            ? t('entry.today.notEnteredModalTitle', { className: selectedClass.name })
            : ''
        }
        description={t('entry.today.notEnteredModalCount', { count: notEnteredInClass.length })}
        onClose={() => setSelectedClassId(null)}
      >
        {notEnteredInClass.length === 0 ? (
          <p className="py-4 text-center text-sm font-semibold text-emerald-700">
            {t('entry.today.allEnteredInClass')}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {notEnteredInClass.map((student) => (
              <li key={student.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold text-neutral-900">
                    {studentFullName(student)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {student.boardingStatus === 'half-boarder'
                      ? t('students.boarding.halfBoarder')
                      : t('students.boarding.external')}
                  </span>
                </div>
                {canMark ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={markingId === student.id}
                    onClick={() => void handleMarkStudentEntered(student)}
                    icon={<UserCheck className="size-4" aria-hidden />}
                  >
                    {t('entry.manual.markEntered')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
