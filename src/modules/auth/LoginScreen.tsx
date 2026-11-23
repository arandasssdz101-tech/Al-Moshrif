import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { CheckCircle2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { signInWithCredentials } from '@/db/auth';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/StatusBlock';
import { TextField } from '@/components/ui/TextField';
import { errorKey } from '@/utils/errors';
import { requiredKey } from '@/utils/validation';
import { useAuth } from './AuthContext';
import { AuthLayout } from './AuthLayout';
import { RestoreBackupModal } from './RestoreBackupModal';
import { useAuthBackupRestore } from './useAuthBackupRestore';

interface LoginForm {
  identifier: string;
  password: string;
}

type FormErrors = Partial<Record<keyof LoginForm, string>>;

interface LoginScreenProps {
  onBack: () => void;
  restoredBanner?: boolean;
}

export function LoginScreen({ onBack, restoredBanner = false }: LoginScreenProps) {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [form, setForm] = useState<LoginForm>({ identifier: '', password: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justRestored, setJustRestored] = useState(false);

  const handleRestored = useCallback(() => {
    setFormError(null);
    setJustRestored(true);
  }, []);

  const backup = useAuthBackupRestore(handleRestored);

  const setField = (field: keyof LoginForm) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FormErrors = {};
    const identifierError = requiredKey(form.identifier);
    const passwordError = requiredKey(form.password);
    if (identifierError) nextErrors.identifier = t(identifierError);
    if (passwordError) nextErrors.password = t(passwordError);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const user = await signInWithCredentials(form.identifier, form.password);
      await signIn(user.id);
    } catch (error) {
      setFormError(t(errorKey(error)));
      setSubmitting(false);
    }
  };

  const showRestoredBanner = restoredBanner || justRestored;

  return (
    <AuthLayout title={t('auth.loginTitle')} subtitle={t('auth.loginSubtitle')} onBack={onBack}>
      <div className="flex flex-col gap-6">
        {showRestoredBanner ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl bg-success-50 p-4 text-sm text-success-700 animate-fade-in"
          >
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p>{t('auth.backup.restoredSuccess')}</p>
          </div>
        ) : null}

        <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
          <TextField
            label={t('auth.identifier')}
            value={form.identifier}
            onChange={setField('identifier')}
            error={errors.identifier}
            autoComplete="username"
          />
          <TextField
            label={t('auth.password')}
            type="password"
            value={form.password}
            onChange={setField('password')}
            error={errors.password}
            autoComplete="current-password"
          />
          <FormError message={formError} />
          <Button type="submit" fullWidth disabled={submitting} className="mt-2">
            {t('auth.loginAction')}
          </Button>
        </form>

        <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-bold text-neutral-900">{t('auth.backup.sectionTitle')}</h2>
            <p className="text-sm text-neutral-600">{t('auth.backup.sectionHint')}</p>
          </div>
          <label className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-neutral-50 px-5 text-base font-medium text-neutral-800 ring-1 ring-inset ring-neutral-300 transition hover:bg-neutral-100 focus-within:ring-2 focus-within:ring-primary-500 active:scale-[0.98]">
            <Upload className="size-5 text-primary-600" aria-hidden />
            {t('auth.backup.chooseFile')}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={backup.handleFileChange}
            />
          </label>
          <FormError message={backup.error} />
        </section>
      </div>

      <RestoreBackupModal
        open={backup.pendingRestore !== null}
        summary={backup.summary}
        willOverwrite={backup.willOverwrite}
        restoring={backup.restoring}
        onConfirm={backup.handleConfirmRestore}
        onCancel={backup.cancelRestore}
      />
    </AuthLayout>
  );
}
