import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Utensils, Users, ClipboardList, Save, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/StatusBlock';
import { getModuleAccess } from '@/db/access';
import { listCanteenEntries, listCanteenStudents } from '@/db/canteen';
import { loadDailyReport, saveCanteenDailyInfo } from '@/db/dailyReports';
import { listSupervisors } from '@/db/users';
import { useSession } from '@/modules/auth/AuthContext';
import { isEnrolledOn } from '@/utils/absenceReports';
import { subscribeAppDataChanged } from '@/utils/dataEvents';
import { errorKey } from '@/utils/errors';
import { todayIso } from '@/utils/dates';
import { SUPERVISOR_ATTENDANCE, type SupervisorAbsenceRow, type SupervisorAttendance, type User } from '@/db/types';

const INPUT_CLASS =
  'min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

function emptySupervisorRow(): SupervisorAbsenceRow {
  return { supervisorId: null, name: '', morning: 'none', evening: 'none', notes: '' };
}

function parseEnteredCount(raw: string): { valid: boolean; value: number | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { valid: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { valid: false, value: null };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return { valid: false, value: null };
  return { valid: true, value: parsed };
}

export function CanteenDailyInfo() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [plannedMeal, setPlannedMeal] = useState('');
  const [mealServed, setMealServed] = useState('');
  const [canteenNote, setCanteenNote] = useState('');
  const [enteredCountText, setEnteredCountText] = useState('');
  const [supervisorRows, setSupervisorRows] = useState<SupervisorAbsenceRow[]>([]);
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [halfBoardersCount, setHalfBoardersCount] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [hasAnyScans, setHasAnyScans] = useState(false);
  const [canEdit, setCanEdit] = useState(() => user.role === 'head');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const savingLocalRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const load = useCallback(async () => {
    setLoaded(false);
    setError(null);
    try {
      const [access, report, supervisorList, studentRows, entryRows] = await Promise.all([
        getModuleAccess(user.id, 'canteen'),
        loadDailyReport(institution.id, date),
        listSupervisors(institution.id),
        listCanteenStudents(institution.id),
        listCanteenEntries(institution.id, date),
      ]);
      const enrolledHalfBoarders = studentRows.filter(
        (student) => student.deletedAt == null && student.boardingStatus === 'half-boarder' && isEnrolledOn(student, date),
      );
      const halfBoarderIds = new Set(enrolledHalfBoarders.map((student) => student.id));
      const acceptedIds = new Set(
        entryRows
          .filter((entry) => entry.deletedAt == null && entry.result === 'accepted' && entry.studentId != null && halfBoarderIds.has(entry.studentId))
          .map((entry) => entry.studentId as string),
      );
      setCanEdit(access.isHead || access.canEdit);
      setHalfBoardersCount(enrolledHalfBoarders.length);
      setScannedCount(acceptedIds.size);
      setHasAnyScans(entryRows.some((entry) => entry.deletedAt == null));
      setPlannedMeal(report?.plannedMeal ?? '');
      setMealServed(report?.mealServed ?? '');
      setCanteenNote(report?.canteenNote ?? '');
      setEnteredCountText(
        report?.canteenEnteredCount !== null && report?.canteenEnteredCount !== undefined
          ? String(report.canteenEnteredCount)
          : '',
      );
      setSupervisorRows(report?.supervisorRows ?? []);
      setSupervisors(supervisorList);
      setDirty(false);
      setSaveState('idle');
    } catch (loadError) {
      setError(t(errorKey(loadError)));
    } finally {
      setLoaded(true);
    }
  }, [institution.id, date, t, user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeAppDataChanged(['dailyReports', 'canteen', 'students', 'sync'], () => {
      if (!dirtyRef.current && !savingLocalRef.current) void load();
    });
  }, [load]);

  const parsedEntered = useMemo(() => parseEnteredCount(enteredCountText), [enteredCountText]);
  const effectiveEntered = parsedEntered.valid && parsedEntered.value !== null
    ? parsedEntered.value
    : hasAnyScans
      ? scannedCount
      : 0;
  const effectiveAbsent = Math.max(0, halfBoardersCount - effectiveEntered);
  const modeLabel = parsedEntered.valid && parsedEntered.value !== null
    ? t('canteenDailyInfo.modeManual')
    : hasAnyScans
      ? t('canteenDailyInfo.modeScans')
      : t('canteenDailyInfo.modeAuto');

  const updateRow = (index: number, patch: Partial<SupervisorAbsenceRow>) => {
    setSupervisorRows((previous) => previous.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
    setSaveState('idle');
  };

  const pickSupervisor = (index: number, supervisorId: string) => {
    const supervisor = supervisors.find((item) => item.id === supervisorId);
    updateRow(index, supervisor ? { supervisorId: supervisor.id, name: supervisor.name } : { supervisorId: null, name: '' });
  };

  const handleSave = async () => {
    if (!parsedEntered.valid) {
      setSaveState('failed');
      setError(t('canteenDailyInfo.invalidEnteredCount'));
      return;
    }
    setSaveState('saving');
    setError(null);
    savingLocalRef.current = true;
    try {
      await saveCanteenDailyInfo(
        institution.id,
        date,
        {
          plannedMeal,
          mealServed,
          canteenNote,
          canteenEnteredCount: parsedEntered.value,
          supervisorRows,
        },
        user.id,
      );
      dirtyRef.current = false;
      setDirty(false);
      setSaveState('saved');
    } catch (saveError) {
      setSaveState('failed');
      setError(t(errorKey(saveError)));
    } finally {
      savingLocalRef.current = false;
    }
  };

  if (loaded && !canEdit) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-neutral-200">
        <p className="text-sm text-neutral-500">{t('canteenDailyInfo.readOnly')}</p>
      </div>
    );
  }

  const saveBar = loaded ? (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={handleSave} disabled={!dirty || saveState === 'saving'}>
        <span className="flex items-center gap-2">
          <Save className="size-4" aria-hidden />
          {saveState === 'saving' ? t('canteenDailyInfo.saving') : t('canteenDailyInfo.save')}
        </span>
      </Button>
      {saveState === 'saved' ? <span className="text-sm font-medium text-success-700">{t('dailyReport.saved')}</span> : null}
      {saveState === 'failed' ? <span className="text-sm font-medium text-danger-700">{t('dailyReport.saveFailed')}</span> : null}
      {dirty ? <span className="text-sm font-medium text-warning-700">{t('dailyReport.unsaved')}</span> : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
        <div className="mb-4 flex items-center gap-2">
          <Utensils className="size-5 text-primary-600" aria-hidden />
          <h2 className="text-lg font-bold text-neutral-900">{t('canteenDailyInfo.title')}</h2>
        </div>

        <label className="mb-4 flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('canteenDailyInfo.date')}
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
            className={INPUT_CLASS}
          />
        </label>

        {loaded ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white p-2.5 ring-1 ring-neutral-200">
                  <div className="text-xs text-neutral-500">{t('canteenDailyInfo.summaryHalfBoarders')}</div>
                  <div className="mt-0.5 text-xl font-bold text-neutral-900 tabular-nums">{halfBoardersCount}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 ring-1 ring-neutral-200">
                  <div className="text-xs text-neutral-500">{t('canteenDailyInfo.summaryEntered')}</div>
                  <div className="mt-0.5 text-xl font-bold text-primary-700 tabular-nums">{effectiveEntered}</div>
                  <div className="text-[11px] text-neutral-500">{modeLabel}</div>
                </div>
                <div className="rounded-lg bg-white p-2.5 ring-1 ring-neutral-200">
                  <div className="text-xs text-neutral-500">{t('canteenDailyInfo.summaryAbsent')}</div>
                  <div className="mt-0.5 text-xl font-bold text-danger-700 tabular-nums">{effectiveAbsent}</div>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="size-4 text-primary-600" aria-hidden />
                  {t('canteenDailyInfo.enteredCount')}
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={enteredCountText}
                  placeholder={t('canteenDailyInfo.enteredCountPlaceholder')}
                  onChange={(event) => {
                    setEnteredCountText(event.target.value);
                    setDirty(true);
                    setSaveState('idle');
                    setError(null);
                  }}
                  className={`${INPUT_CLASS} tabular-nums`}
                />
                <span className="text-xs font-normal text-neutral-500">{t('canteenDailyInfo.enteredCountHint')}</span>
              </label>

              {(!parsedEntered.valid || enteredCountText.trim() !== '' || scannedCount > 0) ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!parsedEntered.valid ? (
                    <span className="text-xs font-medium text-danger-700">{t('canteenDailyInfo.invalidEnteredCount')}</span>
                  ) : null}
                  {enteredCountText.trim() !== '' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEnteredCountText('');
                        setDirty(true);
                        setSaveState('idle');
                        setError(null);
                      }}
                      className="text-xs font-semibold text-primary-700 underline hover:text-primary-800"
                    >
                      {t('canteenDailyInfo.clearManualCount')}
                    </button>
                  ) : null}
                  {scannedCount > 0 && enteredCountText.trim() === '' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEnteredCountText(String(scannedCount));
                        setDirty(true);
                        setSaveState('idle');
                        setError(null);
                      }}
                      className="text-xs font-semibold text-primary-700 underline hover:text-primary-800"
                    >
                      {t('canteenDailyInfo.useScannedCount', { count: scannedCount })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              {t('canteenDailyInfo.plannedMeal')}
              <textarea
                value={plannedMeal}
                rows={2}
                placeholder={t('canteenDailyInfo.plannedMealPlaceholder')}
                onChange={(event) => {
                  setPlannedMeal(event.target.value);
                  setDirty(true);
                  setSaveState('idle');
                }}
                className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              {t('canteenDailyInfo.mealServed')}
              <textarea
                value={mealServed}
                rows={2}
                placeholder={t('canteenDailyInfo.mealPlaceholder')}
                onChange={(event) => {
                  setMealServed(event.target.value);
                  setDirty(true);
                  setSaveState('idle');
                }}
                className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              <span className="flex items-center gap-1.5">
                <ClipboardList className="size-4 text-neutral-500" aria-hidden />
                {t('canteenDailyInfo.notes')}
              </span>
              <textarea
                value={canteenNote}
                rows={3}
                placeholder={t('canteenDailyInfo.notesPlaceholder')}
                onChange={(event) => {
                  setCanteenNote(event.target.value);
                  setDirty(true);
                  setSaveState('idle');
                }}
                className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            {saveBar}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('common.loading')}</p>
        )}
      </div>

      {loaded ? (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
          <div className="mb-4 flex items-center gap-2">
            <Users className="size-5 text-primary-600" aria-hidden />
            <h2 className="text-lg font-bold text-neutral-900">{t('canteenDailyInfo.supervisors')}</h2>
          </div>

          <div className="flex flex-col gap-3">
            {supervisorRows.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('canteenDailyInfo.noSupervisors')}</p>
            ) : null}
            {supervisorRows.map((row, index) => (
              <div key={index} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-700">{t('dailyReport.rowNumber', { n: index + 1 })}</span>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSupervisorRows((prev) => prev.filter((_, i) => i !== index));
                      setDirty(true);
                      setSaveState('idle');
                    }}
                  >
                    {t('dailyReport.removeRow')}
                  </Button>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                  {t('dailyReport.chooseSupervisor')}
                  <select
                    className={INPUT_CLASS}
                    value={row.supervisorId ?? ''}
                    onChange={(event) => {
                      pickSupervisor(index, event.target.value);
                    }}
                  >
                    <option value="">{t('dailyReport.chooseSupervisor')}</option>
                    {supervisors.map((supervisor) => (
                      <option key={supervisor.id} value={supervisor.id}>
                        {supervisor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                    {t('dailyReport.morning')}
                    <select
                      className={INPUT_CLASS}
                      value={row.morning}
                      onChange={(event) => {
                        updateRow(index, { morning: event.target.value as SupervisorAttendance });
                      }}
                    >
                      {SUPERVISOR_ATTENDANCE.map((option) => (
                        <option key={option} value={option}>
                          {option === 'none'
                            ? t('dailyReport.attendanceNone')
                            : option === 'absent'
                              ? t('dailyReport.attendanceAbsent')
                              : t('dailyReport.attendanceLate')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                    {t('dailyReport.evening')}
                    <select
                      className={INPUT_CLASS}
                      value={row.evening}
                      onChange={(event) => {
                        updateRow(index, { evening: event.target.value as SupervisorAttendance });
                      }}
                    >
                      {SUPERVISOR_ATTENDANCE.map((option) => (
                        <option key={option} value={option}>
                          {option === 'none'
                            ? t('dailyReport.attendanceNone')
                            : option === 'absent'
                              ? t('dailyReport.attendanceAbsent')
                              : t('dailyReport.attendanceLate')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                  {t('dailyReport.notes')}
                  <input
                    className={INPUT_CLASS}
                    value={row.notes}
                    onChange={(event) => {
                      updateRow(index, { notes: event.target.value });
                    }}
                  />
                </label>
              </div>
            ))}
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setSupervisorRows((prev) => [...prev, emptySupervisorRow()]);
                setDirty(true);
                setSaveState('idle');
              }}
            >
              {t('dailyReport.addRow')}
            </Button>
          </div>
        </div>
      ) : null}

      {saveBar}

      <FormError message={error} />

      <p className="text-sm text-neutral-500">{t('canteenDailyInfo.linkedToReport')}</p>
    </div>
  );
}
