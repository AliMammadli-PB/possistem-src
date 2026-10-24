import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    iconAfter,
    children,
    disabled,
    className = '',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`button button-${variant} button-${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
      {iconAfter && !loading ? <Icon name={iconAfter} size={18} /> : null}
    </button>
  );
});

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  className = '',
  children,
  ...props
}: LinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconAfter?: IconName;
}) {
  return (
    <Link
      className={`button button-${variant} button-${size} ${className}`.trim()}
      {...props}
    >
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
      {iconAfter ? <Icon name={iconAfter} size={18} /> : null}
    </Link>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName;
  label: string;
}) {
  return (
    <button
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Card({
  className = '',
  interactive = false,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { interactive?: boolean }) {
  return (
    <section
      className={`card ${interactive ? 'card-interactive' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className = '',
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const icon: IconName =
    tone === 'success' ? 'check' : tone === 'warning' || tone === 'danger' ? 'warning' : 'info';
  return (
    <div className={`alert alert-${tone} ${className}`.trim()} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="alert-icon"><Icon name={icon} size={20} /></span>
      <div className="alert-content">
        <strong>{title}</strong>
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="alert-action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  width,
  height = 16,
  className = '',
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

type StateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
};

function StateView({
  icon,
  tone,
  title,
  description,
  action,
  compact,
}: StateProps & { icon: IconName; tone: string }) {
  return (
    <div className={`state-view state-${tone} ${compact ? 'state-compact' : ''}`.trim()}>
      <span className="state-icon"><Icon name={icon} size={compact ? 24 : 32} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return <StateView {...props} icon="file" tone="empty" />;
}

export function ErrorState(props: StateProps) {
  return <StateView {...props} icon="warning" tone="error" />;
}

export function SuccessState(props: StateProps) {
  return <StateView {...props} icon="check" tone="success" />;
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label?: string;
}) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" aria-label={label} role="progressbar" aria-valuenow={safeValue} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${safeValue}%` }} />
    </div>
  );
}

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="tooltip" tabIndex={0}>
      {children}
      <span className="tooltip-content" role="tooltip">{label}</span>
    </span>
  );
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  empty,
  selectedKey,
  onRowSelect,
}: {
  caption: string;
  columns: Array<{ key: string; label: string; render: (row: T) => ReactNode }>;
  rows: T[];
  getRowKey: (row: T) => string;
  empty: ReactNode;
  selectedKey?: string;
  onRowSelect?: (row: T) => void;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = getRowKey(row);
            const selected = selectedKey === key;
            return (
              <tr
                key={key}
                className={selected ? 'is-selected' : undefined}
                aria-selected={onRowSelect ? selected : undefined}
                tabIndex={onRowSelect ? 0 : undefined}
                onClick={
                  onRowSelect
                    ? (event) => {
                        if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
                        onRowSelect(row);
                      }
                    : undefined
                }
                onKeyDown={
                  onRowSelect
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowSelect(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <td key={column.key} data-label={column.label}>{column.render(row)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
