import type { BoardingStatus, ParentCorrespondenceRow, SupervisorAbsenceRow, TeacherAbsenceReason } from '@/db/types';
import type { StudentDayAbsence } from '@/utils/dailyPage1';
import type { Page2Computed } from '@/utils/dailyPage2';
import { absenceRate, formatRate } from '@/utils/dailyReportStats';

export interface DailyReportHeader {
  wilaya: string;
  schoolYear: string;
  institution: string;
  reportNumber: string;
  city: string;
  reportDate: string;
}

export interface DailyReportRender {
  header: DailyReportHeader;
  computed: Page2Computed;
  wholeDayAbsences: StudentDayAbsence[];
  parentRows: ParentCorrespondenceRow[];
  observations: string;
  plannedMeal: string;
  mealServed: string;
  canteenNote: string;
  canteenSupervisors: string[];
  availableSupervisors: string[];
  supervisorRows: SupervisorAbsenceRow[];
  counselorNotes: string;
  directorNotes: string;
  entrySummary?: { entered: number; enrolled: number } | null;
}

export const TEACHER_MIN_ROWS = 8;
export const TEACHER_PERIOD_COLUMNS = 8;
export const CANTEEN_SUPERVISOR_ROWS = 3;
export const DEFAULT_LEVEL_CLASS_COLUMNS = 11;
export const SUPERVISOR_MIN_ROWS = 4;
export const WHOLE_TABLE_ROWS = 30;
export const WHOLE_BLOCK_SIZE = WHOLE_TABLE_ROWS * 2;
export const PARENT_MIN_ROWS = 10;

export const BOARDING_LABELS: Record<BoardingStatus, string> = {
  'half-boarder': 'نصف داخلي',
  external: 'خارجي',
};

export const REASON_LABELS: Record<TeacherAbsenceReason, string> = {
  sickLeave: 'عطلة مرضية',
  requested: 'طلب غياب',
  other: 'أخرى',
};

export const SUPERVISOR_LABELS = { none: '', absent: 'غائب', late: 'متأخر' } as const;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => ESCAPES[char]);

export function formatDate(iso: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function footerDate(reportDate: string): string {
  if (!reportDate) return '      /      /      ';
  const parts = reportDate.split('-');
  if (parts.length !== 3) return reportDate;
  const [year, month, day] = parts;
  return `${day} / ${month} / ${year}`;
}

export function footerText(city: string, reportDate: string): string {
  return `${city ? `${city} ` : ''}في : ${footerDate(reportDate)}`;
}

export function resolveCanteenSupervisors(render: DailyReportRender): string[] {
  const custom = render.canteenSupervisors.map((name) => name.trim()).filter(Boolean);
  const fromRows = render.supervisorRows.map((row) => row.name.trim()).filter(Boolean);
  const source = custom.length > 0 ? custom : fromRows.length > 0 ? fromRows : render.availableSupervisors;
  return Array.from({ length: CANTEEN_SUPERVISOR_ROWS }, (_, index) => source[index] ?? '');
}

export function levelColumnCount(render: DailyReportRender): number {
  const maxClasses = Math.max(0, ...render.computed.levels.map((level) => level.classes.length));
  return Math.max(DEFAULT_LEVEL_CLASS_COLUMNS, maxClasses);
}

export const DAILY_REPORT_CSS = `
@page { size: A4 portrait; margin: 0; }
.dr-page {
  box-sizing: border-box;
  width: 210mm;
  min-height: 297mm;
  padding: 6mm 8mm;
  background: #fff;
  color: #000;
  font-family: Cairo, Arial, sans-serif;
  font-size: 8.5pt;
  line-height: 1.3;
  direction: rtl;
  position: relative;
}
.dr-top-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2mm;
  font-size: 9pt;
  font-weight: 700;
  line-height: 1.45;
}
.dr-top-right { text-align: right; }
.dr-top-left { text-align: left; }
.dr-title-wrap {
  display: flex;
  justify-content: center;
  margin: 0 0 2.5mm;
}
.dr-title-box {
  min-width: 66mm;
  border: 1.5px solid #000;
  box-shadow: 2px 2px 0 #999;
  padding: 1.5mm 6mm;
  text-align: center;
  font-weight: 700;
  font-size: 10.5pt;
  line-height: 1.4;
  background: #fff;
}
.dr-title-date {
  font-size: 9.5pt;
  text-align: right;
  margin-top: 0.5mm;
}
.dr-sec {
  font-weight: 700;
  font-size: 8.5pt;
  margin: 1.8mm 0 0.8mm;
  line-height: 1.25;
}
.dr-sec-sub {
  font-weight: 700;
  font-size: 8pt;
  margin: 0 0 1mm;
  line-height: 1.2;
}
.dr-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.8px solid #000;
  margin-bottom: 1.8mm;
}
.dr-table th, .dr-table td {
  border: 1px solid #000;
  padding: 0.4mm 1mm;
  height: 4.5mm;
  font-size: 7.5pt;
  line-height: 1.2;
  text-align: center;
  vertical-align: middle;
  overflow-wrap: anywhere;
}
.dr-table th {
  font-weight: 700;
}
.dr-table .dr-name {
  text-align: right;
  padding-right: 1.5mm;
}
.dr-shade {
  background: #e5e7eb;
}
.dr-dots {
  background-color: #e5e7eb;
  background-image: radial-gradient(#525252 0.5px, transparent 0.5px);
  background-size: 2.8px 2.8px;
}
.dr-thick-box {
  border: 1.8px solid #000;
  padding: 1.5mm 2.5mm;
  min-height: 11mm;
  margin-bottom: 1.8mm;
  white-space: pre-wrap;
  font-size: 8pt;
  line-height: 1.35;
}
.dr-canteen-table td, .dr-canteen-table th {
  height: 4.7mm;
}
.dr-canteen-cell {
  vertical-align: middle;
  white-space: pre-wrap;
  font-size: 8pt;
  padding: 1.5mm;
}
.dr-canteen-label {
  font-weight: 700;
  text-align: center;
}
.dr-levels-top-empty {
  border: 0 !important;
  background: transparent !important;
}
.dr-levels-group-box {
  border: 1.8px solid #000 !important;
  font-weight: 700;
  background: #fff;
}
.dr-levels-col-thick {
  border-inline-start: 1.8px solid #000 !important;
}
.dr-levels-col-thick-end {
  border-inline-end: 1.8px solid #000 !important;
}
.dr-bottom-split {
  display: flex;
  gap: 2mm;
  align-items: stretch;
  margin-top: 1mm;
}
.dr-split-right {
  flex: 1.15;
  display: flex;
  flex-direction: column;
}
.dr-split-left {
  flex: 0.95;
  display: flex;
  flex-direction: column;
}
.dr-split-title {
  font-weight: 700;
  font-size: 8pt;
  margin: 0 0 0.8mm;
  text-align: right;
}
.dr-split-title-center {
  font-weight: 700;
  font-size: 8.5pt;
  margin: 0 0 0.8mm;
  text-align: center;
}
.dr-bottom-split .dr-table {
  margin-bottom: 0;
  flex: 1;
}
.dr-notes-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.8px solid #000;
  margin-top: 1.5mm;
}
.dr-notes-table td {
  border: 1.4px solid #000;
  padding: 1.5mm 2mm;
  font-size: 8pt;
  vertical-align: middle;
}
.dr-notes-label {
  font-weight: 700;
  text-align: center;
  line-height: 1.4;
}
.dr-notes-body {
  text-align: right;
  vertical-align: top !important;
  white-space: pre-wrap;
  line-height: 1.4;
}
.dr-notes-sign {
  font-weight: 700;
  text-align: center;
}
/* Page 2 specific compact layout */
.dr-page-2 {
  padding: 5mm 7mm;
}
.dr-p2-heading {
  font-weight: 700;
  font-size: 8.5pt;
  margin: 0 0 1mm;
  text-align: right;
}
.dr-p2-table th, .dr-p2-table td {
  height: 3.9mm;
  padding: 0 0.8mm;
  font-size: 7.2pt;
}
.dr-p2-divider {
  border-inline-start: 2px solid #000 !important;
}
.dr-p2-num {
  font-weight: 700;
  border-inline-end: 1.6px solid #000 !important;
}
.dr-p2-footer {
  margin-top: 2.5mm;
  text-align: left;
  padding-left: 16mm;
  font-weight: 700;
  font-size: 9pt;
}
.dr-editable {
  cursor: pointer;
  border-radius: 2px;
}
.dr-editable:hover {
  outline: 1.5px dashed #0d9488;
  outline-offset: 1px;
}
@media print {
  .dr-page { page-break-after: always; break-after: page; }
  .dr-page:last-child { page-break-after: auto; break-after: auto; }
  .dr-editable:hover { outline: none; }
}
`;

const td = (value: string | number, attrs = '') =>
  `<td${attrs ? ` ${attrs}` : ''}>${value === '' ? '&nbsp;' : esc(String(value))}</td>`;

function padTwo(num: number): string {
  return String(num).padStart(2, '0');
}

function renderHeader(render: DailyReportRender): string {
  const { header } = render;
  return `<div class="dr-editable" data-edit="details">
  <div class="dr-top-head">
    <div class="dr-top-right">
      <div>مديرية التربية لولاية : ${esc(header.wilaya)}</div>
      <div>المؤسسة : ${esc(header.institution)}</div>
      <div>الرقم: ${esc(header.reportNumber)}</div>
    </div>
    <div class="dr-top-left">
      <div>السنة الدراسية : ${esc(header.schoolYear)}</div>
    </div>
  </div>
  <div class="dr-title-wrap">
    <div class="dr-title-box">
      <div>التقرير اليومي للناظر</div>
      <div class="dr-title-date">ليوم: ${esc(formatDate(header.reportDate))}</div>
    </div>
  </div>
</div>`;
}

function renderTeachersTable(render: DailyReportRender): string {
  const periods = Array.from({ length: TEACHER_PERIOD_COLUMNS }, (_, index) => index + 1);
  const lines = render.computed.teacherLines;
  const rowCount = Math.max(TEACHER_MIN_ROWS, lines.length);

  const head = `<tr>
    <th style="width:6%">الرقم</th>
    <th style="width:21%">اللقب و الاسم</th>
    <th style="width:11%">المادة</th>
    ${periods.map((period) => `<th style="width:5.5%">${period}</th>`).join('')}
    <th style="width:18%">ملاحظات</th>
  </tr>`;

  const body = Array.from({ length: rowCount }, (_, index) => {
    const line = lines[index];
    const marks = periods.map((period) => td(line?.classByPeriod[period] ?? '')).join('');
    const note = line
      ? [line.reason ? REASON_LABELS[line.reason] : '', line.reasonNote, line.note].filter(Boolean).join(' - ')
      : '';
    return `<tr>
      <td><b>${padTwo(index + 1)}</b></td>
      ${td(line?.name ?? '', 'class="dr-name"')}
      ${td(line?.subjects ?? '', 'class="dr-name"')}
      ${marks}
      ${td(note, 'class="dr-name"')}
    </tr>`;
  }).join('');

  return `<div class="dr-sec">1- مواضبة الأساتذة:</div>
<div class="dr-sec-sub">1-1- دروس لم تقدم:</div>
<div class="dr-editable" data-edit="teachers">
  <table class="dr-table"><thead>${head}</thead><tbody>${body}</tbody></table>
</div>`;
}

function renderObservationsBox(render: DailyReportRender): string {
  return `<div class="dr-sec-sub" style="text-align:center">2-1- ملاحظات و إجراءات:</div>
<div class="dr-editable dr-thick-box" data-edit="observations">${render.observations ? esc(render.observations) : '&nbsp;'}</div>`;
}

function renderCanteenSection(render: DailyReportRender): string {
  const { canteen } = render.computed;
  const sups = resolveCanteenSupervisors(render);

  return `<div class="dr-sec">2- مراقبة المطعم:</div>
<div class="dr-editable" data-edit="canteen">
  <table class="dr-table dr-canteen-table">
    <colgroup>
      <col style="width:18%">
      <col style="width:6%">
      <col style="width:26%">
      <col style="width:22%">
      <col style="width:28%">
    </colgroup>
    <tbody>
      <tr>
        <td class="dr-canteen-label">تعداد التلاميذ</td>
        <td><b>${canteen.halfBoarders}</b></td>
        <th>الوجبة الغذائية المقررة</th>
        <th>الوجبة الغذائية المقدمة</th>
        <th>ملاحظات</th>
      </tr>
      <tr>
        <td class="dr-canteen-label">التلاميذ الغائبون</td>
        <td><b>${canteen.absent}</b></td>
        <td rowspan="6" class="dr-canteen-cell">${render.plannedMeal ? esc(render.plannedMeal) : '&nbsp;'}</td>
        <td rowspan="6" class="dr-canteen-cell">${render.mealServed ? esc(render.mealServed) : '&nbsp;'}</td>
        <td rowspan="6" class="dr-canteen-cell">${render.canteenNote ? esc(render.canteenNote) : '&nbsp;'}</td>
      </tr>
      <tr>
        <td class="dr-canteen-label">التلاميذ الحاضرون</td>
        <td><b>${canteen.present}</b></td>
      </tr>
      <tr>
        <td class="dr-canteen-label">المراقبون المكلفون</td>
        <td>&nbsp;</td>
      </tr>
      ${sups
        .map(
          (name) => `<tr>
        <td>${name ? esc(name) : '&nbsp;'}</td>
        <td>&nbsp;</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
</div>`;
}

function renderLevelsSection(render: DailyReportRender): string {
  const { levels } = render.computed;
  const cols = levelColumnCount(render);
  const colSums = Array.from({ length: cols }, (_, colIndex) =>
    levels.reduce((sum, level) => sum + (level.classes[colIndex]?.absent ?? 0), 0),
  );

  const thead = `<thead>
    <tr>
      <th class="dr-levels-top-empty"></th>
      <th colspan="${cols}" class="dr-levels-top-empty"></th>
      <th colspan="2" class="dr-levels-group-box">المجموع</th>
      <th class="dr-levels-top-empty"></th>
    </tr>
    <tr>
      <th class="dr-shade" style="width:13%">المستوى</th>
      <th colspan="${cols}" class="dr-shade">الأفواج</th>
      <th class="dr-shade dr-levels-col-thick" style="width:7%">تلاميذ</th>
      <th class="dr-shade dr-levels-col-thick-end" style="width:7%">الغائبون</th>
      <th class="dr-shade" style="width:9%">نسبة الغياب</th>
    </tr>
  </thead>`;

  const rows = levels
    .map((level) => {
      const names = Array.from({ length: cols }, (_, index) => {
        const cls = level.classes[index];
        return td(cls ? cls.className : '/', 'style="font-weight:700"');
      }).join('');
      const counts = Array.from({ length: cols }, (_, index) => {
        const cls = level.classes[index];
        return td(cls ? cls.absent : '');
      }).join('');
      return `<tr>
        <td class="dr-name"><b>الأقسام السنة ${esc(String(level.level))}</b></td>
        ${names}
        <td rowspan="2" class="dr-levels-col-thick"><b>${level.enrolled}</b></td>
        <td rowspan="2" class="dr-levels-col-thick-end"><b>${level.absent}</b></td>
        <td rowspan="2"><b>${esc(formatRate(level.rate))}</b></td>
      </tr>
      <tr>
        <td class="dr-name">عدد الغائبين</td>
        ${counts}
      </tr>`;
    })
    .join('');

  const totalEnrolled = levels.reduce((sum, level) => sum + level.enrolled, 0);
  const totalAbsent = levels.reduce((sum, level) => sum + level.absent, 0);
  const totalRow = `<tr>
    <td><b>مجموع</b></td>
    ${colSums.map((value) => `<td><b>${value}</b></td>`).join('')}
    <td class="dr-levels-col-thick"><b>${totalEnrolled}</b></td>
    <td class="dr-levels-col-thick-end"><b>${totalAbsent}</b></td>
    <td><b>${esc(formatRate(absenceRate(totalAbsent, totalEnrolled)))}</b></td>
  </tr>`;

  const entryLine = render.entrySummary
    ? `<div class="dr-sec-sub">عدد الداخلين اليوم: ${render.entrySummary.entered} من ${render.entrySummary.enrolled}</div>\n`
    : '';

  return `<div class="dr-sec">3- مراقبة التلاميذ</div>
${entryLine}<div class="dr-sec-sub">1-3- الغيابات:</div>
<table class="dr-table" style="border-top:0">${thead}<tbody>${rows}${totalRow}</tbody></table>`;
}

function renderBottomSplit(render: DailyReportRender): string {
  const supCount = Math.max(SUPERVISOR_MIN_ROWS, render.supervisorRows.length);
  const supRowsHtml = Array.from({ length: supCount }, (_, index) => {
    const row = render.supervisorRows[index];
    return `<tr>
      ${td(row?.name ?? '', 'class="dr-name"')}
      ${td(row ? SUPERVISOR_LABELS[row.morning] : '')}
      ${td(row ? SUPERVISOR_LABELS[row.evening] : '')}
      ${td(row?.notes ?? '', 'class="dr-name"')}
    </tr>`;
  }).join('');

  const { students, teachers, supervisors } = render.computed.summary;
  const sumRow = (label: string, pick: (counts: { total: number; absent: number; present: number }) => number) => `<tr>
    <td><b>${label}</b></td>
    <td>${pick(students.male)}</td>
    <td>${pick(students.female)}</td>
    <td><b>${pick(students.all)}</b></td>
    <td>${pick(teachers)}</td>
    <td>${pick(supervisors)}</td>
  </tr>`;

  return `<div class="dr-bottom-split">
  <div class="dr-split-right dr-editable" data-edit="supervisors">
    <div class="dr-split-title">2-3- غيابات وتأخرات المساعدين التربويين:</div>
    <table class="dr-table">
      <colgroup>
        <col style="width:36%">
        <col style="width:12%">
        <col style="width:12%">
        <col style="width:40%">
      </colgroup>
      <thead>
        <tr>
          <th>اللقب و الاسم</th>
          <th class="dr-dots">صباحا</th>
          <th class="dr-dots">مساءا</th>
          <th class="dr-dots">الملاحظات</th>
        </tr>
      </thead>
      <tbody>${supRowsHtml}</tbody>
    </table>
  </div>
  <div class="dr-split-left">
    <div class="dr-split-title-center">الخلاصة</div>
    <table class="dr-table">
      <colgroup>
        <col style="width:24%">
        <col style="width:14%">
        <col style="width:14%">
        <col style="width:16%">
        <col style="width:16%">
        <col style="width:16%">
      </colgroup>
      <thead>
        <tr>
          <th style="border-top:0;border-right:0;background:#fff"></th>
          <th colspan="3" class="dr-dots">التلاميذ</th>
          <th rowspan="2" class="dr-dots">الأساتذة</th>
          <th rowspan="2" class="dr-dots">المساعدون</th>
        </tr>
        <tr>
          <th style="border-right:0;background:#fff"></th>
          <th>ذكور</th>
          <th>إناث</th>
          <th>مجموع</th>
        </tr>
      </thead>
      <tbody>
        ${sumRow('المجموع', (c) => c.total)}
        ${sumRow('الغائبون', (c) => c.absent)}
        ${sumRow('الحاضرون', (c) => c.present)}
      </tbody>
    </table>
  </div>
</div>`;
}

function renderNotesAndSignatures(render: DailyReportRender): string {
  return `<table class="dr-notes-table">
  <colgroup>
    <col style="width:22%">
    <col style="width:58%">
    <col style="width:20%">
  </colgroup>
  <tbody>
    <tr class="dr-editable" data-edit="counselor" style="height:26mm">
      <td class="dr-notes-label">ملاحظات حول النظافة<br/>الصيانة والإتلاف - الحوادث<br/>- النشاط الثقافي والرياضي -<br/>دروس الدعم - الزيارات</td>
      <td class="dr-notes-body">${render.counselorNotes ? esc(render.counselorNotes) : '&nbsp;'}</td>
      <td class="dr-notes-sign">امضاء الناظر</td>
    </tr>
    <tr class="dr-editable" data-edit="director" style="height:10mm">
      <td class="dr-notes-label">ملاحظات مدير المؤسسة</td>
      <td class="dr-notes-body">${render.directorNotes ? esc(render.directorNotes) : '&nbsp;'}</td>
      <td class="dr-notes-sign">امضاء المدير</td>
    </tr>
  </tbody>
</table>`;
}

function renderWholeHalfCells(item: StudentDayAbsence | undefined, number: number, isLeftHalf: boolean): string {
  const numClass = isLeftHalf ? 'dr-p2-num dr-p2-divider' : 'dr-p2-num';
  if (!item) {
    return `<td class="${numClass}">${number}</td><td class="dr-name">&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>`;
  }
  return `<td class="${numClass}">${number}</td>${td(item.name, 'class="dr-name"')}${td(item.className)}${td(BOARDING_LABELS[item.boarding])}${td(formatDate(item.since))}`;
}

function renderWholeDayTable(items: StudentDayAbsence[], start: number): string {
  const head = `<tr>
    <th class="dr-dots dr-p2-num" style="width:5%">الرقم</th>
    <th class="dr-dots" style="width:17%">اللقب و الاسم</th>
    <th class="dr-dots" style="width:7%">القسم</th>
    <th class="dr-dots" style="width:9%">الصفة</th>
    <th class="dr-dots" style="width:12%">تاريخ الغياب</th>
    <th class="dr-dots dr-p2-num dr-p2-divider" style="width:5%">الرقم</th>
    <th class="dr-dots" style="width:17%">اللقب و الاسم</th>
    <th class="dr-dots" style="width:7%">القسم</th>
    <th class="dr-dots" style="width:9%">الصفة</th>
    <th class="dr-dots" style="width:12%">تاريخ الغياب</th>
  </tr>`;

  const body = Array.from({ length: WHOLE_TABLE_ROWS }, (_, row) => {
    const rightIdx = start + row;
    const leftIdx = start + WHOLE_TABLE_ROWS + row;
    return `<tr>${renderWholeHalfCells(items[rightIdx], rightIdx + 1, false)}${renderWholeHalfCells(items[leftIdx], leftIdx + 1, true)}</tr>`;
  }).join('');

  return `<table class="dr-table dr-p2-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderParentsTable(rows: ParentCorrespondenceRow[]): string {
  const head = `<tr>
    <th class="dr-dots dr-p2-num" style="width:5%">الرقم</th>
    <th class="dr-dots" style="width:17%">اللقب و الاسم</th>
    <th class="dr-dots" style="width:7%">القسم</th>
    <th class="dr-dots" style="width:7%">ساعات</th>
    <th class="dr-dots" style="width:12%">تاريخ الغياب</th>
    <th class="dr-dots" style="width:11%">الأسباب</th>
    <th class="dr-dots" style="width:10%">اشعار اول</th>
    <th class="dr-dots" style="width:10%">اشعار ثاني</th>
    <th class="dr-dots" style="width:9%">اعذار</th>
    <th class="dr-dots" style="width:12%">تاريخ الشطب</th>
  </tr>`;

  const total = Math.max(PARENT_MIN_ROWS, rows.length);
  const body = Array.from({ length: total }, (_, index) => {
    const row = rows[index];
    if (!row) {
      return `<tr><td class="dr-p2-num">${index + 1}</td><td class="dr-name">&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    }
    return `<tr><td class="dr-p2-num">${index + 1}</td>${td(row.name, 'class="dr-name"')}${td(row.className)}${td(row.hours)}${td(formatDate(row.absenceDate))}${td(row.reason)}${td(row.firstNotice)}${td(row.secondNotice)}${td(row.excuse)}${td(formatDate(row.struckDate))}</tr>`;
  }).join('');

  return `<div class="dr-editable" data-edit="parents">
  <div class="dr-p2-heading">مراسلات الأولياء</div>
  <table class="dr-table dr-p2-table"><thead>${head}</thead><tbody>${body}</tbody></table>
</div>`;
}

function renderPage2Notes(render: DailyReportRender): string {
  return `<table class="dr-notes-table" style="margin-top:0">
  <colgroup>
    <col style="width:20%">
    <col style="width:60%">
    <col style="width:20%">
  </colgroup>
  <tbody>
    <tr class="dr-editable" data-edit="counselor" style="height:24mm">
      <td class="dr-notes-label">ملاحظات و اقتراحات<br/>مستشار التربية حول النظافة -<br/>الصيانة والإتلاف - الحوادث<br/>- النشاط الثقافي والرياضي -<br/>دروس الدعم - الزيارات</td>
      <td class="dr-notes-body">${render.counselorNotes ? esc(render.counselorNotes) : '&nbsp;'}</td>
      <td class="dr-notes-sign">الامضاء</td>
    </tr>
    <tr class="dr-editable" data-edit="director" style="height:36mm">
      <td class="dr-notes-label">ملاحظات مدير المؤسسة</td>
      <td class="dr-notes-body">${render.directorNotes ? esc(render.directorNotes) : '&nbsp;'}</td>
      <td class="dr-notes-sign">الامضاء</td>
    </tr>
  </tbody>
</table>`;
}

function buildPage2Html(render: DailyReportRender): string[] {
  const title = '<div class="dr-p2-heading">التلاميذ الغائبون إلى نهاية اليوم : (يسجل التلاميذ المتغيبين لمدة يوم أو أكثر فقط)</div>';
  const blockCount = Math.max(1, Math.ceil(render.wholeDayAbsences.length / WHOLE_BLOCK_SIZE));
  const footer = `<div class="dr-p2-footer">${esc(footerText(render.header.city, render.header.reportDate))}</div>`;

  return Array.from({ length: blockCount }, (_, block) => {
    const wholeTable = renderWholeDayTable(render.wholeDayAbsences, block * WHOLE_BLOCK_SIZE);
    if (block > 0) {
      return `<section class="dr-page dr-page-2">${title}${wholeTable}${footer}</section>`;
    }
    return `<section class="dr-page dr-page-2">
${title}
${wholeTable}
${renderParentsTable(render.parentRows)}
${renderPage2Notes(render)}
${footer}
</section>`;
  });
}

export function buildDailyReportHtml(render: DailyReportRender): string[] {
  const page1 = `<section class="dr-page">
${renderHeader(render)}
${renderTeachersTable(render)}
${renderObservationsBox(render)}
${renderCanteenSection(render)}
${renderLevelsSection(render)}
${renderBottomSplit(render)}
${renderNotesAndSignatures(render)}
</section>`;
  return [page1, ...buildPage2Html(render)];
}
