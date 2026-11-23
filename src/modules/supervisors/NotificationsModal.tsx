import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/db/supervisorBackup';
import type { AppNotification } from '@/db/types';
import { useSession } from '@/modules/auth/AuthContext';

interface NotificationsModalProps {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export function NotificationsModal({ open, onClose, onChanged }: NotificationsModalProps) {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    const rows = await listNotifications(institution.id);
    setItems(rows);
  }, [institution.id]);

  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, load]);

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id, user.id);
    await load();
    onChanged?.();
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead(institution.id, user.id);
    await load();
    onChanged?.();
  };

  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <Modal open={open} title={t('notifications.title')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {unreadCount > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-danger-700">
              {t('notifications.unreadCount', { count: unreadCount })}
            </span>
            <Button
              variant="ghost"
              onClick={handleMarkAllRead}
              icon={<CheckCheck className="size-4" aria-hidden />}
            >
              {t('notifications.markAllRead')}
            </Button>
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-neutral-500">
            <Bell className="size-8 opacity-40" aria-hidden />
            <p className="text-sm">{t('notifications.empty')}</p>
          </div>
        ) : (
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pe-1">
            {items.map((notif) => (
              <li
                key={notif.id}
                className={`flex flex-col gap-1.5 rounded-xl p-3 ring-1 ${
                  notif.kind === 'room_conflict' && !notif.resolved
                    ? 'bg-danger-50/50 ring-danger-200'
                    : notif.read
                      ? 'bg-neutral-50 ring-neutral-200'
                      : 'bg-primary-50/40 ring-primary-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-neutral-900">{notif.title}</span>
                  {notif.kind === 'room_conflict' ? (
                    <span
                      className={`text-xs font-semibold ${
                        notif.resolved ? 'text-success-700' : 'text-danger-700'
                      }`}
                    >
                      {notif.resolved ? t('notifications.resolved') : t('notifications.unresolved')}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-neutral-700">{notif.message}</p>
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-[11px] text-neutral-400">
                    {new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-DZ' : 'en-GB', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(notif.updatedAt))}
                  </span>
                  {!notif.read ? (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(notif.id)}
                      className="text-xs font-medium text-primary-700 underline hover:text-primary-800"
                    >
                      {t('notifications.markRead')}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
