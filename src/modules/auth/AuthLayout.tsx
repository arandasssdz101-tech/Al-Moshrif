import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/AppLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { ThemeToggle } from '@/components/ThemeToggle';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  onBack?: () => void;
  children: ReactNode;
}

export function AuthLayout({ title, subtitle, onBack, children }: AuthLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="safe-pt safe-pb flex min-h-dvh flex-col bg-neutral-50">
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-6 pb-2 pt-6 lg:max-w-5xl lg:px-8">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-11 items-center gap-1 rounded-full pe-4 text-base font-medium text-neutral-700 transition hover:text-neutral-900"
          >
            <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden />
            {t('common.back')}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <PWAInstallButton />
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 items-start gap-8 px-6 pb-10 pt-6 animate-fade-up lg:max-w-5xl lg:grid-cols-[0.95fr_1fr] lg:items-center lg:gap-12 lg:px-8">
        <div className="flex flex-col items-start gap-4">
          <AppLogo size="lg" />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl text-neutral-900 text-balance lg:text-4xl">{title}</h1>
            <p className="text-base text-neutral-600">{subtitle}</p>
          </div>
        </div>
        <div className="w-full rounded-2xl lg:bg-white lg:p-8 lg:shadow-sm lg:ring-1 lg:ring-neutral-200">
          {children}
        </div>
      </main>
    </div>
  );
}
