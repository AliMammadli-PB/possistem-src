'use client';

import { FormEvent, useRef, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { T } from './T';

type FieldErrors = Record<string, string>;
type FieldName = 'name' | 'businessName' | 'phone';

export function LeadForm() {
  const { t } = useI18n();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPayloadRef = useRef<Record<string, string> | null>(null);
  const [status, setStatus] = useState<{ type: '' | 'success' | 'error'; message: string }>({
    type: '',
    message: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const validateField = (field: FieldName, form: HTMLFormElement) => {
    const value = (form.elements.namedItem(field) as HTMLInputElement).value.trim();
    let message = '';

    if (field === 'name' && value.length < 2) message = t('form.error.name');
    if (field === 'businessName' && value.length < 2) message = t('form.error.businessName');
    if (field === 'phone' && !/^[0-9+()\s-]{7,32}$/.test(value)) message = t('form.error.phone');

    setErrors((current) => {
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });

    return !message;
  };

  const validate = (form: HTMLFormElement) => {
    const nextErrors: FieldErrors = {};
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
    const businessName = (form.elements.namedItem('businessName') as HTMLInputElement).value.trim();
    const phone = (form.elements.namedItem('phone') as HTMLInputElement).value.trim();

    if (name.length < 2) nextErrors.name = t('form.error.name');
    if (businessName.length < 2) nextErrors.businessName = t('form.error.businessName');
    if (!/^[0-9+()\s-]{7,32}$/.test(phone)) nextErrors.phone = t('form.error.phone');

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const focusErrorSummary = () => {
    requestAnimationFrame(() => errorSummaryRef.current?.focus());
  };

  const onBlur = (event: FormEvent<HTMLInputElement>) => {
    const field = event.currentTarget.name as FieldName;
    if (field === 'name' || field === 'businessName' || field === 'phone') {
      validateField(field, event.currentTarget.form!);
    }
  };

  const sendPayload = async (payload: Record<string, string>, form?: HTMLFormElement) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus({ type: 'error', message: t('form.offline') });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastPayloadRef.current = payload;

    setSubmitting(true);
    setStatus({ type: '', message: '' });

    try {
      const response = await fetch('/pos/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || t('form.requestError'));

      form?.reset();
      setErrors({});
      lastPayloadRef.current = null;
      setStatus({ type: 'success', message: `${t('form.success')} ${t('form.successNext')}` });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus({ type: 'error', message: t('form.failure') });
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    if (!validate(form)) {
      setStatus({ type: 'error', message: t('form.error.invalid') });
      focusErrorSummary();
      return;
    }

    const formData = new FormData(form);
    const payload = {
      name: String(formData.get('name') ?? '').trim(),
      businessName: String(formData.get('businessName') ?? '').trim(),
      phone: String(formData.get('phone') ?? '').replace(/[^\d+()\s-]/g, '').trim(),
      city: String(formData.get('city') ?? '').trim().slice(0, 120),
      message: String(formData.get('message') ?? '').trim().slice(0, 2000),
      website: String(formData.get('website') ?? '').trim(),
      source: 'possistem.az',
    };

    await sendPayload(payload, form);
  };

  const onRetry = () => {
    if (!lastPayloadRef.current || submitting) return;
    void sendPayload(lastPayloadRef.current);
  };

  const errorEntries = Object.entries(errors);

  return (
    <form className="marketing-form reveal" id="leadForm" noValidate onSubmit={onSubmit}>
      <div className="form-heading">
        <div>
          <span>
            <T k="index.text.115" />
          </span>
          <small>
            <T k="index.text.116" />
          </small>
        </div>
        <b>
          <T k="index.text.117" />
        </b>
      </div>

      {errorEntries.length > 0 ? (
        <div
          ref={errorSummaryRef}
          className="form-error-summary"
          role="alert"
          tabIndex={-1}
          aria-labelledby="formErrorTitle"
        >
          <h2 id="formErrorTitle">{t('form.error.summaryTitle')}</h2>
          <ul>
            {errors.name ? (
              <li>
                <a href="#lead-name">{errors.name}</a>
              </li>
            ) : null}
            {errors.businessName ? (
              <li>
                <a href="#lead-business">{errors.businessName}</a>
              </li>
            ) : null}
            {errors.phone ? (
              <li>
                <a href="#lead-phone">{errors.phone}</a>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="form-two">
        <label className="marketing-field">
          <span>
            <T k="index.text.118" /> <b>*</b>
          </span>
          <input
            id="lead-name"
            name="name"
            type="text"
            autoComplete="name"
            minLength={2}
            maxLength={120}
            required
            placeholder={t('index.attr.119')}
            aria-describedby="nameError"
            className={errors.name ? 'invalid' : undefined}
            aria-invalid={Boolean(errors.name)}
            onBlur={onBlur}
          />
          <small id="nameError" role={errors.name ? 'alert' : undefined}>
            {errors.name}
          </small>
        </label>
        <label className="marketing-field">
          <span>
            <T k="index.text.120" /> <b>*</b>
          </span>
          <input
            id="lead-business"
            name="businessName"
            type="text"
            autoComplete="organization"
            minLength={2}
            maxLength={200}
            required
            placeholder={t('index.attr.121')}
            aria-describedby="businessNameError"
            className={errors.businessName ? 'invalid' : undefined}
            aria-invalid={Boolean(errors.businessName)}
            onBlur={onBlur}
          />
          <small id="businessNameError" role={errors.businessName ? 'alert' : undefined}>
            {errors.businessName}
          </small>
        </label>
      </div>
      <div className="form-two">
        <label className="marketing-field">
          <span>
            <T k="index.text.122" /> <b>*</b>
          </span>
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            minLength={7}
            maxLength={32}
            pattern="[0-9+()\s-]{7,32}"
            required
            placeholder={t('index.attr.123')}
            aria-describedby="phoneError"
            className={errors.phone ? 'invalid' : undefined}
            aria-invalid={Boolean(errors.phone)}
            onBlur={onBlur}
          />
          <small id="phoneError" role={errors.phone ? 'alert' : undefined}>
            {errors.phone}
          </small>
        </label>
        <label className="marketing-field">
          <span>
            <T k="index.text.124" />
          </span>
          <input
            name="city"
            type="text"
            autoComplete="address-level2"
            maxLength={120}
            placeholder={t('index.attr.125')}
          />
          <small />
        </label>
      </div>
      <label className="marketing-field">
        <span>
          <T k="index.text.126" />
        </span>
        <textarea
          name="message"
          rows={4}
          maxLength={2000}
          placeholder={t('index.attr.127')}
        />
        <small>
          <T k="index.text.128" />
        </small>
      </label>
      <div className="bot-field" aria-hidden="true">
        <label>
          <T k="index.text.129" />
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button className="marketing-button primary form-submit" type="submit" disabled={submitting} aria-busy={submitting}>
        <span>{submitting ? t('form.sending') : t('form.submit')}</span>
        <span className="inline-glyph" aria-hidden="true" />
      </button>
      <p className="form-privacy">
        <T k="index.text.131" />
      </p>
      <div className={`form-status ${status.type}`.trim()} id="formStatus" role="status" aria-live="polite">
        {status.message}
        {status.type === 'error' && lastPayloadRef.current ? (
          <button type="button" className="form-retry" onClick={onRetry} disabled={submitting}>
            {t('form.retry')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
