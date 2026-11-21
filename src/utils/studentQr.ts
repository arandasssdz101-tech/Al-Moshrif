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

const GENDER_LABELS_AR: Record<string, string> = {
  male: 'ذكر',
  female: 'أنثى',
};

export function formatStudentRegime(status: ExtendedRegime | string): string {
  return REGIME_LABELS_AR[status] ?? status;
}

export function formatStudentGender(gender: Student['gender'] | string): string {
  return GENDER_LABELS_AR[gender] ?? gender;
}

export function formatCardBirthDate(dateOfBirth: string | null | undefined): string {
  const cleaned = dateOfBirth?.trim() ?? '';
  if (!cleaned) return '—';
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  return cleaned;
}

export function formatCardBirthPlace(placeOfBirth: string | null | undefined): string {
  return placeOfBirth?.trim() || '—';
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

const AZERTY_DIGIT_MAP: Record<string, string> = {
  '&': '1',
  'é': '2',
  'É': '2',
  '"': '3',
  "'": '4',
  '(': '5',
  '-': '6',
  'è': '7',
  'È': '7',
  '_': '8',
  'ç': '9',
  'Ç': '9',
  'à': '0',
  'À': '0',
};

const AZERTY_ONLY_PATTERN = /^[&éÉ"'(\-èÈ_çÇàÀ]+$/;

export interface NormalizeScanOptions {
  convertAzertyDigits?: boolean;
}

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (
      code <= 0x1f ||
      code === 0x7f ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      code === 0xfeff
    ) {
      continue;
    }
    out += input[i];
  }
  return out;
}

export function normalizeScannedCode(rawText: string, options: NormalizeScanOptions = {}): string {
  const { convertAzertyDigits = true } = options;

  // 1. Remove ASCII control chars (including \r, \n, \t) & invisible Unicode control/format chars, then trim
  let cleaned = stripControlChars(rawText).trim();

  if (!cleaned) return '';

  // 2. Convert Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to Latin (0-9)
  cleaned = cleaned
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));

  // 3. Optional French AZERTY reader fix: only when entire string consists of AZERTY top-row symbols
  if (convertAzertyDigits && AZERTY_ONLY_PATTERN.test(cleaned)) {
    cleaned = Array.from(cleaned)
      .map((ch) => AZERTY_DIGIT_MAP[ch] ?? ch)
      .join('');
  }

  return cleaned;
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
