import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SubpageHeader } from '@/components/SubpageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import type { SchoolClass, Student } from '@/db/types';
import type { PreviewRow, StudentImportMode } from './importRows';

interface ImportPreviewStepProps {
  rows: PreviewRow[];
  existingCount: number;
  extraStudents: Student[];
  classes: SchoolClass[];
  mode: StudentImportMode;
  deleteExtrasEnabled: boolean;
  selectedExtraIds: string[];
  committing: boolean;
  error: string | null;
  onModeChange: (mode: StudentImportMode) => void;
  onToggleDeleteExtras: (enabled: boolean) => void;
  onSelectedExtraIdsChange: (ids: string[]) => void;
  onBack: () => void;
  onCommit: () => void;
}

export function ImportPreviewStep({
  rows,
  existingCount,
  extraStudents,
  classes,
  mode,
  deleteExtrasEnabled,
  selectedExtraIds,
  committing,
  error,
  onModeChange,
  onToggleDeleteExtras,
  onSelectedExtraIdsChange,
  onBack,
  onCommit,
}: ImportPreviewStepProps) {
  const { t } = useTranslation();
  const [showExtraListInReplace, setShowExtraListInReplace] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const classById = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);
  const selectedExtraSet = useMemo(() => new Set(selectedExtraIds), [selectedExtraIds]);

  const validRows = useMemo(() => rows.filter((row) => row.input !== null), [rows]);
  const newRowsCount = useMemo(() => rows.filter((row) => row.status === 'new').length, [rows]);
  const existingRowsCount = useMemo(() => rows.filter((row) => row.status === 'existing').length, [rows]);
  const invalidCount = rows.length - validRows.length;

  const willAddCount = newRowsCount;
  const willUpdateCount = mode === 'replace' ? existingRowsCount : 0;
  const willDeleteCount =
    mode === 'replace'
      ? extraStudents.length
      : deleteExtrasEnabled
        ? selectedExtraIds.length
        : 0;

  const hasChanges =
    mode === 'replace'
      ? validRows.length > 0
      : willAddCount > 0 || willDeleteCount > 0;

  const isExcelSmallerThanOld = existingCount > validRows.length && extraStudents.length > 0;

  const toggleExtraStudent = (studentId: string) => {
    if (selectedExtraSet.has(studentId)) {
      onSelectedExtraIdsChange(selectedExtraIds.filter((id) => id !== studentId));
    } else {
      onSelectedExtraIdsChange([...selectedExtraIds, studentId]);
    }
  };

  const handlePrimaryAction = () => {
    if (!hasChanges || committing) return;
    if (willDeleteCount > 0) {
      setConfirmOpen(true);
    } else {
      onCommit();
    }
  };

  const primaryLabel = (() => {
    if (committing) return t('students.import.importing');
    if (mode === 'replace') {
      return t('students.import.commitReplace', { count: validRows.length });
    }
    if (willAddCount > 0 && willDeleteCount > 0) {
      return t('students.import.commitAddAndDelete', { added: willAddCount, deleted: willDeleteCount });
    }
    if (willAddCount === 0 && willDeleteCount > 0) {
      return t('students.import.commitDeleteOnly', { deleted: willDeleteCount });
    }
    return t('students.import.commitAddMissing', { count: willAddCount });
  })();

  return (
    <div className="flex flex-col gap-6">
      <SubpageHeader title={t('students.import.title')} subtitle={t('students.import.previewSubtitle')} onBack={onBack} />

      {/* Import Mode Selection */}
      <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
        <span className="text-sm font-bold text-neutral-800">{t('students.import.modeTitle')}</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('students.import.modeTitle')}>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'replace'}
            onClick={() => onModeChange('replace')}
            className={`flex min-h-16 flex-col gap-1.5 rounded-2xl p-4 text-start transition ${
              mode === 'replace'
                ? 'bg-primary-50 ring-2 ring-primary-600'
                : 'bg-neutral-50 ring-1 ring-neutral-200 hover:bg-neutral-100'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-neutral-900">
              <RefreshCw className="size-4 shrink-0 text-primary-700" aria-hidden />
              {t('students.import.modeReplaceTitle')}
            </span>
            <span className="text-xs text-neutral-600">{t('students.import.modeReplaceDesc')}</span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={mode === 'addMissing'}
            onClick={() => onModeChange('addMissing')}
            className={`flex min-h-16 flex-col gap-1.5 rounded-2xl p-4 text-start transition ${
              mode === 'addMissing'
                ? 'bg-primary-50 ring-2 ring-primary-600'
                : 'bg-neutral-50 ring-1 ring-neutral-200 hover:bg-neutral-100'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-neutral-900">
              <UserPlus className="size-4 shrink-0 text-primary-700" aria-hidden />
              {t('students.import.modeAddMissingTitle')}
            </span>
            <span className="text-xs text-neutral-600">{t('students.import.modeAddMissingDesc')}</span>
          </button>
        </div>
      </section>

      {/* Comparison Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label={t('students.import.existingTotal')} value={existingCount} tone="neutral" />
        <SummaryCard label={t('students.import.fileValidTotal')} value={validRows.length} tone="primary" />
        <SummaryCard label={t('students.import.missingNewCount')} value={newRowsCount} tone="success" />
        <SummaryCard
          label={t('students.import.extraOldCount')}
          value={extraStudents.length}
          tone={extraStudents.length > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Extra old students panel */}
      {extraStudents.length > 0 ? (
        mode === 'replace' ? (
          <section className="flex flex-col gap-3 rounded-2xl border border-danger-200 bg-danger-50/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Trash2 className="mt-0.5 size-5 shrink-0 text-danger-700" aria-hidden />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-danger-800">
                    {t('students.import.replaceWillDeleteTitle', { count: extraStudents.length })}
                  </span>
                  <span className="text-xs text-danger-700">
                    {t('students.import.replaceWillDeleteBody')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExtraListInReplace((prev) => !prev)}
                className="flex min-h-10 shrink-0 items-center gap-1 rounded-xl bg-white px-3 text-xs font-bold text-danger-700 ring-1 ring-danger-200"
              >
                <span>{showExtraListInReplace ? t('students.import.hideList') : t('students.import.showList')}</span>
                {showExtraListInReplace ? (
                  <ChevronUp className="size-4" aria-hidden />
                ) : (
                  <ChevronDown className="size-4" aria-hidden />
                )}
              </button>
            </div>

            {showExtraListInReplace ? (
              <ul className="max-h-48 divide-y divide-danger-100 overflow-y-auto rounded-xl bg-white ring-1 ring-danger-200">
                {extraStudents.map((student) => (
                  <li key={student.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate font-semibold text-neutral-900">
                      {`${student.firstName} ${student.lastName}`.trim()}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {classById.get(student.classId) ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <section className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-amber-900">
                  {isExcelSmallerThanOld
                    ? t('students.import.extraOldSmallerTitle', {
                        count: extraStudents.length,
                        fileCount: validRows.length,
                        oldCount: existingCount,
                      })
                    : t('students.import.extraOldGeneralTitle', { count: extraStudents.length })}
                </span>
                <span className="text-xs text-amber-800">
                  {t('students.import.extraOldHint')}
                </span>
              </div>
            </div>

            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 text-sm font-bold text-neutral-900 ring-1 ring-amber-200">
              <span className="flex items-center gap-2">
                <Trash2 className="size-4 text-danger-600" aria-hidden />
                {t('students.import.deleteExtraToggle', { count: extraStudents.length })}
              </span>
              <input
                type="checkbox"
                checked={deleteExtrasEnabled}
                onChange={(event) => onToggleDeleteExtras(event.target.checked)}
                className="size-5 accent-danger-600"
              />
            </label>

            {deleteExtrasEnabled ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-amber-900">
                    {t('students.import.selectedToDeleteCount', {
                      selected: selectedExtraIds.length,
                      total: extraStudents.length,
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectedExtraIdsChange(extraStudents.map((s) => s.id))}
                      className="font-bold text-primary-700 underline"
                    >
                      {t('students.import.selectAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectedExtraIdsChange([])}
                      className="font-bold text-neutral-600 underline"
                    >
                      {t('students.import.clearSelection')}
                    </button>
                  </div>
                </div>

                <ul className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-xl bg-white ring-1 ring-amber-200">
                  {extraStudents.map((student) => {
                    const checked = selectedExtraSet.has(student.id);
                    return (
                      <li key={student.id}>
                        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3.5 py-2 hover:bg-neutral-50">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExtraStudent(student.id)}
                              className="size-4 shrink-0 accent-danger-600"
                            />
                            <span className="truncate text-sm font-semibold text-neutral-900">
                              {`${student.firstName} ${student.lastName}`.trim()}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs text-neutral-500">
                            {classById.get(student.classId) ?? ''}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>
        )
      ) : null}

      {/* File Rows Preview */}
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white px-6 py-10 text-center text-base text-neutral-500 ring-1 ring-neutral-200">
          {t('students.import.noDataRows')}
        </p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-2.5 overflow-y-auto pe-1">
          {rows.map((row) => {
            const isInvalid = row.status === 'invalid';
            const isNew = row.status === 'new';

            const badge = isInvalid
              ? {
                  label: t('students.import.skipped'),
                  className: 'bg-danger-50 text-danger-700',
                  icon: <AlertTriangle className="size-4" aria-hidden />,
                }
              : isNew
                ? {
                    label: t('students.import.statusNew'),
                    className: 'bg-success-50 text-success-700',
                    icon: <CheckCircle2 className="size-4" aria-hidden />,
                  }
                : mode === 'replace'
                  ? {
                      label: t('students.import.statusUpdate'),
                      className: 'bg-primary-50 text-primary-700',
                      icon: <RefreshCw className="size-3.5" aria-hidden />,
                    }
                  : {
                      label: t('students.import.statusAlreadyExists'),
                      className: 'bg-neutral-100 text-neutral-600',
                      icon: <CheckCircle2 className="size-4" aria-hidden />,
                    };

            return (
              <li
                key={row.rowNumber}
                className={`flex flex-col gap-2 rounded-2xl bg-white p-4 ring-1 ${
                  isInvalid ? 'ring-danger-200' : 'ring-neutral-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-xs text-neutral-500">
                      {t('students.import.rowNumber', { number: row.rowNumber })}
                      {row.className ? ` · ${row.className}` : ''}
                    </span>
                    <span className="truncate text-base font-semibold text-neutral-900">
                      {row.displayName || t('students.import.unnamedRow')}
                    </span>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}
                  >
                    {badge.icon}
                    {badge.label}
                  </span>
                </div>
                {row.issues.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm text-danger-700">
                    {row.issues.map((issue, index) => (
                      <li key={`${issue.key}-${index}`}>
                        {issue.field
                          ? t('students.import.fieldIssue', { field: t(`students.fields.${issue.field}`), issue: t(issue.key) })
                          : t(issue.key)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <FormError message={error} />

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onBack} disabled={committing}>
          {t('common.back')}
        </Button>
        <Button
          variant={willDeleteCount > 0 && mode === 'replace' ? 'danger' : 'primary'}
          onClick={handlePrimaryAction}
          disabled={!hasChanges || committing}
        >
          {primaryLabel}
        </Button>
      </div>
      {invalidCount > 0 ? <p className="text-sm text-neutral-500">{t('students.import.skipNote')}</p> : null}

      {/* Confirmation dialog when deleting old/extra students */}
      <Modal
        open={confirmOpen}
        title={t('students.import.confirmDeleteTitle')}
        description={
          mode === 'replace'
            ? t('students.import.confirmReplaceBody', {
                added: willAddCount,
                updated: willUpdateCount,
                deleted: willDeleteCount,
              })
            : t('students.import.confirmAddDeleteBody', {
                added: willAddCount,
                deleted: willDeleteCount,
              })
        }
        onClose={() => setConfirmOpen(false)}
      >
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" fullWidth onClick={() => setConfirmOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            fullWidth
            disabled={committing}
            onClick={() => {
              setConfirmOpen(false);
              onCommit();
            }}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'primary' | 'success' | 'danger';
}) {
  const toneClass = {
    neutral: 'text-neutral-900',
    primary: 'text-primary-700',
    success: 'text-success-700',
    danger: 'text-danger-700',
  }[tone];
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-white p-3.5 ring-1 ring-neutral-200">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}
