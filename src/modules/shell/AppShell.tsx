import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Bell, ChartBar as BarChart3, BookOpen, CalendarDays, ClipboardList, DoorOpen, GraduationCap, Home, LayoutDashboard, QrCode, Search, Settings, Users, Utensils } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/AppLogo';
import { BottomTabs, type TabItem } from '@/components/BottomTabs';
import { LanguageToggle } from '@/components/LanguageToggle';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LoadingState } from '@/components/ui/StatusBlock';
import { countUnreadNotifications } from '@/db/supervisorBackup';
import { AbsencesScreen } from '@/modules/absences/AbsencesScreen';
import { useSession } from '@/modules/auth/AuthContext';
import { StudentCardsScreen } from '@/modules/cards/StudentCardsScreen';
import { HomeScreen } from '@/modules/home/HomeScreen';
import { SettingsScreen } from '@/modules/settings/SettingsScreen';
import { StatisticsScreen } from '@/modules/statistics/StatisticsScreen';
import { StudentsScreen } from '@/modules/students/StudentsScreen';
import { NotificationsModal } from '@/modules/supervisors/NotificationsModal';
import { SupervisorsScreen } from '@/modules/supervisors/SupervisorsScreen';
import { TimetableScreen } from '@/modules/timetable/TimetableScreen';
import { SearchScreen } from '@/modules/search/SearchScreen';
import { CanteenScreen } from '@/modules/canteen/CanteenScreen';
import { EntryScreen } from '@/modules/entry/EntryScreen';
import { LibraryScreen } from '@/modules/library/LibraryScreen';
import { registerAndroidBackHandler } from '@/utils/androidBack';

const AbsenceDashboardScreen = lazy(() =>
  import('@/modules/dashboard/AbsenceDashboardScreen').then((module) => ({
    default: module.AbsenceDashboardScreen,
  })),
);

export type TabId = 'home' | 'dashboard' | 'students' | 'cards' | 'timetable' | 'absences' | 'entry' | 'canteen' | 'statistics' | 'library' | 'supervisors' | 'settings' | 'search';

export function AppShell() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const [tab, setTab] = useState<TabId>('home');
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const isHead = user.role === 'head';
  const hasCanteen = isHead || user.permissions !== null;
  const hasEntry = isHead || user.permissions !== null;

  const refreshUnread = useCallback(async () => {
    try {
      const count = await countUnreadNotifications(institution.id);
      setUnreadNotifications(count);
    } catch {
      // ignore transient read errors
    }
  }, [institution.id]);

  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread, tab]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (notifOpen) {
        setNotifOpen(false);
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
  }, [notifOpen, tab]);

  const tabs: TabItem<TabId>[] = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard },
    { id: 'students', label: t('nav.students'), icon: GraduationCap },
    { id: 'cards', label: t('nav.cards'), icon: QrCode },
    { id: 'timetable', label: t('nav.timetable'), icon: CalendarDays },
    { id: 'absences', label: t('nav.absences'), icon: ClipboardList },
    ...(hasEntry ? [{ id: 'entry' as const, label: t('nav.entry'), icon: DoorOpen }] : []),
    ...(hasCanteen ? [{ id: 'canteen' as const, label: t('nav.canteen'), icon: Utensils }] : []),
    { id: 'statistics', label: t('nav.statistics'), icon: BarChart3 },
    { id: 'library', label: t('nav.library'), icon: BookOpen },
    { id: 'search', label: t('nav.search'), icon: Search },
    ...(isHead ? [{ id: 'supervisors' as const, label: t('nav.supervisors'), icon: Users }] : []),
    { id: 'settings', label: t('nav.settings'), icon: Settings },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="safe-pt safe-px sticky top-0 z-20 border-b border-neutral-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <AppLogo size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className="text-xs text-neutral-500">{t('app.name')}</span>
              <span className="truncate text-base font-bold text-neutral-900">{institution.name}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setNotifOpen(true)}
              aria-label={t('notifications.openAria')}
              className="relative inline-flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200/80 active:scale-[0.97]"
            >
              <Bell className="size-5" aria-hidden />
              {unreadNotifications > 0 ? (
                <span className="absolute -end-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-danger-600 px-1 text-[11px] font-bold leading-5 text-white">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              ) : null}
            </button>
            <PWAInstallButton />
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main key={tab} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-6 animate-fade-up">
        {tab === 'home' ? <HomeScreen onNavigate={setTab} hasCanteen={hasCanteen} /> : null}
        {tab === 'dashboard' ? (
          <Suspense fallback={<LoadingState />}>
            <AbsenceDashboardScreen onNavigate={setTab} />
          </Suspense>
        ) : null}
        {tab === 'students' ? <StudentsScreen onOpenCards={() => setTab('cards')} /> : null}
        {tab === 'cards' ? <StudentCardsScreen /> : null}
        {tab === 'timetable' ? <TimetableScreen /> : null}
        {tab === 'absences' ? <AbsencesScreen /> : null}
        {tab === 'entry' && hasEntry ? <EntryScreen /> : null}
        {tab === 'canteen' && hasCanteen ? <CanteenScreen /> : null}
        {tab === 'statistics' ? <StatisticsScreen /> : null}
        {tab === 'library' ? <LibraryScreen /> : null}
        {tab === 'search' ? <SearchScreen /> : null}
        {tab === 'supervisors' && isHead ? <SupervisorsScreen /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </main>

      <BottomTabs items={tabs} active={tab} onChange={setTab} />
      <NotificationsModal
        open={notifOpen}
        onClose={() => {
          setNotifOpen(false);
          void refreshUnread();
        }}
        onChanged={() => {
          void refreshUnread();
        }}
      />
    </div>
  );
}
