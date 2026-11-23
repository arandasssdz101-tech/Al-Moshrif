import type { SchoolClass } from '@/db/types';

export const CLASS_LEVELS = [1, 2, 3, 4] as const;

function toAsciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0));
}

export function guessClassLevel(name: string): number | null {
  const match = /^\s*(\d)/.exec(toAsciiDigits(name));
  if (!match) return null;
  const level = Number(match[1]);
  return (CLASS_LEVELS as readonly number[]).includes(level) ? level : null;
}

export function classLevelOf(schoolClass: Pick<SchoolClass, 'name' | 'level'>): number | null {
  return schoolClass.level !== undefined ? schoolClass.level : guessClassLevel(schoolClass.name);
}
