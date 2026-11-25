import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { isNativeApp } from '@/utils/platform';

export function OfflineIndicator() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  if (isNativeApp || isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-20 start-4 z-40 flex items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-2 text-xs font-semibold text-warning-800 shadow-md lg:bottom-4"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>{t('pwa.offlineBanner')}</span>
    </div>
  );
}
