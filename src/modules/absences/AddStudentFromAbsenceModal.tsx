import { useEffect, useState, type FormEvent } from 'react';
import { UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import { TextField } from '@/components/ui/TextField';
import { createStudent } from '@/db/students';
import { prepareStudentInput, TEXT_MAX_LENGTH, validateStudentInput } from '@/db/studentRules';
import {
  BOARDING_STATUSES,
  GENDERS,
  type BoardingStatus,
  type Gender,
  type SchoolClass,
  type Student,
  type StudentInput,
} from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';
import { errorKey } from '@/utils/errors';

type FieldErrors = Partial<Record<keyof StudentInput, string>>;

interface DraftState {
  firstName: string;
  lastName: string;
  gender: Gender | '';
  dateOfBirth: string;
  placeOfBirth: string;
  repeater: 'yes' | 'no';
  boardingStatus: BoardingStatus;
  classId: string;
  cardCode: string;
}

function makeInitialDraft(classes: SchoolClass[], defaultClassId: string | null): DraftState {
  const initialClassId =
    defaultClassId && classes.some((item) => item.id === defaultClassId)
      ? defaultClassId
      : (classes[0]?.id ?? '');
  return {
    firstName: '',
    lastName: '',
    gender: '',
    dateOfBirth: '',
    placeOfBirth: '',
    repeater: 'no',
    boardingStatus: 'external',
    classId: initialClassId,
    cardCode: '',
  };
}

export interface AddStudentFromAbsenceModalProps {
  open: boolean;
  classes: SchoolClass[];
  defaultClassId: string | null;
  onClose: () => void;
  onAdded: (student: Student) => void;
}

export function AddStudentFromAbsenceModal({
  open,
  classes,
  defaultClassId,
  onClose,
  onAdded,
}: AddStudentFromAbsenceModalProps) {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const [draft, setDraft] = useState<DraftState>(() => makeInitialDraft(classes, defaultClassId));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(makeInitialDraft(classes, defaultClassId));
    setFieldErrors({});
    setFormError(null);
    setSubmitting(false);
  }, [open, classes, defaultClassId]);

  const update = (patch: Partial<DraftState>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setFieldErrors({});
    setFormError(null);
  };

  const fieldError = (field: keyof StudentInput) => fieldErrors[field] ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const input: StudentInput = {
      firstName: draft.firstName,
      lastName: draft.lastName,
      gender: draft.gender as Gender,
      dateOfBirth: draft.dateOfBirth || null,
      placeOfBirth: draft.placeOfBirth,
      repeater: draft.repeater === 'yes',
      boardingStatus: draft.boardingStatus,
      classId: draft.classId,
      joinDate: null,
      leaveDate: null,
      cardCode: draft.cardCode.trim() || null,
    };

    const issues = validateStudentInput(input);
    if (issues.length > 0) {
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, t(issue.key)])));
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const prepared = prepareStudentInput(input);
      const created = await createStudent(institution.id, prepared, user.id);
      onAdded(created);
      onClose();
    } catch (cause) {
      setFormError(t(errorKey(cause)));
      setSubmitting(false);
    }
  };

  const genderOptions = GENDERS.map((value) => ({ value, label: t(`students.gender.${value}`) }));
  const boardingOptions = BOARDING_STATUSES.map((value) => ({ value, label: t(`students.boarding.${value}`) }));
  const repeaterOptions: { value: 'yes' | 'no'; label: string }[] = [
    { value: 'no', label: t('common.no') },
    { value: 'yes', label: t('common.yes') },
  ];

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={t('absences.addStudentTitle')}
      description={t('absences.addStudentSubtitle')}
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label={t('students.fields.lastName')}
            maxLength={TEXT_MAX_LENGTH}
            autoComplete="off"
            value={draft.lastName}
            error={fieldError('lastName')}
            onChange={(event) => update({ lastName: event.target.value })}
            disabled={submitting}
          />
          <TextField
            label={t('students.fields.firstName')}
            maxLength={TEXT_MAX_LENGTH}
            autoComplete="off"
            value={draft.firstName}
            error={fieldError('firstName')}
            onChange={(event) => update({ firstName: event.target.value })}
            disabled={submitting}
          />
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-neutral-700">{t('students.fields.className')}</span>
          <select
            value={draft.classId}
            onChange={(event) => update({ classId: event.target.value })}
            aria-invalid={fieldError('classId') ? true : undefined}
            disabled={submitting}
            className="min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            <option value="">{t('students.form.choosePlaceholder')}</option>
            {classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>
                {schoolClass.name}
              </option>
            ))}
          </select>
          {fieldError('classId') ? <span className="text-sm text-danger-700">{fieldError('classId')}</span> : null}
        </label>

        <ChoiceGroup<Gender | ''>
          legend={t('students.fields.gender')}
          name="absence-quick-student-gender"
          value={draft.gender}
          options={genderOptions}
          error={fieldError('gender')}
          onChange={(gender) => update({ gender })}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label={t('students.fields.dateOfBirth')}
            type="date"
            value={draft.dateOfBirth}
            error={fieldError('dateOfBirth')}
            onChange={(event) => update({ dateOfBirth: event.target.value })}
            disabled={submitting}
          />
          <TextField
            label={t('students.fields.placeOfBirth')}
            maxLength={TEXT_MAX_LENGTH}
            value={draft.placeOfBirth}
            error={fieldError('placeOfBirth')}
            onChange={(event) => update({ placeOfBirth: event.target.value })}
            disabled={submitting}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChoiceGroup
            legend={t('students.fields.boardingStatus')}
            name="absence-quick-student-boarding"
            value={draft.boardingStatus}
            options={boardingOptions}
            onChange={(boardingStatus) => update({ boardingStatus })}
          />
          <ChoiceGroup<'yes' | 'no'>
            legend={t('students.fields.repeater')}
            name="absence-quick-student-repeater"
            value={draft.repeater}
            options={repeaterOptions}
            onChange={(repeater) => update({ repeater })}
          />
        </div>

        <TextField
          label={t('students.cardCode.label')}
          hint={t('students.cardCode.hint')}
          maxLength={TEXT_MAX_LENGTH}
          autoComplete="off"
          value={draft.cardCode}
          error={fieldError('cardCode')}
          onChange={(event) => update({ cardCode: event.target.value })}
          disabled={submitting}
        />

        <FormError message={formError} />

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            icon={<UserPlus className="size-4" aria-hidden />}
          >
            {submitting ? t('common.loading') : t('absences.addStudentButton')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
