import { useState } from 'react';
import { CheckCircle2, Keyboard, Monitor, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { isNativeApp } from '@/utils/platform';

export function DesktopWebCard() {
  const { t } = useTranslation();
  const { isInstallable, isInstalled, isDesktop, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isNativeApp || !isDesktop) return null;

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary-50 text-secondary-700">
            <Monitor className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-bold text-neutral-900">{t('pwa.desktopCardTitle')}</h2>
            <p className="text-sm text-neutral-600">{t('pwa.desktopCardSubtitle')}</p>
          </div>
        </div>
        {isInstalled ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t('pwa.installedDesktop')}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-neutral-700">
            <Keyboard className="size-4 text-neutral-500" aria-hidden />
            {t('pwa.desktopShortcutSearch')}
          </span>
          <kbd className="rounded-lg border border-neutral-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-neutral-700" dir="ltr">
            Ctrl + K
          </kbd>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-neutral-700">
            <Printer className="size-4 text-neutral-500" aria-hidden />
            {t('pwa.desktopShortcutPrint')}
          </span>
          <kbd className="rounded-lg border border-neutral-300 bg-white px-2 py-0.5 font-mono text-xs font-semibold text-neutral-700" dir="ltr">
            Ctrl + P
          </kbd>
        </div>
      </div>

      {!isInstalled ? (
        <div>
          <Button
            variant={isInstallable ? 'primary' : 'secondary'}
            onClick={() => {
              if (isInstallable) {
                void install();
              } else {
                setShowGuide(true);
              }
            }}
            icon={<Monitor className="size-4" aria-hidden />}
          >
            {t('pwa.installDesktop')}
          </Button>
        </div>
      ) : null}

      <Modal
        open={showGuide}
        title={t('pwa.desktopTitle')}
        description={t('pwa.desktopSubtitle')}
        onClose={() => setShowGuide(false)}
      >
        <div className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-2.5 ps-5 text-sm leading-relaxed text-neutral-700">
            <li>{t('pwa.desktopStep1')}</li>
            <li>{t('pwa.desktopStep2')}</li>
            <li>{t('pwa.desktopStep3')}</li>
          </ol>
          <Button fullWidth variant="secondary" onClick={() => setShowGuide(false)}>
            {t('common.close')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
