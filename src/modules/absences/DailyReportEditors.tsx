import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import type { ParentCorrespondenceRow } from '@/db/types';
import { emptyParentRow, INPUT_CLASS } from '@/modules/absences/dailyReportEditorHelpers';
import type { StudentDayAbsence } from '@/utils/dailyPage1';
import { CANTEEN_SUPERVISOR_ROWS } from '@/utils/dailyReportHtml';

export interface StudentOption {
  id: string;
  name: string;
  className: string;
}

interface ParentRowsEditorProps {
  rows: ParentCorrespondenceRow[];
  students: StudentOption[];
  absentToday: StudentDayAbsence[];
  onApply: (rows: ParentCorrespondenceRow[]) => void;
  onClose: () => void;
}

export function ParentRowsEditor({ rows, students, absentToday, onApply, onClose }: ParentRowsEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(rows);

  const update = (index: number, patch: Partial<ParentCorrespondenceRow>) =>
    setDraft((previous) => previous.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  const pickStudent = (index: number, studentId: string) => {
    const student = students.find((item) => item.id === studentId);
    if (!student) {
      update(index, { studentId: null, name: '', className: '', hours: '', absenceDate: '' });
      return;
    }
    const absence = absentToday.find((item) => item.studentId === studentId);
    update(index, {
      studentId,
      name: student.name,
      className: student.className,
      hours: absence ? String(absence.hours) : '',
      absenceDate: absence ? absence.since : '',
    });
  };

  const removeRow = (index: number) => setDraft((previous) => previous.filter((_, position) => position !== index));

  return (
    <Modal open title={t('dailyReport.editParents')} onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pe-1">
        {draft.map((row, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-800">{t('dailyReport.rowNumber', { n: index + 1 })}</span>
              <Button variant="ghost" onClick={() => removeRow(index)}>
                {t('dailyReport.removeRow')}
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              {t('dailyReport.chooseStudent')}
              <select
                className={INPUT_CLASS}
                value={row.studentId ?? ''}
                onChange={(event) => pickStudent(index, event.target.value)}
              >
                <option value="">{t('dailyReport.chooseStudent')}</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} - {student.className}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField label={t('dailyReport.name')} value={row.name} onChange={(e) => update(index, { name: e.target.value })} />
              <TextField label={t('dailyReport.className')} value={row.className} onChange={(e) => update(index, { className: e.target.value })} />
              <TextField label={t('dailyReport.hours')} value={row.hours} inputMode="numeric" onChange={(e) => update(index, { hours: e.target.value })} />
              <TextField label={t('dailyReport.absenceDate')} type="date" value={row.absenceDate} onChange={(e) => update(index, { absenceDate: e.target.value })} />
              <TextField label={t('dailyReport.reason')} value={row.reason} onChange={(e) => update(index, { reason: e.target.value })} />
              <TextField label={t('dailyReport.firstNotice')} value={row.firstNotice} onChange={(e) => update(index, { firstNotice: e.target.value })} />
              <TextField label={t('dailyReport.secondNotice')} value={row.secondNotice} onChange={(e) => update(index, { secondNotice: e.target.value })} />
              <TextField label={t('dailyReport.excuse')} value={row.excuse} onChange={(e) => update(index, { excuse: e.target.value })} />
              <TextField label={t('dailyReport.struckDate')} type="date" value={row.struckDate} onChange={(e) => update(index, { struckDate: e.target.value })} />
            </div>
          </div>
        ))}
        <Button variant="secondary" fullWidth onClick={() => setDraft((previous) => [...previous, emptyParentRow()])}>
          {t('dailyReport.addRow')}
        </Button>
        <Button fullWidth onClick={() => onApply(draft)}>
          {t('dailyReport.apply')}
        </Button>
      </div>
    </Modal>
  );
}

interface TextBlockEditorProps {
  title: string;
  notes: string;
  onApply: (notes: string) => void;
  onClose: () => void;
}

export function TextBlockEditor({ title, notes, onApply, onClose }: TextBlockEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(notes);
  return (
    <Modal open title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <textarea
          value={draft}
          rows={8}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
        <Button fullWidth onClick={() => onApply(draft)}>
          {t('dailyReport.apply')}
        </Button>
      </div>
    </Modal>
  );
}

interface AllNotesEditorProps {
  observationsActions: string;
  canteenNote: string;
  counselorNotes: string;
  directorNotes: string;
  onApply: (patch: {
    observationsActions: string;
    canteenNote: string;
    counselorNotes: string;
    directorNotes: string;
  }) => void;
  onClose: () => void;
}

export function AllNotesEditor({
  observationsActions,
  canteenNote,
  counselorNotes,
  directorNotes,
  onApply,
  onClose,
}: AllNotesEditorProps) {
  const { t } = useTranslation();
  const [obs, setObs] = useState(observationsActions);
  const [canteen, setCanteen] = useState(canteenNote);
  const [counselor, setCounselor] = useState(counselorNotes);
  const [director, setDirector] = useState(directorNotes);

  return (
    <Modal open title={t('dailyReport.editNotes')} onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pe-1">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.observations')}
          <textarea
            value={obs}
            rows={3}
            onChange={(event) => setObs(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.canteenNote')}
          <textarea
            value={canteen}
            rows={2}
            onChange={(event) => setCanteen(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.counselorNotes')}
          <textarea
            value={counselor}
            rows={4}
            onChange={(event) => setCounselor(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.directorNotes')}
          <textarea
            value={director}
            rows={3}
            onChange={(event) => setDirector(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <Button
          fullWidth
          onClick={() =>
            onApply({
              observationsActions: obs,
              canteenNote: canteen,
              counselorNotes: counselor,
              directorNotes: director,
            })
          }
        >
          {t('dailyReport.apply')}
        </Button>
      </div>
    </Modal>
  );
}

interface CanteenNoteEditorProps {
  plannedMeal: string;
  mealServed: string;
  canteenNote: string;
  canteenEnteredCount: number | null;
  halfBoarderCount: number;
  canteenSupervisors: string[];
  availableSupervisors: string[];
  onApply: (patch: {
    plannedMeal: string;
    mealServed: string;
    canteenNote: string;
    canteenEnteredCount: number | null;
    canteenSupervisors: string[];
  }) => Promise<void> | void;
  onClose: () => void;
}

export function CanteenNoteEditor({
  plannedMeal,
  mealServed,
  canteenNote,
  canteenEnteredCount,
  halfBoarderCount,
  canteenSupervisors,
  availableSupervisors,
  onApply,
  onClose,
}: CanteenNoteEditorProps) {
  const { t } = useTranslation();
  const [planned, setPlanned] = useState(plannedMeal);
  const [meal, setMeal] = useState(mealServed);
  const [note, setNote] = useState(canteenNote);
  const [enteredText, setEnteredText] = useState(
    canteenEnteredCount !== null && canteenEnteredCount !== undefined ? String(canteenEnteredCount) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sups, setSups] = useState<string[]>(() =>
    Array.from({ length: CANTEEN_SUPERVISOR_ROWS }, (_, index) => canteenSupervisors[index] ?? ''),
  );

  const updateSup = (index: number, value: string) =>
    setSups((previous) => previous.map((item, position) => (position === index ? value : item)));

  const trimmedEntered = enteredText.trim();
  const enteredValid = trimmedEntered === '' || (/^\d+$/.test(trimmedEntered) && Number.isSafeInteger(Number(trimmedEntered)));
  const parsedEntered = trimmedEntered !== '' && enteredValid ? Number(trimmedEntered) : null;

  const handleSave = async () => {
    if (saving) return;
    if (!enteredValid) {
      setError(t('canteenDailyInfo.invalidEnteredCount'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onApply({
        plannedMeal: planned,
        mealServed: meal,
        canteenNote: note,
        canteenEnteredCount: parsedEntered,
        canteenSupervisors: sups.map((item) => item.trim()).filter(Boolean),
      });
    } catch {
      setError(t('dailyReport.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <Modal open title={t('dailyReport.canteenNote')} onClose={saving ? () => undefined : onClose}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pe-1">
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.canteenEnteredCount')}
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={enteredText}
            placeholder={t('canteenDailyInfo.enteredCountPlaceholder')}
            onChange={(event) => {
              setEnteredText(event.target.value);
              setError(null);
            }}
            className={`${INPUT_CLASS} tabular-nums`}
          />
          <span className="text-xs font-normal text-neutral-500">
            {parsedEntered !== null
              ? `${t('canteenDailyInfo.summaryHalfBoarders')}: ${halfBoarderCount} · ${t('canteenDailyInfo.summaryAbsent')}: ${Math.max(0, halfBoarderCount - parsedEntered)}`
              : t('dailyReport.canteenEnteredCountHint')}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.plannedMeal')}
          <textarea
            value={planned}
            rows={2}
            onChange={(event) => setPlanned(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.mealServed')}
          <textarea
            value={meal}
            rows={2}
            onChange={(event) => setMeal(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('dailyReport.canteenNote')}
          <textarea
            value={note}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base font-normal text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-neutral-700">{t('dailyReport.canteenSupervisors')}</span>
          {sups.map((value, index) => (
            <div key={index} className="flex flex-col gap-1.5">
              {availableSupervisors.length > 0 ? (
                <select
                  className={INPUT_CLASS}
                  value={availableSupervisors.includes(value) ? value : ''}
                  onChange={(event) => {
                    if (event.target.value) updateSup(index, event.target.value);
                  }}
                >
                  <option value="">{t('dailyReport.chooseSupervisor')}</option>
                  {availableSupervisors.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                type="text"
                value={value}
                placeholder={t('dailyReport.canteenSupervisorPlaceholder', { n: index + 1 })}
                onChange={(event) => updateSup(index, event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          ))}
        </div>
        {error ? <p className="text-sm font-medium text-danger-700">{error}</p> : null}
        <Button fullWidth disabled={saving} onClick={() => void handleSave()}>
          {saving ? t('canteenDailyInfo.saving') : t('dailyReport.apply')}
        </Button>
      </div>
    </Modal>
  );
}

interface DetailsEditorProps {
  reportNumber: string;
  schoolYear: string;
  onApply: (details: { reportNumber: string; schoolYear: string }) => void;
  onClose: () => void;
}

export function DetailsEditor({ reportNumber, schoolYear, onApply, onClose }: DetailsEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ reportNumber, schoolYear });
  return (
    <Modal open title={t('dailyReport.reportDetails')} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <TextField
          label={t('dailyReport.reportNumber')}
          value={draft.reportNumber}
          onChange={(event) => setDraft((previous) => ({ ...previous, reportNumber: event.target.value }))}
        />
        <TextField
          label={t('dailyReport.schoolYear')}
          value={draft.schoolYear}
          onChange={(event) => setDraft((previous) => ({ ...previous, schoolYear: event.target.value }))}
        />
        <Button fullWidth onClick={() => onApply(draft)}>
          {t('dailyReport.apply')}
        </Button>
      </div>
    </Modal>
  );
}
