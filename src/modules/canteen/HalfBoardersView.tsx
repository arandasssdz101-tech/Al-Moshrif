import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Edit3, Plus, Search, Trash2, Upload, Utensils } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { EmptyState, FormError } from '@/components/ui/StatusBlock';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { createStudent, setStudentCardCode, updateStudentBoarding, updateStudent, upsertHalfBoarders, type HbUpsertRow } from '@/db/students';
import { useSession } from '@/modules/auth/AuthContext';
import { errorKey } from '@/utils/errors';
import { normalizeText } from '@/utils/text';
import { todayIso } from '@/utils/dates';
import { saveWorkbook } from '@/utils/spreadsheet';
import { exportRowsToExcel, readFirstSheet } from '@/utils/spreadsheet';
import type { SchoolClass, Student, StudentInput, Gender } from '@/db/types';
import { GENDERS } from '@/db/types';
import { TEXT_MAX_LENGTH, prepareStudentInput, validateStudentInput } from '@/db/studentRules';
import {
  buildHbPreviewRows,
  detectHbMapping,
  findHalfBoardersMissingFromImport,
  buildHalfBoarderTemplate,
  buildHalfBoarderExportRows,
  buildErrorWorkbook,
  type HbPreviewRow,
} from '@/modules/canteen/halfBoardersImport';

interface HalfBoardersViewProps {
  canEdit: boolean;
  students: Student[];
  classes: SchoolClass[];
  onReload: () => Promise<void>;
}

export function HalfBoardersView({ canEdit, students, classes, onReload }: HalfBoardersViewProps) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [noCardOnly, setNoCardOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Student | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Student | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const halfBoarders = useMemo(
    () => students.filter((s) => s.boardingStatus === 'half-boarder'),
    [students],
  );

  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );

  const visible = useMemo(() => {
    const needle = normalizeText(query);
    return halfBoarders.filter(
      (s) =>
        (classFilter === null || s.classId === classFilter) &&
        (!noCardOnly || !(s.cardCode && s.cardCode.trim())) &&
        (needle === '' ||
          normalizeText(`${s.firstName} ${s.lastName}`).includes(needle) ||
          Boolean(s.cardCode && normalizeText(s.cardCode).includes(needle))),
    );
  }, [halfBoarders, query, classFilter, noCardOnly]);

  const counts = useMemo(() => {
    const withCard = halfBoarders.filter((s) => s.cardCode && s.cardCode.trim()).length;
    return {
      total: halfBoarders.length,
      withCard,
      withoutCard: halfBoarders.length - withCard,
    };
  }, [halfBoarders]);

  const handleExport = () => {
    const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
    const rows = buildHalfBoarderExportRows(visible, classes, lang);
    exportRowsToExcel(rows, t('canteen.halfBoarders.title'), `half-boarders-${todayIso()}.xlsx`);
  };

  const handleTemplate = () => {
    const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
    const wb = buildHalfBoarderTemplate(lang);
    saveWorkbook(wb, 'half-boarders-template.xlsx');
  };

  const handleRemoveFromHalfBoarders = async () => {
    if (!removeTarget) return;
    setError(null);
    try {
      await updateStudentBoarding(removeTarget.id, 'external', user.id);
      setRemoveTarget(null);
      await onReload();
    } catch (removeError) {
      setError(t(errorKey(removeError)));
    }
  };

  const counterItems = [
    { label: t('canteen.halfBoarders.total'), value: counts.total, tone: 'text-neutral-900' },
    { label: t('canteen.halfBoarders.withCard'), value: counts.withCard, tone: 'text-success-700' },
    { label: t('canteen.halfBoarders.withoutCard'), value: counts.withoutCard, tone: 'text-warning-700' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold text-neutral-900">{t('canteen.halfBoarders.title')}</h2>
        <p className="text-sm text-neutral-600">{t('canteen.halfBoarders.subtitle')}</p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        {counterItems.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
            <span className="text-xs text-neutral-500">{item.label}</span>
            <span className={`text-2xl font-extrabold ${item.tone}`}>{item.value}</span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button onClick={() => setAddOpen(true)} icon={<Plus className="size-5" aria-hidden />}>
            {t('canteen.halfBoarders.add')}
          </Button>
        ) : null}
        {canEdit ? (
          <Button variant="secondary" onClick={() => setImportOpen(true)} icon={<Upload className="size-5" aria-hidden />}>
            {t('canteen.halfBoarders.importExcel')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={handleExport} icon={<Download className="size-5" aria-hidden />}>
          {t('canteen.halfBoarders.exportExcel')}
        </Button>
        {canEdit ? (
          <Button variant="ghost" onClick={handleTemplate} icon={<Download className="size-5" aria-hidden />}>
            {t('canteen.halfBoarders.template')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex min-h-12 items-center gap-3 rounded-xl bg-white px-4 ring-1 ring-neutral-300 transition focus-within:ring-4 focus-within:ring-primary-500/15">
          <Search className="size-5 shrink-0 text-neutral-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('canteen.halfBoarders.searchPlaceholder')}
            className="min-h-12 w-full bg-transparent text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
          />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <FilterChip label={t('canteen.halfBoarders.allClasses')} active={classFilter === null} onClick={() => setClassFilter(null)} />
          {classes.map((schoolClass) => (
            <FilterChip
              key={schoolClass.id}
              label={schoolClass.name}
              active={classFilter === schoolClass.id}
              onClick={() => setClassFilter(schoolClass.id)}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <FilterChip
            label={t('canteen.halfBoarders.noCardFilter')}
            active={noCardOnly}
            onClick={() => setNoCardOnly((v) => !v)}
          />
        </div>
      </div>

      <FormError message={error} />

      {halfBoarders.length === 0 ? (
        <EmptyState
          icon={<Utensils className="size-7" aria-hidden />}
          title={t('canteen.halfBoarders.emptyTitle')}
          body={t('canteen.halfBoarders.emptyBody')}
        />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl bg-white px-6 py-10 text-center text-base text-neutral-500 ring-1 ring-neutral-200">
          {t('canteen.halfBoarders.noMatches')}
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">{t('canteen.halfBoarders.resultCount', { count: visible.length })}</p>
          <ul className="flex flex-col gap-3">
            {visible.map((student) => {
              const hasCard = Boolean(student.cardCode?.trim());
              return (
                <li key={student.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary-50 text-sm font-bold text-secondary-700">
                    {`${student.firstName.charAt(0)}${student.lastName.charAt(0)}`.toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-neutral-900">{student.firstName} {student.lastName}</span>
                    <span className="truncate text-sm text-neutral-500">
                      {classNameById.get(student.classId) ?? t('canteen.halfBoarders.unknownClass')}
                      {student.dateOfBirth ? ` · ${formatDate(student.dateOfBirth, i18n.language)}` : ''}
                    </span>
                    <span className={`text-xs ${hasCard ? 'text-neutral-400' : 'font-medium text-warning-600'}`} dir={hasCard ? 'ltr' : undefined}>
                      {hasCard ? student.cardCode : t('canteen.halfBoarders.noCard')}
                    </span>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => setEditTarget(student)}
                        className="min-h-11 px-3 text-sm"
                        icon={<Edit3 className="size-4" aria-hidden />}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setRemoveTarget(student)}
                        className="min-h-11 px-3 text-sm text-danger-600"
                        icon={<Trash2 className="size-4" aria-hidden />}
                      >
                        {t('canteen.halfBoarders.remove')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {canEdit ? (
        <AddHalfBoarderModal
          open={addOpen}
          classes={classes}
          existingStudents={students}
          onClose={() => setAddOpen(false)}
          onSaved={async () => { setAddOpen(false); await onReload(); }}
        />
      ) : null}

      {canEdit && editTarget ? (
        <EditHalfBoarderModal
          open={editTarget !== null}
          student={editTarget}
          classes={classes}
          onClose={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await onReload(); }}
        />
      ) : null}

      {canEdit ? (
        <ImportHalfBoardersModal
          open={importOpen}
          classes={classes}
          existingStudents={students}
          onClose={() => setImportOpen(false)}
          onDone={async () => { setImportOpen(false); await onReload(); }}
        />
      ) : null}

      <Modal
        open={removeTarget !== null}
        title={t('canteen.halfBoarders.removeTitle', { name: removeTarget ? `${removeTarget.firstName} ${removeTarget.lastName}` : '' })}
        description={t('canteen.halfBoarders.removeBody')}
        onClose={() => setRemoveTarget(null)}
      >
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button variant="danger" fullWidth onClick={handleRemoveFromHalfBoarders}>
            {t('canteen.halfBoarders.remove')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setRemoveTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function formatDate(iso: string, lang: string): string {
  const d = new Date(iso + 'T00:00');
  return new Intl.DateTimeFormat(lang.startsWith('ar') ? 'ar' : 'en', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

interface AddDraft {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  classId: string;
  cardCode: string;
  gender: Gender;
}

function AddHalfBoarderModal({
  open, classes, existingStudents, onClose, onSaved,
}: {
  open: boolean;
  classes: SchoolClass[];
  existingStudents: Student[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const [draft, setDraft] = useState<AddDraft>({ firstName: '', lastName: '', dateOfBirth: '', classId: classes[0]?.id ?? '', cardCode: '', gender: 'male' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<Student | null>(null);

  const reset = () => {
    setDraft({ firstName: '', lastName: '', dateOfBirth: '', classId: classes[0]?.id ?? '', cardCode: '', gender: 'male' });
    setFieldErrors({});
    setFormError(null);
    setDuplicateMatch(null);
  };
  const close = () => { reset(); onClose(); };

  const checkDuplicate = useCallback((d: AddDraft) => {
    const fn = normalizeText(d.firstName);
    const ln = normalizeText(d.lastName);
    const dob = d.dateOfBirth || null;
    if (!fn || !ln) return null;
    return existingStudents.find((s) => {
      const sFn = normalizeText(s.firstName);
      const sLn = normalizeText(s.lastName);
      if (dob && s.dateOfBirth) return sFn === fn && sLn === ln && s.dateOfBirth === dob;
      const classNameById = new Map(classes.map((c) => [c.id, c.name]));
      return sFn === fn && sLn === ln && normalizeText(classNameById.get(s.classId) ?? '') === normalizeText(classNameById.get(d.classId) ?? '');
    }) ?? null;
  }, [existingStudents, classes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (!draft.firstName.trim()) { setFieldErrors({ firstName: t('validation.required') }); return; }
    if (!draft.lastName.trim()) { setFieldErrors({ lastName: t('validation.required') }); return; }
    if (!draft.classId) { setFieldErrors({ classId: t('validation.classRequired') }); return; }

    const match = checkDuplicate(draft);
    if (match) {
      setDuplicateMatch(match);
      return;
    }

    const input: StudentInput = {
      firstName: draft.firstName,
      lastName: draft.lastName,
      gender: draft.gender,
      dateOfBirth: draft.dateOfBirth || null,
      placeOfBirth: '',
      repeater: false,
      boardingStatus: 'half-boarder',
      classId: draft.classId,
      joinDate: todayIso(),
      leaveDate: null,
      cardCode: draft.cardCode.trim() || null,
    };
    const issues = validateStudentInput(input);
    if (issues.length > 0) {
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, t(issue.key)])));
      return;
    }
    setSubmitting(true);
    try {
      const prepared = prepareStudentInput(input);
      await createStudent(institution.id, prepared, user.id);
      reset();
      onSaved();
    } catch (saveError) {
      setFormError(t(errorKey(saveError)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateExisting = async () => {
    if (!duplicateMatch) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await updateStudentBoarding(duplicateMatch.id, 'half-boarder', user.id);
      if (draft.cardCode.trim()) {
        await setStudentCardCode(duplicateMatch.id, draft.cardCode, user.id);
      }
      reset();
      onSaved();
    } catch (saveError) {
      setFormError(t(errorKey(saveError)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title={t('canteen.halfBoarders.add')} onClose={close}>
      {duplicateMatch ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-warning-50 p-4 text-sm text-warning-800">
            {t('canteen.halfBoarders.duplicateFound', { name: `${duplicateMatch.firstName} ${duplicateMatch.lastName}` })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button fullWidth onClick={handleUpdateExisting} disabled={submitting}>
              {t('canteen.halfBoarders.updateExisting')}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => setDuplicateMatch(null)}>
              {t('canteen.halfBoarders.createNew')}
            </Button>
          </div>
          {formError ? <FormError message={formError} /> : null}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <TextField
            label={t('students.fields.firstName')}
            maxLength={TEXT_MAX_LENGTH}
            autoComplete="off"
            value={draft.firstName}
            error={fieldErrors.firstName ?? null}
            onChange={(e) => { setDraft({ ...draft, firstName: e.target.value }); setFieldErrors({}); }}
          />
          <TextField
            label={t('students.fields.lastName')}
            maxLength={TEXT_MAX_LENGTH}
            autoComplete="off"
            value={draft.lastName}
            error={fieldErrors.lastName ?? null}
            onChange={(e) => { setDraft({ ...draft, lastName: e.target.value }); setFieldErrors({}); }}
          />
          <TextField
            label={t('students.fields.dateOfBirth')}
            type="date"
            value={draft.dateOfBirth}
            error={fieldErrors.dateOfBirth ?? null}
            onChange={(e) => { setDraft({ ...draft, dateOfBirth: e.target.value }); setFieldErrors({}); }}
          />
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700">{t('students.fields.className')}</span>
            <select
              value={draft.classId}
              onChange={(e) => { setDraft({ ...draft, classId: e.target.value }); setFieldErrors({}); }}
              className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/15"
            >
              <option value="">{t('students.form.choosePlaceholder')}</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {fieldErrors.classId ? <span className="text-sm text-danger-700">{fieldErrors.classId}</span> : null}
          </label>
          <div>
            <span className="text-sm font-medium text-neutral-700">{t('students.fields.gender')}</span>
            <div className="mt-2 flex gap-2">
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => { setDraft({ ...draft, gender: g }); setFieldErrors({}); }}
                  className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-medium transition ${
                    draft.gender === g ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  {t(`students.gender.${g}`)}
                </button>
              ))}
            </div>
          </div>
          <TextField
            label={t('students.cardCode.label')}
            hint={t('students.cardCode.hint')}
            maxLength={TEXT_MAX_LENGTH}
            autoComplete="off"
            value={draft.cardCode}
            onChange={(e) => { setDraft({ ...draft, cardCode: e.target.value }); setFieldErrors({}); }}
          />
          <FormError message={formError} />
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button type="submit" fullWidth disabled={submitting}>{t('common.save')}</Button>
            <Button type="button" variant="ghost" fullWidth onClick={close}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditHalfBoarderModal({
  open, student, classes, onClose, onSaved,
}: {
  open: boolean;
  student: Student;
  classes: SchoolClass[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [cardCode, setCardCode] = useState(student.cardCode ?? '');
  const [classId, setClassId] = useState(student.classId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input: StudentInput = {
        ...student,
        classId,
        cardCode: cardCode.trim() || null,
      };
      await updateStudent(student.id, input, user.id);
      onSaved();
    } catch (saveError) {
      setError(t(errorKey(saveError)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title={t('canteen.halfBoarders.edit', { name: `${student.firstName} ${student.lastName}` })} onClose={onClose}>
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-600">
          <p className="font-medium text-neutral-900">{student.firstName} {student.lastName}</p>
          {student.dateOfBirth ? <p className="text-neutral-500">{formatDate(student.dateOfBirth, 'en')}</p> : null}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-neutral-700">{t('students.fields.className')}</span>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/15"
          >
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <TextField
          label={t('students.cardCode.label')}
          maxLength={TEXT_MAX_LENGTH}
          autoComplete="off"
          value={cardCode}
          onChange={(e) => setCardCode(e.target.value)}
        />
        <FormError message={error} />
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button type="submit" fullWidth disabled={submitting}>{t('common.save')}</Button>
          <Button type="button" variant="ghost" fullWidth onClick={onClose}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportHalfBoardersModal({
  open, classes, existingStudents, onClose, onDone,
}: {
  open: boolean;
  classes: SchoolClass[];
  existingStudents: Student[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const [step, setStep] = useState<'pick' | 'preview' | 'done'>('pick');
  const [file, setFile] = useState<{ headers: string[]; rows: unknown[][] } | null>(null);
  const [preview, setPreview] = useState<HbPreviewRow[]>([]);
  const [reading, setReading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; removed: number; convertedToExternal: number } | null>(null);
  const [bypassWarnings, setBypassWarnings] = useState(false);
  const [confirmedConflictRows, setConfirmedConflictRows] = useState<Set<number>>(() => new Set());

  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );

  const reset = () => {
    setStep('pick'); setFile(null); setPreview([]);
    setError(null); setResult(null); setBypassWarnings(false);
    setConfirmedConflictRows(new Set());
  };
  const close = () => { reset(); onClose(); };

  const handleFile = async (selected: File) => {
    setReading(true);
    setError(null);
    try {
      const sheet = await readFirstSheet(selected);
      if (sheet.length < 2) { setError(t('canteen.halfBoarders.import.noRows')); return; }
      const headers = (sheet[0] as unknown[]).map((cell) => String(cell ?? '').trim());
      setFile({ headers, rows: sheet.slice(1) });
      const detected = detectHbMapping(headers);
      const rows = buildHbPreviewRows({
        rows: sheet.slice(1),
        mapping: detected,
        classes,
        existing: existingStudents,
        today: todayIso(),
      });
      setPreview(rows);
      setConfirmedConflictRows(new Set());
      setStep('preview');
    } catch {
      setError(t('canteen.halfBoarders.import.readFailed'));
    } finally {
      setReading(false);
    }
  };

  const conflictRows = preview.filter((r) => r.action === 'update' && r.classConflict !== null);
  const allConflictsConfirmed =
    conflictRows.length > 0 && conflictRows.every((r) => confirmedConflictRows.has(r.rowNumber));
  const confirmedConflictCount = conflictRows.filter((r) => confirmedConflictRows.has(r.rowNumber)).length;
  const unconfirmedConflictCount = conflictRows.length - confirmedConflictCount;

  const toggleAllConflicts = (checked: boolean) => {
    if (checked) {
      setConfirmedConflictRows(new Set(conflictRows.map((r) => r.rowNumber)));
    } else {
      setConfirmedConflictRows(new Set());
    }
  };

  const toggleConflictRow = (rowNumber: number) => {
    setConfirmedConflictRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  const validRows = preview.filter((r) => {
    if (r.action !== 'update') return false;
    if (!bypassWarnings && r.issues.length > 0) return false;
    if (r.classConflict !== null && !confirmedConflictRows.has(r.rowNumber)) return false;
    return true;
  });
  const warningRows = preview.filter((r) => r.action === 'update' && r.issues.length > 0);
  const skippedRows = preview.filter((r) => r.action === 'skipped');
  const errorRows = preview.filter((r) => r.action === 'error');
  const updateCount = preview.filter((r) => r.action === 'update').length;
  const hasRecognizedRows = errorRows.length < preview.length;
  const toExternalStudents = useMemo(
    () => (hasRecognizedRows ? findHalfBoardersMissingFromImport(existingStudents, preview) : []),
    [existingStudents, preview, hasRecognizedRows],
  );
  const canCommit = !committing && (validRows.length > 0 || toExternalStudents.length > 0);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const upsertRows: HbUpsertRow[] = validRows.map((r) => ({
        action: 'update',
        input:
          r.input && r.classConflict
            ? { ...r.input, classId: r.classConflict.registeredClassId }
            : r.input,
        matchedStudentId: r.matchedStudent?.id ?? null,
        cardCode: r.input?.cardCode ?? r.matchedStudent?.cardCode ?? '',
      }));
      const toExternalIds = toExternalStudents.map((s) => s.id);
      const res = await upsertHalfBoarders(institution.id, upsertRows, user.id, toExternalIds);
      setResult({
        updated: res.updated,
        removed: skippedRows.length,
        convertedToExternal: res.convertedToExternal,
      });
      setStep('done');
    } catch (commitError) {
      setError(t(errorKey(commitError)));
    } finally {
      setCommitting(false);
    }
  };

  const handleDownloadErrors = () => {
    const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
    const errors = errorRows.map((r) => ({
      rowNumber: r.rowNumber,
      displayName: r.displayName,
      reason: r.issues.map((i) => t(`canteen.halfBoarders.import.${i.key}`, i.key)).join(', '),
    }));
    const wb = buildErrorWorkbook(errors, lang);
    saveWorkbook(wb, 'import-errors.xlsx');
  };

  if (step === 'preview' && file) {
    return (
      <Modal open={open} title={t('canteen.halfBoarders.importExcel')} onClose={close}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-2">
            <div className="flex flex-col items-center rounded-xl bg-primary-50 p-3 text-center">
              <span className="text-xs text-primary-700">{t('canteen.halfBoarders.import.update')}</span>
              <span className="text-2xl font-extrabold tabular-nums text-primary-700">{updateCount}</span>
            </div>
            <div className="flex flex-col items-center rounded-xl bg-neutral-100 p-3 text-center">
              <span className="text-xs text-neutral-700">{t('canteen.halfBoarders.import.unregistered')}</span>
              <span className="text-2xl font-extrabold tabular-nums text-neutral-800">{skippedRows.length}</span>
            </div>
            <div className="flex flex-col items-center rounded-xl bg-warning-50 p-3 text-center">
              <span className="text-xs text-warning-700">{t('canteen.halfBoarders.import.toExternal')}</span>
              <span className="text-2xl font-extrabold tabular-nums text-warning-700">{toExternalStudents.length}</span>
            </div>
            <div className="flex flex-col items-center rounded-xl bg-danger-50 p-3 text-center">
              <span className="text-xs text-danger-700">
                {conflictRows.length > 0
                  ? t('canteen.halfBoarders.import.classConflicts')
                  : t('canteen.halfBoarders.import.errors')}
              </span>
              <span className="text-2xl font-extrabold tabular-nums text-danger-700">
                {conflictRows.length > 0 ? conflictRows.length : errorRows.length}
              </span>
            </div>
          </div>

          {conflictRows.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-50/70 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-700" aria-hidden />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-bold text-warning-900">
                    {t('canteen.halfBoarders.import.classConflictTitle', { count: conflictRows.length })}
                  </p>
                  <p className="text-xs text-warning-800">
                    {t('canteen.halfBoarders.import.classConflictHint')}
                  </p>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-warning-300">
                <input
                  type="checkbox"
                  checked={allConflictsConfirmed}
                  onChange={(e) => toggleAllConflicts(e.target.checked)}
                  className="size-5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm font-semibold text-neutral-900">
                  {t('canteen.halfBoarders.import.confirmClassFixAll', { count: conflictRows.length })}
                </span>
              </label>

              {unconfirmedConflictCount > 0 ? (
                <p className="text-xs font-medium text-warning-800">
                  {t('canteen.halfBoarders.import.unconfirmedConflictsHint')}
                </p>
              ) : null}
            </div>
          ) : null}

          {skippedRows.length > 0 ? (
            <div className="rounded-xl bg-neutral-100 px-4 py-3 text-xs font-medium text-neutral-700">
              {t('canteen.halfBoarders.import.unregisteredRemovedHint', { count: skippedRows.length })}
            </div>
          ) : null}

          {toExternalStudents.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-warning-200 bg-warning-50/60 p-3.5">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-bold text-warning-900">
                  {t('canteen.halfBoarders.import.toExternalTitle', { count: toExternalStudents.length })}
                </p>
                <p className="text-xs text-warning-800">
                  {t('canteen.halfBoarders.import.toExternalHint')}
                </p>
              </div>
              <ul className="max-h-28 space-y-1 overflow-y-auto pt-1 text-xs text-warning-900">
                {toExternalStudents.map((student) => (
                  <li key={student.id} className="flex items-center justify-between gap-2 rounded-md bg-white/80 px-2.5 py-1">
                    <span className="truncate font-medium">{student.firstName} {student.lastName}</span>
                    <span className="shrink-0 text-neutral-500">
                      {classNameById.get(student.classId) ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {validRows.length > 0 ? (
            <div className="rounded-xl bg-success-50 px-4 py-3 text-sm font-medium text-success-800">
              {t('canteen.halfBoarders.import.validRows', { count: validRows.length })}
            </div>
          ) : null}

          {warningRows.length > 0 ? (
            <label className="flex items-center gap-3 rounded-xl bg-neutral-50 px-4 py-3 ring-1 ring-neutral-200">
              <input
                type="checkbox"
                checked={bypassWarnings}
                onChange={(e) => setBypassWarnings(e.target.checked)}
                className="size-5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-neutral-700">{t('canteen.halfBoarders.import.bypassWarnings')}</span>
            </label>
          ) : null}

          {error ? <FormError message={error} /> : null}
          <div className="max-h-60 overflow-y-auto">
            <ul className="flex flex-col gap-2">
              {preview.map((row) => {
                const isSkipped = row.action === 'skipped';
                const hasWarnings = row.issues.length > 0 && row.action === 'update';
                const hasConflict = row.classConflict !== null && row.action === 'update';
                const isConflictConfirmed = hasConflict && confirmedConflictRows.has(row.rowNumber);
                const bg = row.action === 'error'
                  ? 'bg-danger-50'
                  : isSkipped
                    ? 'bg-neutral-100'
                    : hasConflict
                      ? isConflictConfirmed ? 'bg-success-50' : 'bg-warning-50'
                      : hasWarnings
                        ? 'bg-warning-50'
                        : 'bg-primary-50';
                const textTone = row.action === 'error'
                  ? 'text-danger-700'
                  : isSkipped
                    ? 'text-neutral-600'
                    : hasConflict
                      ? isConflictConfirmed ? 'text-success-700' : 'text-warning-700'
                      : hasWarnings
                        ? 'text-warning-700'
                        : 'text-primary-700';
                const label = row.action === 'error'
                  ? t(`canteen.halfBoarders.import.${row.issues[0]?.key ?? 'unknownError'}`)
                  : isSkipped
                    ? t('canteen.halfBoarders.import.unregisteredBadge')
                    : hasConflict
                      ? isConflictConfirmed
                        ? t('canteen.halfBoarders.import.classConflictConfirmedBadge', {
                            className: row.classConflict!.registeredClassName,
                          })
                        : t('canteen.halfBoarders.import.classConflictBadge')
                      : hasWarnings
                        ? t(`canteen.halfBoarders.import.${row.issues[0]?.key ?? 'warningLabel'}`)
                        : t('canteen.halfBoarders.import.updateLabel');
                return (
                  <li
                    key={row.rowNumber}
                    className={`flex items-center justify-between gap-2 rounded-lg p-2.5 text-sm ${bg}`}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`truncate font-medium ${isSkipped ? 'line-through text-neutral-500' : 'text-neutral-900'}`}>
                          {row.displayName || `#${row.rowNumber}`}
                        </span>
                        {row.input ? (
                          <span className="shrink-0 text-xs text-neutral-500">
                            · {t(`students.boarding.${row.input.boardingStatus}`)}
                          </span>
                        ) : null}
                      </div>
                      {hasConflict && row.classConflict ? (
                        <span className="text-xs font-medium text-warning-800">
                          {t('canteen.halfBoarders.import.classConflictArrow', {
                            fileClass: row.classConflict.fileClassName,
                            registeredClass: row.classConflict.registeredClassName,
                          })}
                        </span>
                      ) : null}
                    </div>
                    {hasConflict ? (
                      <button
                        type="button"
                        onClick={() => toggleConflictRow(row.rowNumber)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                          isConflictConfirmed
                            ? 'bg-success-600 text-white'
                            : 'bg-white text-warning-800 ring-1 ring-warning-400 hover:bg-warning-100'
                        }`}
                      >
                        {isConflictConfirmed ? <Check className="size-3.5" aria-hidden /> : null}
                        {isConflictConfirmed
                          ? label
                          : t('canteen.halfBoarders.import.confirmRowFix')}
                      </button>
                    ) : (
                      <span className={`shrink-0 text-xs font-medium ${textTone}`}>{label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button onClick={handleCommit} disabled={!canCommit}>
              {toExternalStudents.length > 0
                ? t('canteen.halfBoarders.import.commitSync', {
                    updated: validRows.length,
                    toExternal: toExternalStudents.length,
                  })
                : t('canteen.halfBoarders.import.commit', { count: validRows.length })}
            </Button>
            {errorRows.length > 0 ? (
              <Button variant="secondary" onClick={handleDownloadErrors} icon={<Download className="size-5" aria-hidden />}>
                {t('canteen.halfBoarders.import.downloadErrors')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setStep('pick')}>{t('common.back')}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'done' && result) {
    return (
      <Modal open={open} title={t('canteen.halfBoarders.importExcel')} onClose={close}>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-lg font-bold text-neutral-900">
            {t('canteen.halfBoarders.import.doneSummaryFull', {
              updated: result.updated,
              removed: result.removed,
              converted: result.convertedToExternal,
            })}
          </p>
          <Button onClick={onDone}>{t('common.close')}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} title={t('canteen.halfBoarders.importExcel')} onClose={close}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600">{t('canteen.halfBoarders.import.hint')}</p>
        {classes.length === 0 ? (
          <p className="rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-700">{t('canteen.halfBoarders.import.needClasses')}</p>
        ) : null}
        <Button variant="secondary" fullWidth onClick={() => {
          const lang = i18n.language.startsWith('ar') ? 'ar' : 'en';
          saveWorkbook(buildHalfBoarderTemplate(lang), 'half-boarders-template.xlsx');
        }} icon={<Download className="size-5" aria-hidden />}>
          {t('canteen.halfBoarders.import.downloadTemplate')}
        </Button>
        <label className="flex min-h-14 cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary-300 bg-primary-50/50 px-4 text-base font-medium text-primary-800 transition hover:bg-primary-50">
          <Upload className="size-5" aria-hidden />
          {reading ? t('canteen.halfBoarders.import.reading') : t('canteen.halfBoarders.import.chooseFile')}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.ods,.xlsm,.xlsb,.xml,.txt,.numbers"
            disabled={reading || classes.length === 0}
            className="sr-only"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void handleFile(selected);
              e.target.value = '';
            }}
          />
        </label>
        {error ? <FormError message={error} /> : null}
      </div>
    </Modal>
  );
}
