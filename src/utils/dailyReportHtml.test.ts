import { describe, expect, it } from 'vitest';
import { buildDailyReportWorkbook } from '@/utils/dailyExcel';
import { buildDailyReportHtml, type DailyReportRender } from '@/utils/dailyReportHtml';

const SAMPLE_RENDER: DailyReportRender = {
  header: {
    wilaya: 'البليدة',
    schoolYear: '2026/2025',
    institution: 'متوسطة بولعراس رابح - العفرون',
    reportNumber: '109',
    city: 'العفرون',
    reportDate: '2026-11-20',
  },
  computed: {
    periods: [1, 2, 3, 4, 5, 6, 7],
    teacherLines: [
      {
        teacherId: 't1',
        name: 'بن علي كريم',
        subjects: 'رياضيات',
        marks: [1, 2],
        classes: '1م1 / 2م3',
        classByPeriod: { 1: '1م1', 2: '2م3' },
        reason: 'sickLeave',
        reasonNote: '',
        note: 'شهادة طبية',
      },
    ],
    canteen: {
      halfBoarders: 120,
      present: 112,
      absent: 8,
      absentNames: [],
      source: 'scans',
    },
    levels: [
      {
        level: 1,
        classes: [
          { classId: 'c1', className: '1م1', enrolled: 35, absent: 2 },
          { classId: 'c2', className: '1م2', enrolled: 33, absent: 1 },
        ],
        enrolled: 68,
        absent: 3,
        rate: 4.41,
      },
    ],
    summary: {
      students: {
        male: { total: 36, absent: 2, present: 34 },
        female: { total: 32, absent: 1, present: 31 },
        all: { total: 68, absent: 3, present: 65 },
      },
      teachers: { total: 24, absent: 1, present: 23 },
      supervisors: { total: 4, absent: 0, present: 4 },
    },
  },
  wholeDayAbsences: [
    {
      studentId: 'st1',
      name: 'أحمد بن سالم',
      className: '1م1',
      boarding: 'half-boarder',
      hours: 6,
      wholeDay: true,
      since: '2026-11-18',
      periods: [1, 2, 3, 4, 5, 6],
    },
  ],
  parentRows: [
    {
      studentId: 'st1',
      name: 'أحمد بن سالم',
      className: '1م1',
      hours: '12',
      absenceDate: '2026-11-18',
      reason: 'غياب متكرر',
      firstNotice: '19/11',
      secondNotice: '',
      excuse: '',
      struckDate: '',
    },
  ],
  observations: 'تنظيم الدخول الصباحي بدون حوادث',
  plannedMeal: 'عدس + سلطة + فاكهة',
  mealServed: 'عدس + سلطة + برتقال',
  canteenNote: 'وجبة عادية',
  canteenSupervisors: ['أعمر سراي محمد', 'بن عودة لينا', 'ردمة زغين هبة'],
  availableSupervisors: ['أعمر سراي محمد'],
  supervisorRows: [{ supervisorId: 's1', name: 'أعمر سراي محمد', morning: 'none', evening: 'late', notes: 'تأخر 10 د' }],
  counselorNotes: 'نظافة الساحة جيدة، إجراء نشاط ثقافي',
  directorNotes: 'مشكور على المجهود',
};

function worksheetText(ws: import('exceljs').Worksheet): string {
  const values: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined) values.push(String(cell.value));
    });
  });
  return values.join(' | ');
}

describe('daily report HTML and Excel (Page 1, Page 2, and Page 3+ overflow)', () => {
  it('places short notes on Page 1 only without repeating them on Page 2', () => {
    const pages = buildDailyReportHtml(SAMPLE_RENDER);
    expect(pages).toHaveLength(2);

    const [page1, page2] = pages;
    expect(page1).toContain('التقرير اليومي للناظر');
    expect(page1).toContain('20/11/2026');
    expect(page1).toContain('بن علي كريم');
    expect(page1).toContain('1م1');
    expect(page1).toContain('2م3');
    expect(page1).toContain('وجبة عادية');
    expect(page1).toContain('عدس + سلطة + فاكهة');
    expect(page1).toContain('أعمر سراي محمد');
    expect(page1).toContain('تنظيم الدخول الصباحي بدون حوادث');
    expect(page1).toContain('نظافة الساحة جيدة، إجراء نشاط ثقافي');
    expect(page1).toContain('مشكور على المجهود');
    expect(page1).toContain('امضاء الناظر');
    expect(page1).toContain('امضاء المدير');

    expect(page2).toContain('التلاميذ الغائبون إلى نهاية اليوم');
    expect(page2).toContain('أحمد بن سالم');
    expect(page2).toContain('نصف داخلي');
    expect(page2).toContain('18/11/2026');
    expect(page2).toContain('مراسلات الأولياء');
    expect(page2).toContain('غياب متكرر');
    expect(page2).toContain('ملاحظات و اقتراحات');
    // Notes that fit on Page 1 must NOT repeat on Page 2
    expect(page2).not.toContain('نظافة الساحة جيدة، إجراء نشاط ثقافي');
    expect(page2).not.toContain('مشكور على المجهود');
    expect(page2).toContain('العفرون في : 20 / 11 / 2026');
  });

  it('flows notes from Page 1 to Page 2 without duplication when Page 1 fills up', () => {
    const counselorLines = Array.from({ length: 18 }, (_, idx) => `ملاحظة المستشار رقم ${idx + 1}: متابعة الساحة والنظافة.`);
    const render: DailyReportRender = {
      ...SAMPLE_RENDER,
      counselorNotes: counselorLines.join('\n'),
      directorNotes: 'توجيهات مختصرة',
    };

    const pages = buildDailyReportHtml(render);
    expect(pages).toHaveLength(2);
    const [page1, page2] = pages;

    expect(page1).toContain('ملاحظة المستشار رقم 1:');
    expect(page1).not.toContain('ملاحظة المستشار رقم 18:');
    expect(page2).toContain('ملاحظة المستشار رقم 18:');
    expect(page2).not.toContain('ملاحظة المستشار رقم 1:');
    // Short director note fit on Page 1, so it does not repeat on Page 2
    expect(page1).toContain('توجيهات مختصرة');
    expect(page2).not.toContain('توجيهات مختصرة');
  });

  it('creates a third continuation page for Page 2 when notes overflow both Page 1 and Page 2', async () => {
    const counselorLines = Array.from({ length: 38 }, (_, idx) => `بند المستشار رقم ${idx + 1}: تفقد التلاميذ والصيانة.`);
    const directorLines = Array.from({ length: 16 }, (_, idx) => `قرار المدير رقم ${idx + 1}: متابعة الانضباط التربوي.`);
    const render: DailyReportRender = {
      ...SAMPLE_RENDER,
      counselorNotes: counselorLines.join('\n'),
      directorNotes: directorLines.join('\n'),
    };

    const pages = buildDailyReportHtml(render);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const [page1, page2, page3] = pages;

    // First items start on Page 1 and never repeat on Page 2 or Page 3
    expect(page1).toContain('بند المستشار رقم 1:');
    expect(page2).not.toContain('بند المستشار رقم 1:');
    expect(page3).not.toContain('بند المستشار رقم 1:');

    // Page 3 is created as continuation of Page 2 and receives the remaining overflow
    expect(page3).toContain('تتمة ملاحظات الصفحة الثانية');
    expect(page3).toContain('بند المستشار رقم 38:');
    expect(page2).not.toContain('بند المستشار رقم 38:');
    expect(page3).toContain('قرار المدير رقم 16:');
    expect(page2).not.toContain('قرار المدير رقم 16:');
    expect(page3).toContain('العفرون في : 20 / 11 / 2026');

    // Excel workbook also creates Sheet 3 without repeating notes
    const workbook = buildDailyReportWorkbook(render);
    expect(workbook.worksheets.length).toBe(pages.length);
    const flat1 = worksheetText(workbook.worksheets[0]);
    const flat2 = worksheetText(workbook.worksheets[1]);
    const flat3 = worksheetText(workbook.worksheets[2]);
    expect(flat1).toContain('بند المستشار رقم 1:');
    expect(flat2).not.toContain('بند المستشار رقم 1:');
    expect(flat3).toContain('بند المستشار رقم 38:');
    expect(flat2).not.toContain('بند المستشار رقم 38:');
  });

  it('builds a professionally styled, RTL, print-ready Excel workbook for Page 1 and Page 2', async () => {
    const workbook = buildDailyReportWorkbook(SAMPLE_RENDER);
    expect(workbook.worksheets).toHaveLength(2);

    const [sheet1, sheet2] = workbook.worksheets;
    expect(sheet1.views[0]?.rightToLeft).toBe(true);
    expect(sheet2.views[0]?.rightToLeft).toBe(true);
    expect(sheet1.pageSetup.paperSize).toBe(9);
    expect(sheet1.pageSetup.fitToPage).toBe(true);
    expect(sheet2.pageSetup.paperSize).toBe(9);
    expect(sheet2.pageSetup.fitToPage).toBe(true);

    const flat1 = worksheetText(sheet1);
    expect(flat1).toContain('التقرير اليومي للناظر');
    expect(flat1).toContain('بن علي كريم');
    expect(flat1).toContain('تعداد التلاميذ');
    expect(flat1).toContain('120');
    expect(flat1).toContain('الوجبة الغذائية المقررة');
    expect(flat1).toContain('الوجبة الغذائية المقدمة');
    expect(flat1).toContain('وجبة عادية');
    expect(flat1).toContain('الأقسام السنة 1');
    expect(flat1).toContain('الخلاصة');
    expect(flat1).toContain('نظافة الساحة جيدة، إجراء نشاط ثقافي');
    expect(flat1).toContain('مشكور على المجهود');
    // Verify borders and header fills exist on Page 1
    expect(sheet1.getCell(8, 1).fill).toBeDefined();
    expect(sheet1.getCell(8, 1).border?.top?.style).toBe('medium');

    const flat2 = worksheetText(sheet2);
    expect(flat2).toContain('التلاميذ الغائبون إلى نهاية اليوم');
    expect(flat2).toContain('أحمد بن سالم');
    expect(flat2).toContain('نصف داخلي');
    expect(flat2).toContain('18/11/2026');
    expect(flat2).toContain('مراسلات الأولياء');
    expect(flat2).toContain('غياب متكرر');
    expect(flat2).not.toContain('نظافة الساحة جيدة، إجراء نشاط ثقافي');
    expect(flat2).not.toContain('مشكور على المجهود');
    expect(flat2).toContain('العفرون في : 20 / 11 / 2026');
    // Verify center divider border and header fill exist on Page 2
    expect(sheet2.getCell(2, 1).fill).toBeDefined();
    expect(sheet2.getCell(2, 5).border?.right?.style).toBe('medium');

    // Verify workbook serializes cleanly to a real .xlsx binary buffer
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(5000);
  });
});
