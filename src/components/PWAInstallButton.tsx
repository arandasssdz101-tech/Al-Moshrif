import { useState } from 'react';
import { Download, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { isNativeApp } from '@/utils/platform';

export function PWAInstallButton() {
  const { t } = useTranslation();
  const { isInstallable, isInstalled, isIOS, isDesktop, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isNativeApp || isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {isDesktop ? <Monitor className="size-3.5 shrink-0" aria-hidden /> : <Download className="size-3.5 shrink-0" aria-hidden />}
        <span>{isDesktop ? t('pwa.installDesktop') : t('pwa.install')}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Download className="size-3.5 shrink-0" aria-hidden />
          <span>{t('pwa.install')}</span>
        </button>

        <Modal open={showGuide} title={t('pwa.iosTitle')} onClose={() => setShowGuide(false)}>
          <div className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm text-neutral-700">
              <li>{t('pwa.iosStep1')}</li>
              <li>{t('pwa.iosStep2')}</li>
            </ol>
            <Button fullWidth variant="secondary" onClick={() => setShowGuide(false)}>
              {t('common.close')}
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  if (isDesktop) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Monitor className="size-3.5 shrink-0" aria-hidden />
          <span className="hidden sm:inline">{t('pwa.installDesktop')}</span>
        </button>

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
      </>
    );
  }

  return null;
}
