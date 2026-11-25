import QRCode from 'qrcode';
import type { BoardingStatus, CanteenMatchField, Student } from '@/db/types';
import { PERIODS } from '@/utils/schedule';
import { normalizeText } from '@/utils/text';

/**
 * Fixed card issuance version embedded across cards and every backup package.
 * Must NEVER change across backups/restores/updates so printed cards are never rejected.
 */
export const STUDENT_CARD_ISSUANCE_VERSION = 1 as const;

export type ExtendedRegime = BoardingStatus | 'boarder';

export interface StudentQrData {
  id: string;
  fullName: string;
  className: string;
  regime: string;
  schoolYear: string;
  cardVersion?: number;
  stableCardKey?: string;
  cardCode?: string | null;
  dateOfBirth?: string | null;
}

export interface ParsedStudentQr {
  id: string;
  name: string;
  className: string;
  regime: string;
  year: string;
  ver?: string;
  cid?: string;
  reg?: string;
  dob?: string;
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
  return `${student.firstName ?? ''} ${student.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic, permanent card identifier derived solely from student identity
 * (normalized name + birth date). Never depends on random UUIDs, device IDs,
 * institution IDs, or backup timestamps — stays identical across every backup and re-import.
 */
export function deriveStableStudentCardKey(
  student: Pick<Student, 'firstName' | 'lastName'> & Partial<Pick<Student, 'dateOfBirth'>>,
): string {
  const canonical = [
    normalizeText(student.firstName),
    normalizeText(student.lastName),
    (student.dateOfBirth ?? '').trim(),
  ].join('|');
  const h1 = fnv1a32(canonical, 0x811c9dc5).toString(16).padStart(8, '0').toUpperCase();
  const h2 = fnv1a32(`v${STUDENT_CARD_ISSUANCE_VERSION}|${canonical}`, 0x9e3779b1)
    .toString(16)
    .padStart(8, '0')
    .slice(0, 4)
    .toUpperCase();
  return `ET-${h1}${h2}`;
}

export function studentRegistrationNumber(
  student: Pick<Student, 'id' | 'cardCode'> &
    Partial<Pick<Student, 'firstName' | 'lastName' | 'dateOfBirth'>>,
): string {
  const explicit = student.cardCode?.trim();
  if (explicit) return explicit;
  if (student.firstName || student.lastName) {
    return deriveStableStudentCardKey({
      firstName: student.firstName ?? '',
      lastName: student.lastName ?? '',
      dateOfBirth: student.dateOfBirth ?? null,
    });
  }
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
  const parts = [
    `ID:${id}`,
    `NAME:${name}`,
    `CLASS:${className}`,
    `REGIME:${regime}`,
    `YEAR:${year}`,
    `VER:${data.cardVersion ?? STUDENT_CARD_ISSUANCE_VERSION}`,
  ];
  const cid = data.stableCardKey ? sanitizeField(data.stableCardKey) : '';
  if (cid) parts.push(`CID:${cid}`);
  const reg = data.cardCode ? sanitizeField(data.cardCode) : '';
  if (reg) parts.push(`REG:${reg}`);
  const dob = data.dateOfBirth ? sanitizeField(data.dateOfBirth) : '';
  if (dob) parts.push(`DOB:${dob}`);
  return parts.join('|');
}

export function buildStudentQrForRecord(
  student: Pick<Student, 'id' | 'firstName' | 'lastName' | 'boardingStatus'> &
    Partial<Pick<Student, 'cardCode' | 'dateOfBirth'>>,
  className: string,
  schoolYear: string,
): string {
  const stableCardKey = deriveStableStudentCardKey(student);
  return buildStudentQrPayload({
    id: student.id,
    fullName: studentFullName(student),
    className,
    regime: formatStudentRegime(student.boardingStatus),
    schoolYear,
    cardVersion: STUDENT_CARD_ISSUANCE_VERSION,
    stableCardKey,
    cardCode: student.cardCode ?? null,
    dateOfBirth: student.dateOfBirth ?? null,
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
const AZERTY_MIXED_DIGITS_PATTERN = /^[0-9&éÉ"'(\-èÈ_çÇàÀ]+$/;
const HAS_AZERTY_ACCENT_OR_SYM = /[éÉèÈçÇàÀ]/;

// Full US-QWERTY -> FR-AZERTY inverse map for hardware HID scanners connected to a French AZERTY OS
const FULL_AZERTY_TO_QWERTY_MAP: Record<string, string> = {
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
  ')': '-',
  '°': '_',
  a: 'q',
  A: 'Q',
  q: 'a',
  Q: 'A',
  z: 'w',
  Z: 'W',
  w: 'z',
  W: 'Z',
  m: ';',
  M: ':',
  ',': 'm',
  '?': 'M',
  ';': ',',
  '.': '.',
  ':': '/',
  '!': '/',
  '§': '?',
  '*': '\\',
  'µ': '|',
  'ù': "'",
  '%': '"',
  '^': '[',
  '$': ']',
  '¨': '{',
  '£': '}',
};

// Top-row + hyphen AZERTY -> QWERTY variant (when scanner/IME keeps A/Q/Z/W/M intact)
const TOP_ROW_AZERTY_TO_QWERTY_MAP: Record<string, string> = {
  ...AZERTY_DIGIT_MAP,
  ')': '-',
  '°': '_',
  'µ': '|',
};

// Arabic 101/102 Windows layout -> US-QWERTY lowercase/symbol map for ASCII IDs/codes scanned under Arabic layout
const ARABIC_101_TO_QWERTY_MAP: Record<string, string> = {
  '\u0636': 'q', // ض
  '\u0635': 'w', // ص
  '\u062B': 'e', // ث
  '\u0642': 'r', // ق
  '\u0641': 't', // ف
  '\u063A': 'y', // غ
  '\u0639': 'u', // ع
  '\u0647': 'i', // ه
  '\u062E': 'o', // خ
  '\u062D': 'p', // ح
  '\u062C': '[', // ج
  '\u062F': ']', // د
  '\u0634': 'a', // ش
  '\u0633': 's', // س
  '\u064A': 'd', // ي
  '\u0628': 'f', // ب
  '\u0644': 'g', // ل
  '\u0627': 'h', // ا
  '\u062A': 'j', // ت
  '\u0646': 'k', // ن
  '\u0645': 'l', // م
  '\u0643': ';', // ك
  '\u0637': "'", // ط
  '\u0626': 'z', // ئ
  '\u0621': 'x', // ء
  '\u0624': 'c', // ؤ
  '\u0631': 'v', // ر
  '\u0649': 'n', // ى
  '\u0629': 'm', // ة
  '\u0648': ',', // و
  '\u0632': '.', // ز
  '\u0638': '/', // ظ
  '\u0630': '`', // ذ
  '\u060C': ',', // ،
  '\u061B': ';', // ؛
  '\u061F': '?', // ؟
};

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
    out += code === 0x00a0 ? ' ' : input[i];
  }
  return out;
}

function convertArabicDigitsToLatin(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

function mapChars(input: string, table: Record<string, string>): string {
  let out = '';
  for (const ch of input) {
    out += table[ch] ?? ch;
  }
  return out;
}

function recoverArabic101ToQwerty(input: string): string {
  // Handle Windows Arabic ligature 'لا' (which is Shift+G / B on Arabic keyboard)
  const replacedLigature = input.replace(/\u0644\u0627/g, 'b');
  return mapChars(replacedLigature, ARABIC_101_TO_QWERTY_MAP);
}

export function buildKeyboardRecoveryCandidates(cleaned: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (val: string) => {
    const trimmed = val.trim();
    if (trimmed && trimmed !== cleaned && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  if (/[&éÉ"'(\-èÈ_çÇàÀ)°aAqQzZwWmM,;.:!*µ§ù%]/.test(cleaned)) {
    pushUnique(mapChars(cleaned, FULL_AZERTY_TO_QWERTY_MAP));
    pushUnique(mapChars(cleaned, TOP_ROW_AZERTY_TO_QWERTY_MAP));
  }

  if (/[\u0600-\u06FF]/.test(cleaned)) {
    pushUnique(recoverArabic101ToQwerty(cleaned));
  }

  return candidates;
}

export function normalizeScannedCode(rawText: string, options: NormalizeScanOptions = {}): string {
  const { convertAzertyDigits = true } = options;

  // 1. Remove ASCII control chars (including \r, \n, \t) & invisible Unicode control/format chars, then trim
  let cleaned = stripControlChars(rawText).trim();

  if (!cleaned) return '';

  // 2. Convert Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits to Latin (0-9)
  cleaned = convertArabicDigitsToLatin(cleaned);

  // 3. Optional French AZERTY reader fix for numeric/top-row symbol barcodes
  if (
    convertAzertyDigits &&
    (AZERTY_ONLY_PATTERN.test(cleaned) ||
      (AZERTY_MIXED_DIGITS_PATTERN.test(cleaned) && HAS_AZERTY_ACCENT_OR_SYM.test(cleaned)))
  ) {
    cleaned = Array.from(cleaned)
      .map((ch) => AZERTY_DIGIT_MAP[ch] ?? ch)
      .join('');
  }

  return cleaned;
}

export function parseStudentQrPayload(rawText: string): ParsedStudentQr | null {
  const cleaned = stripControlChars(rawText).trim();
  if (!cleaned || !cleaned.includes('|')) return null;

  const map: Record<string, string> = {};
  for (const segment of cleaned.split('|')) {
    const colon = segment.indexOf(':');
    if (colon <= 0) continue;
    const key = segment.slice(0, colon).trim().toUpperCase();
    const value = convertArabicDigitsToLatin(segment.slice(colon + 1)).trim();
    map[key] = value;
  }

  if (!map.ID && !map.CID && !map.REG) return null;
  return {
    id: map.ID ?? '',
    name: map.NAME ?? '',
    className: map.CLASS ?? '',
    regime: map.REGIME ?? '',
    year: map.YEAR ?? '',
    ...(map.VER ? { ver: map.VER } : {}),
    ...(map.CID ? { cid: map.CID } : {}),
    ...(map.REG ? { reg: map.REG } : {}),
    ...(map.DOB ? { dob: map.DOB } : {}),
  };
}

export function extractNinFromPayload(rawText: string): string | null {
  const cleaned = stripControlChars(rawText).trim();
  if (!cleaned.includes('|')) return null;
  let snFallback: string | null = null;
  for (const segment of cleaned.split('|')) {
    const colon = segment.indexOf(':');
    if (colon <= 0) continue;
    const key = segment.slice(0, colon).trim().toUpperCase();
    const value = convertArabicDigitsToLatin(segment.slice(colon + 1)).trim();
    if (!value) continue;
    if (key === 'NIN') {
      return value;
    }
    if (key === 'SN' && !snFallback) {
      snFallback = value;
    }
  }
  return snFallback;
}

function findUniqueCaseInsensitive<T>(items: T[], selector: (item: T) => string, target: string): T | null {
  const needle = target.trim().toLowerCase();
  if (!needle) return null;
  const matches = items.filter((item) => selector(item).trim().toLowerCase() === needle);
  return matches.length === 1 ? matches[0] : (matches[0] ?? null);
}

/**
 * Backup-proof matching for structured student QR payloads:
 * 1. Exact (then case-insensitive) student.id match
 * 2. Exact (then case-insensitive) student.cardCode match against REG: or ID:
 * 3. Deterministic permanent card key match against CID: or ID:
 * 4. Safe normalized full-name (+ DOB when present) recovery for legacy cards whose UUID changed across backups/re-imports
 */
export function matchStudentByParsedQr(
  activeStudents: Student[],
  parsed: ParsedStudentQr,
  options: { allowNameFallback?: boolean } = {},
): Student | null {
  const { allowNameFallback = true } = options;

  // 1. ID match (exact then case-insensitive for CapsLock safety)
  if (parsed.id) {
    const byId =
      activeStudents.find((student) => student.id === parsed.id) ??
      findUniqueCaseInsensitive(activeStudents, (student) => student.id, parsed.id);
    if (byId) return byId;
  }

  // 2. Explicit cardCode / REG match (exact then case-insensitive)
  if (parsed.reg) {
    const byReg =
      activeStudents.find((student) => (student.cardCode ?? '').trim() === parsed.reg) ??
      findUniqueCaseInsensitive(activeStudents, (student) => student.cardCode ?? '', parsed.reg);
    if (byReg) return byReg;
  }
  if (parsed.id) {
    const byCard =
      activeStudents.find((student) => (student.cardCode ?? '').trim() === parsed.id) ??
      findUniqueCaseInsensitive(activeStudents, (student) => student.cardCode ?? '', parsed.id);
    if (byCard) return byCard;
  }

  // 3. Deterministic permanent card key (CID) — identical across every backup/device/re-import
  if (parsed.cid) {
    const byCid =
      activeStudents.find((student) => deriveStableStudentCardKey(student) === parsed.cid) ??
      findUniqueCaseInsensitive(activeStudents, (student) => deriveStableStudentCardKey(student), parsed.cid);
    if (byCid) return byCid;
  }
  if (parsed.id) {
    const byStableId =
      activeStudents.find((student) => deriveStableStudentCardKey(student) === parsed.id) ??
      findUniqueCaseInsensitive(activeStudents, (student) => deriveStableStudentCardKey(student), parsed.id);
    if (byStableId) return byStableId;
  }

  // 4. Safe fallback for already-printed legacy cards whose internal UUID changed after restoring another backup or re-importing Excel
  if (allowNameFallback) {
    const normalizedName = normalizeText(parsed.name);
    if (normalizedName) {
      const nameMatches = activeStudents.filter((student) => {
        const forward = normalizeText(`${student.firstName} ${student.lastName}`);
        const reversed = normalizeText(`${student.lastName} ${student.firstName}`);
        return forward === normalizedName || reversed === normalizedName;
      });

      if (parsed.dob && nameMatches.length > 0) {
        const dobMatches = nameMatches.filter((student) => (student.dateOfBirth ?? '').trim() === parsed.dob);
        if (dobMatches.length === 1) return dobMatches[0];
      }

      if (nameMatches.length === 1) {
        return nameMatches[0];
      }
    }
  }

  return null;
}

function matchDirectCode(
  active: Student[],
  code: string,
  preferredField?: CanteenMatchField,
): Student | null {
  if (!code) return null;

  if (preferredField === 'studentId') {
    const byId =
      active.find((student) => student.id === code) ??
      findUniqueCaseInsensitive(active, (student) => student.id, code);
    if (byId) return byId;
  }

  const byCardCode =
    active.find((student) => (student.cardCode ?? '').trim() === code) ??
    findUniqueCaseInsensitive(active, (student) => student.cardCode ?? '', code);
  if (byCardCode) return byCardCode;

  const byId =
    active.find((student) => student.id === code) ??
    findUniqueCaseInsensitive(active, (student) => student.id, code);
  if (byId) return byId;

  return (
    active.find((student) => deriveStableStudentCardKey(student) === code) ??
    findUniqueCaseInsensitive(active, (student) => deriveStableStudentCardKey(student), code)
  );
}

function matchNormalizedCandidate(
  active: Student[],
  candidate: string,
  preferredField?: CanteenMatchField,
  allowNameFallback = true,
): Student | null {
  // 1. Structured EduTrack Student QR payload
  const parsed = parseStudentQrPayload(candidate);
  if (parsed) {
    return matchStudentByParsedQr(active, parsed, { allowNameFallback });
  }

  // 2. National/Canteen card payload with NIN or SN
  const nin = extractNinFromPayload(candidate);
  if (nin) {
    const byNin = matchDirectCode(active, nin, preferredField);
    if (byNin) return byNin;
  }

  // 3. Direct code match honoring preferred field first, then fallback to cardCode / ID / permanent key
  return matchDirectCode(active, candidate, preferredField);
}

export function matchStudentFromScan(
  students: Student[],
  rawText: string,
  preferredField?: CanteenMatchField,
): Student | null {
  const active = students.filter((student) => student.deletedAt == null);
  const rawCleaned = convertArabicDigitsToLatin(stripControlChars(rawText).trim());
  if (!rawCleaned) return null;

  // 1. Try direct/cleaned input first (preserves hyphens and exact literals)
  const directMatch = matchNormalizedCandidate(active, rawCleaned, preferredField, true);
  if (directMatch) return directMatch;

  // 2. Try standard normalization (AZERTY top-row digits, etc.)
  const normalized = normalizeScannedCode(rawText, { convertAzertyDigits: true });
  if (normalized && normalized !== rawCleaned) {
    const normalizedMatch = matchNormalizedCandidate(active, normalized, preferredField, true);
    if (normalizedMatch) return normalizedMatch;
  }

  // 3. Fallback: recover hardware USB/Bluetooth scans garbled by French AZERTY or Arabic-101 OS layout
  for (const candidate of buildKeyboardRecoveryCandidates(rawCleaned)) {
    const recovered = matchNormalizedCandidate(active, candidate, preferredField, false);
    if (recovered) return recovered;
  }

  return null;
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
