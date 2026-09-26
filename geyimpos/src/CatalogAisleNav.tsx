import { categoryLabel, tr } from './i18n';
import { sortAisleIds } from './catalogCategories';
import { ApparelIcon } from './ApparelIcon';
import { categoryInfo } from './apparel';
import type { Lang } from './types';

type CatalogAisleNavProps = {
  lang: Lang;
  categories: string[];
  counts: Map<string, number>;
  total: number;
  value: string;
  onChange: (category: string) => void;
  /** Vertical rail (sale/inventory catalog) vs horizontal chips. */
  layout?: 'rail' | 'chips';
};

export function CatalogAisleNav({
  lang,
  categories,
  counts,
  total,
  value,
  onChange,
  layout = 'rail',
}: CatalogAisleNavProps) {
  const ordered = sortAisleIds(categories);
  const className = layout === 'chips' ? 'category-tabs catalog-aisle-chips' : 'catalog-aisle-rail';

  return (
    <nav className={className} aria-label={tr(lang, 'catalogAisles')}>
      <button
        type="button"
        className={value === 'all' ? 'active' : ''}
        aria-pressed={value === 'all'}
        onClick={() => onChange('all')}
      >
        <span>{tr(lang, 'all')}</span>
        <b>{total}</b>
      </button>
      {ordered.map((item) => (
        <button
          type="button"
          key={item}
          className={value === item ? 'active' : ''}
          aria-pressed={value === item}
          onClick={() => onChange(item)}
        >
          {layout === 'chips' && <ApparelIcon icon={categoryInfo(item).icon} size={18} />}
          <span>{categoryLabel(item, lang)}</span>
          <b>{counts.get(item) ?? 0}</b>
        </button>
      ))}
    </nav>
  );
}
