import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { Student } from '@/db/types';

interface StudentListItemProps {
  student: Student;
  className: string;
  left: boolean;
  onOpen: () => void;
}

export function StudentListItem({ student, className, left, onOpen }: StudentListItemProps) {
  const { t } = useTranslation();
  const initials = `${student.lastName.charAt(0)}${student.firstName.charAt(0)}`.toUpperCase();

  return (
    <li className="animate-fade-in">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-16 w-full items-start gap-3.5 rounded-2xl bg-white p-4 text-start shadow-sm ring-1 ring-neutral-200 transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:items-center"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary-50 text-base font-bold text-secondary-700">
          {initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-base leading-snug text-neutral-900">
            <span className="break-words font-bold text-neutral-900">{student.lastName}</span>
            <span className="break-words font-medium text-neutral-700">{student.firstName}</span>
          </span>
          <span className="text-sm font-medium text-neutral-500">{className}</span>
          <span className="flex flex-wrap gap-1.5 pt-1">
            <Tag>{t(`students.gender.${student.gender}`)}</Tag>
            <Tag>{t(`students.boarding.${student.boardingStatus}`)}</Tag>
            {student.repeater ? <Tag tone="warning">{t('students.repeater')}</Tag> : null}
            {left ? <Tag tone="muted">{t('students.left')}</Tag> : null}
          </span>
        </span>
        <ChevronRight className="mt-1 size-5 shrink-0 text-neutral-400 sm:mt-0 rtl:-scale-x-100" aria-hidden />
      </button>
    </li>
  );
}

const TAG_TONES = {
  neutral: 'bg-neutral-100 text-neutral-700',
  warning: 'bg-warning-50 text-warning-700',
  muted: 'bg-neutral-200 text-neutral-600',
} as const;

function Tag({ children, tone = 'neutral' }: { children: string; tone?: keyof typeof TAG_TONES }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TAG_TONES[tone]}`}>{children}</span>;
}
