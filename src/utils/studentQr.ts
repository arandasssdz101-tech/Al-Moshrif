import QRCode from 'qrcode';
import type { BoardingStatus, CanteenMatchField, Student } from '@/db/types';
import { PERIODS } from '@/utils/schedule';

export type ExtendedRegime = BoardingStatus | 'boarder';

export interface StudentQrData {
  id: string;
  fullName: string;
  className: string;
  regime: string;
  schoolYear: string;
}

export interface ParsedStudentQr {
  id: string;
  name: string;
  className: string;
  regime: string;
  year: string;
}

const REGIME_LABELS_AR: Record<string, string> = {
  'half-boarder': 'نصف داخلي',
  boarder: 'داخلي',
  external: 'خارجي',
};

export function formatStudentRegime(status: ExtendedRegime | string): string {
  return REGIME_LABELS_AR[status] ?? status;
}

export function studentFullName(student: Pick<Student, 'firstName' | 'lastName'>): string {
  return `${student.firstName} ${student.lastName}`.replace(/\s+/g, ' ').trim();
}

export function studentRegistrationNumber(student: Pick<Student, 'id' | 'cardCode'>): string {
  const explicit = student.cardCode?.trim();
  if (explicit) return explicit;
  return student.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || student.id;
}

function sanitizeField(value: string): string {
  return value.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildStudentQrPayload(data: StudentQrData): string {
  const id = sanitizeField(data.id);
  const name = sanitizeField(data.fullName);
  const className = sanitizeField(data.className);
  const regime = sanitizeField(data.regime);
  const year = sanitizeField(data.schoolYear);
  return `ID:${id}|NAME:${name}|CLASS:${className}|REGIME:${regime}|YEAR:${year}`;
}

export function buildStudentQrForRecord(
  student: Pick<Student, 'id' | 'firstName' | 'lastName' | 'boardingStatus'>,
  className: string,
  schoolYear: string,
): string {
  return buildStudentQrPayload({
    id: student.id,
    fullName: studentFullName(student),
    className,
    regime: formatStudentRegime(student.boardingStatus),
    schoolYear,
  });
}

export function parseStudentQrPayload(rawText: string): ParsedStudentQr | null {
  const cleaned = rawText.replace(/[\r\n]+/g, '').trim();
  if (!cleaned || !cleaned.includes('|')) return null;

  const map: Record<string, string> = {};
  for (const segment of cleaned.split('|')) {
    const colon = segment.indexOf(':');
    if (colon <= 0) continue;
    const key = segment.slice(0, colon).trim().toUpperCase();
    const value = segment.slice(colon + 1).trim();
    map[key] = value;
  }

  if (!map.ID) return null;
  return {
    id: map.ID,
    name: map.NAME ?? '',
    className: map.CLASS ?? '',
    regime: map.REGIME ?? '',
    year: map.YEAR ?? '',
  };
}

export function extractNinFromPayload(rawText: string): string | null {
  const cleaned = rawText.replace(/[\r\n]+/g, '').trim();
  if (!cleaned.includes('|')) return null;
  for (const segment of cleaned.split('|')) {
    const colon = segment.indexOf(':');
    if (colon <= 0) continue;
    const key = segment.slice(0, colon).trim().toUpperCase();
    if (key === 'NIN') {
      const value = segment.slice(colon + 1).trim();
      return value || null;
    }
  }
  return null;
}

export function matchStudentFromScan(
  students: Student[],
  rawText: string,
  preferredField?: CanteenMatchField,
): Student | null {
  const cleaned = rawText.replace(/[\r\n]+/g, '').trim();
  if (!cleaned) return null;
  const active = students.filter((student) => student.deletedAt === null);

  // 1. Structured EduTrack Student QR payload: ID:<student.id>|NAME:...|CLASS:...|REGIME:...|YEAR:...
  const parsed = parseStudentQrPayload(cleaned);
  if (parsed) {
    const byId = active.find((student) => student.id === parsed.id);
    if (byId) return byId;
    const byCard = active.find((student) => (student.cardCode ?? '').trim() === parsed.id);
    if (byCard) return byCard;
  }

  // 2. National/Canteen card payload with NIN:
  const nin = extractNinFromPayload(cleaned);
  if (nin) {
    const byNin = active.find((student) => (student.cardCode ?? '').trim() === nin || student.id === nin);
    if (byNin) return byNin;
  }

  // 3. Direct code match honoring preferred field first, then fallback to ID/cardCode
  if (preferredField === 'studentId') {
    const byId = active.find((student) => student.id === cleaned);
    if (byId) return byId;
  }
  const byCardCode = active.find((student) => (student.cardCode ?? '').trim() === cleaned);
  if (byCardCode) return byCardCode;

  return active.find((student) => student.id === cleaned) ?? null;
}

export async function generateStudentQrSvg(
  payload: string,
  errorCorrectionLevel: 'M' | 'H' = 'M',
): Promise<string> {
  const utf8Bytes = new TextEncoder().encode(payload);
  return QRCode.toString([{ data: utf8Bytes, mode: 'byte' }], {
    type: 'svg',
    errorCorrectionLevel,
    margin: 4,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

export function currentPeriodNumber(now: Date = new Date()): number | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const period of PERIODS) {
    const [sh, sm] = period.start.split(':').map(Number);
    const [eh, em] = period.end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (minutes >= startMin && minutes < endMin) {
      return period.number;
    }
  }
  return null;
}
