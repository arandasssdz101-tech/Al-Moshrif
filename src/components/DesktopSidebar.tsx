import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '@/components/AppLogo';
import type { TabItem } from '@/components/BottomTabs';

interface DesktopSidebarProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  institutionName: string;
  userName: string;
  roleLabel: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DesktopSidebar<T extends string>({
  items,
  active,
  onChange,
  institutionName,
  userName,
  roleLabel,
  collapsed,
  onToggleCollapse,
}: DesktopSidebarProps<T>) {
  const { t } = useTranslation();

  return (
    <aside
      aria-label={t('app.name')}
      className={`hidden shrink-0 flex-col border-e border-neutral-200/80 bg-white transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:h-screen ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div className={`flex items-center gap-3 border-b border-neutral-200/80 px-4 py-4 ${collapsed ? 'justify-center' : ''}`}>
        <AppLogo size="sm" />
        {collapsed ? null : (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-medium text-neutral-500">{t('app.name')}</span>
            <span className="truncate text-sm font-bold text-neutral-900">{institutionName}</span>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => {
            const Icon = item.icon;
            const isActive = item.id === active;
            const shortcut = index < 9 ? `Alt+${index + 1}` : null;
            const tooltip = shortcut ? `${item.label} (${shortcut})` : item.label;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onChange(item.id)}
                  title={collapsed ? tooltip : shortcut ?? undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition ${
                    collapsed ? 'justify-center px-0' : ''
                  } ${
                    isActive
                      ? 'bg-primary-50 font-semibold text-primary-700 ring-1 ring-inset ring-primary-200/70'
                      : 'font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                  }`}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  {collapsed ? null : (
                    <>
                      <span className="flex-1 truncate text-start">{item.label}</span>
                      {shortcut ? (
                        <kbd
                          dir="ltr"
                          className="hidden rounded border border-neutral-200/80 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-400 xl:inline-block"
                        >
                          {index + 1}
                        </kbd>
                      ) : null}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-2 border-t border-neutral-200/80 p-3">
        {collapsed ? null : (
          <div className="flex items-center gap-2.5 rounded-xl bg-neutral-50 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
              {userName.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-bold text-neutral-900">{userName}</span>
              <span className="truncate text-[11px] text-neutral-500">{roleLabel}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('pwa.expandSidebar') : t('pwa.collapseSidebar')}
          title={collapsed ? t('pwa.expandSidebar') : t('pwa.collapseSidebar')}
          className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
              <span className="truncate">{t('pwa.collapseSidebar')}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
