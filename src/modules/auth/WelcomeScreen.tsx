import type { ReactNode } from 'react';
import { ChevronRight, Database, FileSpreadsheet, KeyRound, Monitor, Printer, Upload, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/AppLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FormError } from '@/components/ui/StatusBlock';
import { RestoreBackupModal } from './RestoreBackupModal';
import { useAuthBackupRestore } from './useAuthBackupRestore';

interface WelcomeScreenProps {
  onCreate: () => void;
  onJoin: () => void;
  onLogin: () => void;
  onRestored: () => void;
}

export function WelcomeScreen({ onCreate, onJoin, onLogin, onRestored }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const backup = useAuthBackupRestore(onRestored);

  const desktopFeatures = [
    { icon: Database, text: t('pwa.desktopFeatureOffline') },
    { icon: Printer, text: t('pwa.desktopFeaturePrint') },
    { icon: FileSpreadsheet, text: t('pwa.desktopFeatureExcel') },
    { icon: Monitor, text: t('pwa.desktopFeatureShortcuts') },
  ];

  return (
    <div className="safe-pt safe-pb flex min-h-dvh flex-col bg-neutral-50">
      <header className="mx-auto flex w-full max-w-md items-center justify-end gap-2 px-6 pt-6 lg:max-w-5xl lg:px-8">
        <PWAInstallButton />
        <ThemeToggle />
        <LanguageToggle />
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 items-center gap-10 px-6 pb-10 pt-6 animate-fade-up lg:max-w-5xl lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:px-8">
        <div className="flex flex-col items-start gap-5">
          <AppLogo size="lg" />
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl text-neutral-900 text-balance lg:text-5xl">{t('auth.welcomeTitle')}</h1>
            <p className="text-lg text-neutral-600">{t('auth.welcomeSubtitle')}</p>
          </div>
          <ul className="hidden w-full divide-y divide-neutral-200/80 border-t border-neutral-200/80 pt-2 lg:block">
            {desktopFeatures.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 py-3 text-sm text-neutral-700">
                <Icon className="size-4 shrink-0 text-primary-600" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <ChoiceCard
              icon={<UserPlus className="size-6" aria-hidden />}
              title={t('auth.createCard')}
              hint={t('auth.createCardHint')}
              onClick={onCreate}
              tone="primary"
            />
            <ChoiceCard
              icon={<KeyRound className="size-6" aria-hidden />}
              title={t('auth.joinCard')}
              hint={t('auth.joinCardHint')}
              onClick={onJoin}
              tone="secondary"
            />
            <label className="group flex min-h-20 w-full cursor-pointer items-center gap-4 rounded-2xl bg-white p-5 text-start shadow-sm ring-1 ring-neutral-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-within:ring-2 focus-within:ring-primary-500 active:scale-[0.99]">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Upload className="size-6" aria-hidden />
              </span>
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-lg font-bold text-neutral-900">{t('auth.backup.cardTitle')}</span>
                <span className="text-sm text-neutral-600">{t('auth.backup.cardHint')}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={backup.handleFileChange}
              />
            </label>
            <FormError message={backup.error} />
          </div>

          <button
            type="button"
            onClick={onLogin}
            className="min-h-12 text-center text-base font-medium text-primary-700 underline-offset-4 transition hover:underline"
          >
            {t('auth.loginLink')}
          </button>
        </div>
      </main>

      <RestoreBackupModal
        open={backup.pendingRestore !== null}
        summary={backup.summary}
        willOverwrite={backup.willOverwrite}
        restoring={backup.restoring}
        onConfirm={backup.handleConfirmRestore}
        onCancel={backup.cancelRestore}
      />
    </div>
  );
}

interface ChoiceCardProps {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  tone: 'primary' | 'secondary';
}

function ChoiceCard({ icon, title, hint, onClick, tone }: ChoiceCardProps) {
  const tileClasses = tone === 'primary' ? 'bg-primary-600 text-white' : 'bg-secondary-100 text-secondary-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-20 w-full items-center gap-4 rounded-2xl bg-white p-5 text-start shadow-sm ring-1 ring-neutral-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
    >
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tileClasses}`}>{icon}</span>
      <span className="flex flex-1 flex-col gap-1">
        <span className="text-lg font-bold text-neutral-900">{title}</span>
        <span className="text-sm text-neutral-600">{hint}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-neutral-400 transition group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
    </button>
  );
}
