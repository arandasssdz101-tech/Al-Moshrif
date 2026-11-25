import type { DailyReportRender } from '@/utils/dailyReportHtml';

export interface PageNotesSlice {
  counselor: string;
  director: string;
}

export interface PaginatedDailyNotes {
  page1: PageNotesSlice;
  page2: PageNotesSlice;
  extraPages: PageNotesSlice[];
}

interface VisualLine {
  text: string;
  paragraphIndex: number;
}

const LINE_HEIGHT_MM = 3.95;
const ROW_PADDING_MM = 3.8;
const A4_HEIGHT_MM = 297;

// Conservative character width budgets for 8pt Cairo/Arial inside the RTL notes body cells
const PAGE1_CHARS_PER_LINE = 56;
const PAGE2_CHARS_PER_LINE = 56;
const EXTRA_PAGE_CHARS_PER_LINE = 58;
const OBSERVATIONS_CHARS_PER_LINE = 92;

// Minimum visual row heights driven by the row labels and Page 2 layout
const PAGE1_COUNSELOR_MIN_MM = 20;
const PAGE1_DIRECTOR_MIN_MM = 10;
const PAGE2_COUNSELOR_MIN_MM = 50;
const PAGE2_DIRECTOR_MIN_MM = 24;

export function wrapNoteToVisualLines(text: string, charsPerLine: number): VisualLine[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [];

  const paragraphs = normalized.split('\n');
  const lines: VisualLine[] = [];

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx += 1) {
    const rawParagraph = paragraphs[pIdx].trimEnd();
    if (!rawParagraph.trim()) {
      lines.push({ text: '', paragraphIndex: pIdx });
      continue;
    }

    const words = rawParagraph.trim().split(/\s+/);
    let current = '';

    for (const word of words) {
      if (word.length > charsPerLine) {
        if (current) {
          lines.push({ text: current, paragraphIndex: pIdx });
          current = '';
        }
        for (let offset = 0; offset < word.length; offset += charsPerLine) {
          const chunk = word.slice(offset, offset + charsPerLine);
          if (chunk.length === charsPerLine && offset + charsPerLine < word.length) {
            lines.push({ text: chunk, paragraphIndex: pIdx });
          } else {
            current = chunk;
          }
        }
        continue;
      }

      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= charsPerLine) {
        current = candidate;
      } else {
        if (current) lines.push({ text: current, paragraphIndex: pIdx });
        current = word;
      }
    }

    if (current) {
      lines.push({ text: current, paragraphIndex: pIdx });
    }
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].text === '') {
    lines.pop();
  }
  return lines;
}

function joinVisualLines(lines: VisualLine[]): string {
  if (lines.length === 0) return '';
  const paragraphs: string[] = [];
  let currentParagraphIdx: number | null = null;
  let buffer: string[] = [];

  for (const line of lines) {
    if (currentParagraphIdx === null || line.paragraphIndex !== currentParagraphIdx) {
      if (currentParagraphIdx !== null) {
        paragraphs.push(buffer.join(' '));
      }
      currentParagraphIdx = line.paragraphIndex;
      buffer = line.text === '' ? [] : [line.text];
    } else if (line.text !== '') {
      buffer.push(line.text);
    }
  }
  if (currentParagraphIdx !== null) {
    paragraphs.push(buffer.join(' '));
  }

  return paragraphs.join('\n').trim();
}

export function splitVisualLinesAt(
  lines: VisualLine[],
  maxLines: number,
): { head: string; tail: VisualLine[] } {
  if (lines.length === 0) return { head: '', tail: [] };
  if (maxLines <= 0) return { head: '', tail: [...lines] };
  if (lines.length <= maxLines) {
    return { head: joinVisualLines(lines), tail: [] };
  }

  const headSlice = lines.slice(0, maxLines);
  const tailSlice = lines.slice(maxLines);
  while (tailSlice.length > 0 && tailSlice[0].text === '') {
    tailSlice.shift();
  }
  return {
    head: joinVisualLines(headSlice),
    tail: tailSlice,
  };
}

function linesFittingHeight(heightMm: number): number {
  return Math.max(0, Math.floor((heightMm - ROW_PADDING_MM) / LINE_HEIGHT_MM));
}

function requiredRowHeightMm(lineCount: number, minMm: number): number {
  if (lineCount <= 0) return minMm;
  return Math.max(minMm, ROW_PADDING_MM + lineCount * LINE_HEIGHT_MM);
}

export function estimatePage1NotesBudgetMm(render: DailyReportRender): number {
  const usableHeightMm = A4_HEIGHT_MM - 12; // 6mm top + 6mm bottom padding
  const headerMm = 31;

  const teacherRows = Math.max(8, render.computed.teacherLines.length);
  const extraTeacherNoteLines = render.computed.teacherLines.reduce((sum, line) => {
    const note = [line.reason, line.reasonNote, line.note].filter(Boolean).join(' - ');
    return sum + Math.max(0, Math.ceil(note.length / 26) - 1);
  }, 0);
  const teachersMm = 8 + 5 + teacherRows * 5.2 + extraTeacherNoteLines * 3.5 + 1.8;

  const obsLines = Math.max(1, wrapNoteToVisualLines(render.observations, OBSERVATIONS_CHARS_PER_LINE).length);
  const observationsMm = 4 + Math.max(11, obsLines * 3.8 + 3) + 1.8;

  const canteenMm = 44;

  const levelsCount = Math.max(1, render.computed.levels.length);
  const levelsMm = 9 + (render.entrySummary ? 4 : 0) + 10 + levelsCount * 2 * 5.0 + 5.2 + 1.8;

  const supCount = Math.max(4, render.supervisorRows.length);
  const splitRows = Math.max(supCount + 1, 5);
  const bottomSplitMm = 1 + 4.5 + splitRows * 5.2;

  const safetyAndMarginsMm = 4.5;
  const usedBeforeNotesMm = headerMm + teachersMm + observationsMm + canteenMm + levelsMm + bottomSplitMm + safetyAndMarginsMm;
  return Math.max(0, usableHeightMm - usedBeforeNotesMm);
}

export function estimatePage2NotesBudgetMm(render: DailyReportRender): number {
  const usableHeightMm = A4_HEIGHT_MM - 10; // 5mm top + 5mm bottom padding
  const wholeDayHeadingMm = 6;
  const wholeDayTableMm = 129; // header + 30 rows + margin
  const parentsHeadingMm = 6;
  const parentRowsCount = Math.max(10, render.parentRows.length);
  const parentsTableMm = (parentRowsCount + 1) * 4.1;
  const footerMm = 8.5;
  const safetyMm = 4;

  const usedBeforeNotesMm = wholeDayHeadingMm + wholeDayTableMm + parentsHeadingMm + parentsTableMm + footerMm + safetyMm;
  return Math.max(0, usableHeightMm - usedBeforeNotesMm);
}

function allocateTwoSections(
  counselorCount: number,
  directorCount: number,
  budgetMm: number,
  counselorMinMm: number,
  directorMinMm: number,
): { counselorLines: number; directorLines: number } {
  if (budgetMm < counselorMinMm + directorMinMm) {
    // Tight page: shrink capacity strictly to whatever height remains
    const totalTightLines = linesFittingHeight(Math.max(0, budgetMm - ROW_PADDING_MM));
    if (totalTightLines <= 0) return { counselorLines: 0, directorLines: 0 };
    if (counselorCount === 0) return { counselorLines: 0, directorLines: Math.min(directorCount, totalTightLines) };
    if (directorCount === 0) return { counselorLines: Math.min(counselorCount, totalTightLines), directorLines: 0 };
    const cShare = Math.min(counselorCount, Math.max(1, Math.ceil(totalTightLines * 0.6)));
    const dShare = Math.min(directorCount, Math.max(0, totalTightLines - cShare));
    return { counselorLines: cShare, directorLines: dShare };
  }

  const baseCounselorLines = linesFittingHeight(counselorMinMm);
  const baseDirectorLines = linesFittingHeight(directorMinMm);

  // If both fit within their label-minimum box heights, take all lines immediately
  if (counselorCount <= baseCounselorLines && directorCount <= baseDirectorLines) {
    return { counselorLines: counselorCount, directorLines: directorCount };
  }

  // Compute maximum lines each section can consume while the other keeps at least its minimum height (or its needed height)
  const directorUsedMmIfFit = requiredRowHeightMm(directorCount, directorMinMm);
  const counselorUsedMmIfFit = requiredRowHeightMm(counselorCount, counselorMinMm);

  if (counselorUsedMmIfFit + directorUsedMmIfFit <= budgetMm) {
    return { counselorLines: counselorCount, directorLines: directorCount };
  }

  // Otherwise we must split! Give unused space from one section to the other.
  if (directorCount <= baseDirectorLines) {
    const maxC = linesFittingHeight(budgetMm - directorMinMm);
    return {
      counselorLines: Math.min(counselorCount, Math.max(baseCounselorLines, maxC)),
      directorLines: directorCount,
    };
  }

  if (counselorCount <= baseCounselorLines) {
    const maxD = linesFittingHeight(budgetMm - counselorMinMm);
    return {
      counselorLines: counselorCount,
      directorLines: Math.min(directorCount, Math.max(baseDirectorLines, maxD)),
    };
  }

  // Both exceed their label-minimum height and combined height exceeds budgetMm
  const extraMm = budgetMm - counselorMinMm - directorMinMm;
  const extraLines = Math.max(0, Math.floor(extraMm / LINE_HEIGHT_MM));
  const cExtra = Math.ceil(extraLines * 0.6);
  const dExtra = extraLines - cExtra;

  let cCap = baseCounselorLines + cExtra;
  let dCap = baseDirectorLines + dExtra;

  if (counselorCount < cCap) {
    dCap += cCap - counselorCount;
    cCap = counselorCount;
  } else if (directorCount < dCap) {
    cCap += dCap - directorCount;
    dCap = directorCount;
  }

  return {
    counselorLines: Math.min(counselorCount, cCap),
    directorLines: Math.min(directorCount, dCap),
  };
}

export function paginateDailyReportNotes(render: DailyReportRender): PaginatedDailyNotes {
  const counselorAll = wrapNoteToVisualLines(render.counselorNotes, PAGE1_CHARS_PER_LINE);
  const directorAll = wrapNoteToVisualLines(render.directorNotes, PAGE1_CHARS_PER_LINE);

  // 1. Allocate Page 1
  const page1BudgetMm = estimatePage1NotesBudgetMm(render);
  const page1Alloc = allocateTwoSections(
    counselorAll.length,
    directorAll.length,
    page1BudgetMm,
    PAGE1_COUNSELOR_MIN_MM,
    PAGE1_DIRECTOR_MIN_MM,
  );
  const p1C = splitVisualLinesAt(counselorAll, page1Alloc.counselorLines);
  const p1D = splitVisualLinesAt(directorAll, page1Alloc.directorLines);

  // Re-wrap overflow for Page 2 width (slightly wider 60% column)
  let remCounselor = wrapNoteToVisualLines(joinVisualLines(p1C.tail), PAGE2_CHARS_PER_LINE);
  let remDirector = wrapNoteToVisualLines(joinVisualLines(p1D.tail), PAGE2_CHARS_PER_LINE);

  // 2. Allocate Page 2 ONLY from overflow that did NOT fit on Page 1 (never repeat Page 1 text!)
  const page2BudgetMm = estimatePage2NotesBudgetMm(render);
  const page2Alloc = allocateTwoSections(
    remCounselor.length,
    remDirector.length,
    page2BudgetMm,
    PAGE2_COUNSELOR_MIN_MM,
    PAGE2_DIRECTOR_MIN_MM,
  );
  const p2C = splitVisualLinesAt(remCounselor, page2Alloc.counselorLines);
  const p2D = splitVisualLinesAt(remDirector, page2Alloc.directorLines);

  remCounselor = wrapNoteToVisualLines(joinVisualLines(p2C.tail), EXTRA_PAGE_CHARS_PER_LINE);
  remDirector = wrapNoteToVisualLines(joinVisualLines(p2D.tail), EXTRA_PAGE_CHARS_PER_LINE);

  // 3. Create Page 3 (and Page 4+ if massive) as continuation pages for Page 2 overflow
  const extraPages: PageNotesSlice[] = [];
  const continuationBudgetMm = 258; // 287mm usable - heading - footer - safety
  while (remCounselor.length > 0 || remDirector.length > 0) {
    const hasC = remCounselor.length > 0;
    const hasD = remDirector.length > 0;
    const minC = hasC ? 16 : 0;
    const minD = hasD ? 16 : 0;

    let cLines = 0;
    let dLines = 0;
    if (hasC && !hasD) {
      cLines = Math.max(1, linesFittingHeight(continuationBudgetMm));
    } else if (!hasC && hasD) {
      dLines = Math.max(1, linesFittingHeight(continuationBudgetMm));
    } else {
      const alloc = allocateTwoSections(remCounselor.length, remDirector.length, continuationBudgetMm, minC, minD);
      cLines = Math.max(1, alloc.counselorLines);
      dLines = alloc.directorLines;
    }

    const nextC = splitVisualLinesAt(remCounselor, cLines);
    const nextD = splitVisualLinesAt(remDirector, dLines);
    extraPages.push({
      counselor: nextC.head,
      director: nextD.head,
    });
    remCounselor = nextC.tail;
    remDirector = nextD.tail;
  }

  return {
    page1: { counselor: p1C.head, director: p1D.head },
    page2: { counselor: p2C.head, director: p2D.head },
    extraPages,
  };
}
