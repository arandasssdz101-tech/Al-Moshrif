import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { LIBRARY_CATEGORIES, type LibraryCategory, type LibraryMeta } from '@/db/types';

interface EditLibraryItemModalProps {
  item: LibraryMeta | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (id: string, title: string, category: LibraryCategory) => void;
}

export function EditLibraryItemModal({
  item,
  busy = false,
  onClose,
  onSave,
}: EditLibraryItemModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<LibraryCategory>('other');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (item) {
      setTitle(item.title);
      setCategory(item.category);
      setError(undefined);
    }
  }, [item]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!item) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t('validation.required'));
      return;
    }
    onSave(item.id, trimmed, category);
  };

  return (
    <Modal open={item !== null} title={t('library.editModal.title')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField
          label={t('library.editModal.nameLabel')}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(undefined);
          }}
          error={error}
          autoFocus
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-neutral-700">
            {t('library.editModal.categoryLabel')}
          </span>
          <div className="flex flex-wrap gap-2">
            {LIBRARY_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  aria-pressed={active}
                  className={`min-h-11 rounded-xl px-3.5 text-sm font-medium ring-1 transition ${
                    active
                      ? 'bg-primary-600 text-white ring-primary-600'
                      : 'bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {t(`library.categories.${cat}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
