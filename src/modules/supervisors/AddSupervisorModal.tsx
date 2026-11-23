import { useEffect, useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FormError } from '@/components/ui/StatusBlock';
import { TextField } from '@/components/ui/TextField';
import type { User } from '@/db/types';
import {
  createSupervisor,
  validateNewSupervisorInput,
  type NewSupervisorValidationIssue,
} from '@/db/users';
import { errorKey } from '@/utils/errors';

interface AddSupervisorModalProps {
  open: boolean;
  institutionId: string;
  actorId: string;
  onClose: () => void;
  onCreated: (supervisor: User) => void;
}

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  show: boolean;
  onToggleShow: () => void;
  toggleLabel: string;
  error?: string | null;
  disabled?: boolean;
}

function PasswordInput({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  show,
  onToggleShow,
  toggleLabel,
  error,
  disabled,
}: PasswordInputProps) {
  const inputId = useId();
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-neutral-700">
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`min-h-12 w-full rounded-xl border bg-white py-2 ps-4 pe-12 text-base text-neutral-900 placeholder:text-neutral-400 transition focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/15 ${
            error ? 'border-danger-500' : 'border-neutral-300'
          }`}
        />
        <button
          type="button"
          onClick={onToggleShow}
          disabled={disabled}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="absolute end-1.5 flex size-9 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
        >
          {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AddSupervisorModal({
  open,
  institutionId,
  actorId,
  onClose,
  onCreated,
}: AddSupervisorModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<NewSupervisorValidationIssue | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setFieldError(null);
      setFormError(null);
      setSubmitting(false);
    }
  }, [open]);

  const clearFieldError = (field: NewSupervisorValidationIssue['field']) => {
    if (fieldError?.field === field) setFieldError(null);
    if (formError) setFormError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = validateNewSupervisorInput({ name, username, password, confirmPassword });
    if (issue) {
      setFieldError(issue);
      setFormError(null);
      return;
    }

    setFieldError(null);
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await createSupervisor(
        institutionId,
        { name, username, password, confirmPassword },
        actorId,
      );
      onCreated(created);
      onClose();
    } catch (error) {
      setFormError(t(errorKey(error)));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLabel = showPassword
    ? t('settings.account.hidePassword')
    : t('settings.account.showPassword');

  return (
    <Modal
      open={open}
      title={t('supervisors.addTitle')}
      description={t('supervisors.addSubtitle')}
      onClose={submitting ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={formError} />

        <TextField
          label={t('supervisors.fields.name')}
          placeholder={t('supervisors.fields.namePlaceholder')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            clearFieldError('name');
          }}
          error={fieldError?.field === 'name' ? t(fieldError.key) : null}
          autoComplete="name"
          disabled={submitting}
          required
        />

        <TextField
          label={t('supervisors.fields.username')}
          placeholder={t('supervisors.fields.usernamePlaceholder')}
          hint={t('supervisors.fields.usernameHint')}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            clearFieldError('username');
          }}
          error={fieldError?.field === 'username' ? t(fieldError.key) : null}
          dir="ltr"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={submitting}
          required
        />

        <PasswordInput
          label={t('supervisors.fields.password')}
          placeholder={t('supervisors.fields.passwordPlaceholder')}
          value={password}
          onChange={(value) => {
            setPassword(value);
            clearFieldError('password');
          }}
          show={showPassword}
          onToggleShow={() => setShowPassword((prev) => !prev)}
          toggleLabel={toggleLabel}
          autoComplete="new-password"
          error={fieldError?.field === 'password' ? t(fieldError.key) : null}
          disabled={submitting}
        />

        <PasswordInput
          label={t('supervisors.fields.confirmPassword')}
          placeholder={t('supervisors.fields.passwordPlaceholder')}
          value={confirmPassword}
          onChange={(value) => {
            setConfirmPassword(value);
            clearFieldError('confirmPassword');
          }}
          show={showPassword}
          onToggleShow={() => setShowPassword((prev) => !prev)}
          toggleLabel={toggleLabel}
          autoComplete="new-password"
          error={fieldError?.field === 'confirmPassword' ? t(fieldError.key) : null}
          disabled={submitting}
        />

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={submitting}
            icon={<UserPlus className="size-5" aria-hidden />}
          >
            {submitting ? t('common.loading') : t('supervisors.addSubmit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
