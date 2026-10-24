import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { Button } from './primitives';

export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; to?: string }>;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Səhifə yolu">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 ? <Icon name="chevron-right" size={14} /> : null}
            {item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Tabs({
  items,
}: {
  items: Array<{ label: string; to: string; end?: boolean; badge?: number }>;
}) {
  return (
    <nav className="tabs" aria-label="Bölmələr">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end}>
          {item.label}
          {item.badge ? <span>{item.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Səhifələr">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon="chevron-left"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Əvvəlki
      </Button>
      <span><strong>{page}</strong> / {pages}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        iconAfter="chevron-right"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Növbəti
      </Button>
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
        <h1 tabIndex={-1}>{title}</h1>
        {description ? <p>{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
