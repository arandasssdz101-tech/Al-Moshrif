import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type {
  ClassAbsencePoint,
  MonthlyAbsencePoint,
  WeeklyAbsencePoint,
} from '@/utils/absenceDashboard';

export type DashboardMetricMode = 'rate' | 'split';

interface WeeklyChartProps {
  data: WeeklyAbsencePoint[];
  averageRate: number | null;
  metricMode: DashboardMetricMode;
  useHoursFallback: boolean;
  range: 8 | 12;
  onRangeChange: (range: 8 | 12) => void;
}

interface MonthlyChartProps {
  data: MonthlyAbsencePoint[];
  averageRate: number | null;
  metricMode: DashboardMetricMode;
  useHoursFallback: boolean;
  range: 6 | 12;
  onRangeChange: (range: 6 | 12) => void;
}

interface ClassComparisonChartProps {
  data: ClassAbsencePoint[];
  useHoursFallback: boolean;
}

const COLOR_PRIMARY = 'rgb(var(--color-primary-600))';
const COLOR_PRIMARY_SOFT = 'rgb(var(--color-primary-400))';
const COLOR_DANGER = 'rgb(var(--color-danger-500))';
const COLOR_WARNING = 'rgb(var(--color-warning-500))';
const COLOR_SECONDARY = 'rgb(var(--color-secondary-500))';
const COLOR_GRID = 'rgb(var(--color-neutral-200))';
const COLOR_AXIS = 'rgb(var(--color-neutral-500))';

function formatShortDayMonth(isoDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function formatMonthTick(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function formatMonthFull(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

export function WeeklyAbsenceChart({
  data,
  averageRate,
  metricMode,
  useHoursFallback,
  range,
  onRangeChange,
}: WeeklyChartProps) {
  const { t, i18n } = useTranslation();
  const gradientId = useId().replace(/:/g, '');

  const chartData = data.map((point) => ({
    ...point,
    tickLabel: formatShortDayMonth(point.startDate, i18n.language),
    fullRange: `${formatShortDayMonth(point.startDate, i18n.language)} – ${formatShortDayMonth(point.endDate, i18n.language)}`,
    displayRate: point.rate ?? 0,
    displayJustified: useHoursFallback ? point.justifiedHours : (point.justifiedRate ?? 0),
    displayUnjustified: useHoursFallback ? point.unjustifiedHours : (point.unjustifiedRate ?? 0),
    displayTotal: useHoursFallback ? point.absentHours : (point.rate ?? 0),
  }));

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-neutral-900">
            {t('dashboard.weeklyChartTitle')}
          </h2>
          <p className="text-xs text-neutral-500">
            {useHoursFallback
              ? t('dashboard.weeklyChartHoursSubtitle')
              : t('dashboard.weeklyChartSubtitle')}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-50 p-0.5">
          {([8, 12] as const).map((weeks) => (
            <button
              key={weeks}
              type="button"
              onClick={() => onRangeChange(weeks)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                range === weeks
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t('dashboard.weeksOption', { count: weeks })}
            </button>
          ))}
        </div>
      </div>

      <ChartLegend
        items={
          metricMode === 'split'
            ? [
                { label: t('dashboard.unjustified'), color: COLOR_DANGER },
                { label: t('dashboard.justified'), color: COLOR_SECONDARY },
              ]
            : [
                {
                  label: useHoursFallback
                    ? t('dashboard.absentHoursLabel')
                    : t('dashboard.absenceRateLabel'),
                  color: COLOR_PRIMARY,
                },
                ...(!useHoursFallback && averageRate !== null
                  ? [
                      {
                        label: `${t('dashboard.averageLabel')} (${formatPercent(averageRate)})`,
                        color: COLOR_WARNING,
                        dashed: true,
                      },
                    ]
                  : []),
              ]
        }
      />

      <div className="h-72 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          {metricMode === 'split' ? (
            <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`${gradientId}-unjust`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_DANGER} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={COLOR_DANGER} stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id={`${gradientId}-just`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_SECONDARY} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={COLOR_SECONDARY} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
              <XAxis
                dataKey="tickLabel"
                tick={{ fill: COLOR_AXIS, fontSize: 11 }}
                axisLine={{ stroke: COLOR_GRID }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: COLOR_AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={42}
                tickFormatter={(val: number) => (useHoursFallback ? `${val}` : `${val}%`)}
              />
              <Tooltip
                content={(props) => (
                  <PeriodTooltip
                    active={props.active}
                    payload={props.payload as unknown as readonly TooltipEntry[] | undefined}
                    dir={i18n.dir()}
                    useHoursFallback={useHoursFallback}
                    kind="weekly"
                  />
                )}
              />
              <Area
                type="monotone"
                dataKey="displayUnjustified"
                stackId="1"
                stroke={COLOR_DANGER}
                strokeWidth={2}
                fill={`url(#${gradientId}-unjust)`}
                dot={{ r: 3, fill: COLOR_DANGER, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Area
                type="monotone"
                dataKey="displayJustified"
                stackId="1"
                stroke={COLOR_SECONDARY}
                strokeWidth={2}
                fill={`url(#${gradientId}-just)`}
                dot={{ r: 3, fill: COLOR_SECONDARY, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          ) : (
            <AreaChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`${gradientId}-total`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLOR_PRIMARY} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={COLOR_PRIMARY_SOFT} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
              <XAxis
                dataKey="tickLabel"
                tick={{ fill: COLOR_AXIS, fontSize: 11 }}
                axisLine={{ stroke: COLOR_GRID }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: COLOR_AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={42}
                tickFormatter={(val: number) => (useHoursFallback ? `${val}` : `${val}%`)}
              />
              <Tooltip
                content={(props) => (
                  <PeriodTooltip
                    active={props.active}
                    payload={props.payload as unknown as readonly TooltipEntry[] | undefined}
                    dir={i18n.dir()}
                    useHoursFallback={useHoursFallback}
                    kind="weekly"
                  />
                )}
              />
              {!useHoursFallback && averageRate !== null ? (
                <ReferenceLine
                  y={averageRate}
                  stroke={COLOR_WARNING}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              ) : null}
              <Area
                type="monotone"
                dataKey="displayTotal"
                stroke={COLOR_PRIMARY}
                strokeWidth={2.5}
                fill={`url(#${gradientId}-total)`}
                dot={{ r: 3.5, fill: COLOR_PRIMARY, strokeWidth: 0 }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: 'rgb(var(--color-surface))' }}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function MonthlyAbsenceChart({
  data,
  averageRate,
  metricMode,
  useHoursFallback,
  range,
  onRangeChange,
}: MonthlyChartProps) {
  const { t, i18n } = useTranslation();

  const chartData = data.map((point) => ({
    ...point,
    tickLabel: formatMonthTick(point.month, i18n.language),
    fullRange: formatMonthFull(point.month, i18n.language),
    displayTotal: useHoursFallback ? point.absentHours : (point.rate ?? 0),
    displayJustified: useHoursFallback ? point.justifiedHours : (point.justifiedRate ?? 0),
    displayUnjustified: useHoursFallback ? point.unjustifiedHours : (point.unjustifiedRate ?? 0),
  }));

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-neutral-900">
            {t('dashboard.monthlyChartTitle')}
          </h2>
          <p className="text-xs text-neutral-500">
            {useHoursFallback
              ? t('dashboard.monthlyChartHoursSubtitle')
              : t('dashboard.monthlyChartSubtitle')}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-neutral-200 bg-neutral-50 p-0.5">
          {([6, 12] as const).map((months) => (
            <button
              key={months}
              type="button"
              onClick={() => onRangeChange(months)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition ${
                range === months
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t('dashboard.monthsOption', { count: months })}
            </button>
          ))}
        </div>
      </div>

      <ChartLegend
        items={
          metricMode === 'split'
            ? [
                { label: t('dashboard.unjustified'), color: COLOR_DANGER },
                { label: t('dashboard.justified'), color: COLOR_SECONDARY },
                { label: t('dashboard.trendLine'), color: COLOR_PRIMARY },
              ]
            : [
                {
                  label: useHoursFallback
                    ? t('dashboard.absentHoursLabel')
                    : t('dashboard.absenceRateLabel'),
                  color: COLOR_PRIMARY,
                },
                ...(!useHoursFallback && averageRate !== null
                  ? [
                      {
                        label: `${t('dashboard.averageLabel')} (${formatPercent(averageRate)})`,
                        color: COLOR_WARNING,
                        dashed: true,
                      },
                    ]
                  : []),
              ]
        }
      />

      <div className="h-72 w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
            <XAxis
              dataKey="tickLabel"
              tick={{ fill: COLOR_AXIS, fontSize: 11 }}
              axisLine={{ stroke: COLOR_GRID }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: COLOR_AXIS, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={42}
              tickFormatter={(val: number) => (useHoursFallback ? `${val}` : `${val}%`)}
            />
            <Tooltip
              cursor={{ fill: 'rgb(var(--color-neutral-100) / 0.6)' }}
              content={(props) => (
                <PeriodTooltip
                  active={props.active}
                  payload={props.payload as unknown as readonly TooltipEntry[] | undefined}
                  dir={i18n.dir()}
                  useHoursFallback={useHoursFallback}
                  kind="monthly"
                />
              )}
            />
            {!useHoursFallback && averageRate !== null && metricMode === 'rate' ? (
              <ReferenceLine
                y={averageRate}
                stroke={COLOR_WARNING}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
            ) : null}

            {metricMode === 'split' ? (
              <>
                <Bar
                  dataKey="displayUnjustified"
                  stackId="monthly"
                  fill={COLOR_DANGER}
                  radius={[0, 0, 4, 4]}
                  maxBarSize={36}
                />
                <Bar
                  dataKey="displayJustified"
                  stackId="monthly"
                  fill={COLOR_SECONDARY}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={36}
                />
                <Line
                  type="monotone"
                  dataKey="displayTotal"
                  stroke={COLOR_PRIMARY}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COLOR_PRIMARY, strokeWidth: 0 }}
                />
              </>
            ) : (
              <>
                <Bar
                  dataKey="displayTotal"
                  fill={COLOR_PRIMARY}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={38}
                >
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={entry.isCurrent ? COLOR_PRIMARY : COLOR_PRIMARY_SOFT}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="displayTotal"
                  stroke={COLOR_PRIMARY}
                  strokeWidth={2}
                  dot={{ r: 3.5, fill: COLOR_PRIMARY, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ClassAbsenceComparisonChart({
  data,
  useHoursFallback,
}: ClassComparisonChartProps) {
  const { t, i18n } = useTranslation();
  const topClasses = data.slice(0, 12);
  const chartHeight = Math.max(220, topClasses.length * 36 + 32);

  const chartData = topClasses.map((row) => ({
    ...row,
    displayValue: useHoursFallback ? row.absentHours : (row.rate ?? 0),
  }));

  const barColorFor = (row: ClassAbsencePoint): string => {
    if (useHoursFallback || row.rate === null) return COLOR_PRIMARY;
    if (row.rate >= 10) return COLOR_DANGER;
    if (row.rate >= 5) return COLOR_WARNING;
    return COLOR_PRIMARY;
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-900">
          {t('dashboard.classChartTitle')}
        </h2>
        <p className="text-xs text-neutral-500">
          {useHoursFallback
            ? t('dashboard.classChartHoursSubtitle')
            : t('dashboard.classChartSubtitle')}
        </p>
      </div>

      {!useHoursFallback ? (
        <ChartLegend
          items={[
            { label: t('dashboard.severityNormal'), color: COLOR_PRIMARY },
            { label: t('dashboard.severityElevated'), color: COLOR_WARNING },
            { label: t('dashboard.severityHigh'), color: COLOR_DANGER },
          ]}
        />
      ) : null}

      <div className="w-full" style={{ height: chartHeight }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: COLOR_AXIS, fontSize: 11 }}
              axisLine={{ stroke: COLOR_GRID }}
              tickLine={false}
              tickFormatter={(val: number) => (useHoursFallback ? `${val}` : `${val}%`)}
            />
            <YAxis
              type="category"
              dataKey="className"
              tick={{ fill: COLOR_AXIS, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              cursor={{ fill: 'rgb(var(--color-neutral-100) / 0.6)' }}
              content={(props) => (
                <ClassTooltip
                  active={props.active}
                  payload={props.payload as unknown as readonly ClassTooltipEntry[] | undefined}
                  dir={i18n.dir()}
                  useHoursFallback={useHoursFallback}
                />
              )}
            />
            <Bar dataKey="displayValue" radius={[0, 6, 6, 0]} maxBarSize={22}>
              {chartData.map((entry) => (
                <Cell key={entry.classId} fill={barColorFor(entry)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

interface TooltipEntry {
  payload?: {
    fullRange: string;
    schoolDays: number;
    requiredHours: number;
    absentHours: number;
    justifiedHours: number;
    unjustifiedHours: number;
    rate: number | null;
    isCurrent: boolean;
  };
}

function PeriodTooltip({
  active,
  payload,
  dir,
  useHoursFallback,
  kind,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  dir: 'rtl' | 'ltr';
  useHoursFallback: boolean;
  kind: 'weekly' | 'monthly';
}) {
  const { t } = useTranslation();
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div
      dir={dir}
      className="min-w-48 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-neutral-100 pb-1.5">
        <span className="font-bold text-neutral-900">{point.fullRange}</span>
        {point.isCurrent ? (
          <span className="font-medium text-primary-700">
            {kind === 'weekly' ? t('dashboard.currentWeekTag') : t('dashboard.currentMonthTag')}
          </span>
        ) : null}
      </div>

      <dl className="flex flex-col gap-1.5">
        {!useHoursFallback ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-neutral-500">{t('dashboard.absenceRateLabel')}</dt>
            <dd className="font-bold tabular-nums text-neutral-900">
              {formatPercent(point.rate)}
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500">{t('dashboard.absentHoursLabel')}</dt>
          <dd className="font-semibold tabular-nums text-neutral-900">{point.absentHours}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-danger-700">{t('dashboard.unjustified')}</dt>
          <dd className="font-semibold tabular-nums text-danger-700">{point.unjustifiedHours}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-secondary-700">{t('dashboard.justified')}</dt>
          <dd className="font-semibold tabular-nums text-secondary-700">{point.justifiedHours}</dd>
        </div>
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-neutral-100 pt-1.5 text-neutral-500">
          <dt>{t('dashboard.schoolDaysLabel')}</dt>
          <dd className="tabular-nums">{point.schoolDays}</dd>
        </div>
      </dl>
    </div>
  );
}

interface ClassTooltipEntry {
  payload?: ClassAbsencePoint;
}

function ClassTooltip({
  active,
  payload,
  dir,
  useHoursFallback,
}: {
  active?: boolean;
  payload?: readonly ClassTooltipEntry[];
  dir: 'rtl' | 'ltr';
  useHoursFallback: boolean;
}) {
  const { t } = useTranslation();
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div
      dir={dir}
      className="min-w-44 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-neutral-100 pb-1.5">
        <span className="font-bold text-neutral-900">{row.className}</span>
        <span className="tabular-nums text-neutral-500">
          {t('dashboard.studentsCountInline', { count: row.studentCount })}
        </span>
      </div>
      <dl className="flex flex-col gap-1.5">
        {!useHoursFallback ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-neutral-500">{t('dashboard.absenceRateLabel')}</dt>
            <dd className="font-bold tabular-nums text-neutral-900">{formatPercent(row.rate)}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-neutral-500">{t('dashboard.absentHoursLabel')}</dt>
          <dd className="font-semibold tabular-nums text-neutral-900">{row.absentHours}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-danger-700">{t('dashboard.unjustified')}</dt>
          <dd className="font-semibold tabular-nums text-danger-700">{row.unjustifiedHours}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-secondary-700">{t('dashboard.justified')}</dt>
          <dd className="font-semibold tabular-nums text-secondary-700">{row.justifiedHours}</dd>
        </div>
      </dl>
    </div>
  );
}

function ChartLegend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-600">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.dashed ? (
            <span
              className="inline-block h-0.5 w-3.5 border-t-2 border-dashed"
              style={{ borderColor: item.color }}
              aria-hidden
            />
          ) : (
            <span
              className="inline-block size-2.5 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
          )}
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
