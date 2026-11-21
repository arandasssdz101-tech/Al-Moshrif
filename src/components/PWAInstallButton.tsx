import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { usePWAInstall } from '@/hooks/usePWAInstall';

export function PWAInstallButton() {
  const { t } = useTranslation();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        <Download className="size-3.5 shrink-0" aria-hidden />
        <span>{t('pwa.install')}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <Download className="size-3.5 shrink-0" aria-hidden />
          <span>{t('pwa.install')}</span>
        </button>

        <Modal open={showIOSGuide} title={t('pwa.iosTitle')} onClose={() => setShowIOSGuide(false)}>
          <div className="flex flex-col gap-4">
            <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm text-neutral-700">
              <li>{t('pwa.iosStep1')}</li>
              <li>{t('pwa.iosStep2')}</li>
            </ol>
            <Button fullWidth variant="secondary" onClick={() => setShowIOSGuide(false)}>
              {t('common.close')}
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  return null;
}
