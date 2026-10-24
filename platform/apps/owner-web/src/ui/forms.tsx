import {
  forwardRef,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import { Button, IconButton, ProgressBar } from './primitives';

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  prefixIcon?: Parameters<typeof Icon>[0]['name'];
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, required, id, prefixIcon, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  return (
    <label className={`field ${error ? 'field-invalid' : ''} ${className}`.trim()} htmlFor={fieldId}>
      <span className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <span className="field-control">
        {prefixIcon ? <Icon name={prefixIcon} size={18} /> : null}
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? descriptionId : undefined}
          {...props}
        />
      </span>
      {error ? (
        <span className="field-message field-error" id={descriptionId} role="alert">{error}</span>
      ) : hint ? (
        <span className="field-message" id={descriptionId}>{hint}</span>
      ) : null}
    </label>
  );
});

export function PasswordField(props: Omit<FieldProps, 'type'>) {
  const [visible, setVisible] = useState(false);
  const { label, error, hint, required, id, className = '', ...inputProps } = props;
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  return (
    <label className={`field ${error ? 'field-invalid' : ''} ${className}`.trim()} htmlFor={fieldId}>
      <span className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <span className="field-control field-password">
        <Icon name="key" size={18} />
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? descriptionId : undefined}
          {...inputProps}
        />
        <IconButton
          type="button"
          icon={visible ? 'eye-off' : 'eye'}
          label={visible ? 'Şifrəni gizlət' : 'Şifrəni göstər'}
          onClick={() => setVisible((current) => !current)}
        />
      </span>
      {error ? (
        <span className="field-message field-error" id={descriptionId} role="alert">{error}</span>
      ) : hint ? (
        <span className="field-message" id={descriptionId}>{hint}</span>
      ) : null}
    </label>
  );
}

export function Checkbox({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div className="checkbox-group">
      <label className="checkbox" htmlFor={id}>
        <input id={id} type="checkbox" aria-invalid={Boolean(error)} {...props} />
        <span className="checkbox-box"><Icon name="check" size={14} /></span>
        <span>{label}</span>
      </label>
      {error ? <span className="field-message field-error" role="alert">{error}</span> : null}
    </div>
  );
}

export function SelectField({
  label,
  error,
  hint,
  children,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  return (
    <label className={`field ${error ? 'field-invalid' : ''}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <span className="select-control">
        <select
          id={fieldId}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? descriptionId : undefined}
          {...props}
        >
          {children}
        </select>
        <Icon name="chevron-down" size={18} />
      </span>
      {error ? <span className="field-message field-error" id={descriptionId}>{error}</span> :
        hint ? <span className="field-message" id={descriptionId}>{hint}</span> : null}
    </label>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  return (
    <label className={`field ${error ? 'field-invalid' : ''}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <textarea
        id={fieldId}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? descriptionId : undefined}
        {...props}
      />
      {error ? <span className="field-message field-error" id={descriptionId}>{error}</span> :
        hint ? <span className="field-message" id={descriptionId}>{hint}</span> : null}
    </label>
  );
}

export function FileUpload({
  onUpload,
  busy,
  progress,
  error,
  onCancel,
}: {
  onUpload: (file: File) => void;
  busy: boolean;
  progress: number;
  error?: string;
  onCancel?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);

  const choose = (file?: File) => {
    if (!file) return;
    setSelected(file);
  };

  return (
    <div className="upload">
      <div
        className={`upload-drop ${dragging ? 'dragging' : ''} ${error ? 'upload-invalid' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files[0]);
        }}
      >
        <span className="upload-icon"><Icon name="upload" size={26} /></span>
        <strong>{selected ? selected.name : 'Diaqnostika faylını buraya buraxın'}</strong>
        <p>LOG, TXT, JSON və ya ZIP · maksimum 10 MB</p>
        <Button type="button" size="sm" onClick={() => inputRef.current?.click()}>
          Fayl seç
        </Button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".log,.txt,.json,.zip,text/plain,application/json,application/zip"
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      {error ? <p className="field-message field-error" role="alert">{error}</p> : null}
      {busy ? (
        <div className="upload-progress">
          <div><span>Yüklənir</span><strong>{progress}%</strong></div>
          <ProgressBar value={progress} label="Fayl yüklənməsi" />
          {onCancel ? <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Ləğv et</Button> : null}
        </div>
      ) : selected ? (
        <Button type="button" variant="primary" icon="upload" onClick={() => onUpload(selected)}>
          Dəstəyə göndər
        </Button>
      ) : null}
    </div>
  );
}
