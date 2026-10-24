'use client';

import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/components/providers/I18nProvider';
import type { Language } from '@/lib/i18n';

const LANGUAGES: { code: Language; label: string; nameKey: string; native: string; flag: string }[] = [
  { code: 'az', label: 'AZ', nameKey: 'common.language.az', native: 'Azərbaycan dili', flag: 'az' },
  { code: 'en', label: 'EN', nameKey: 'common.language.en', native: 'English', flag: 'gb' },
  { code: 'ru', label: 'RU', nameKey: 'common.language.ru', native: 'Русский', flag: 'ru' },
];
const HINT = { az: 'Seçiminiz yadda saxlanılır', en: 'Your choice is remembered', ru: 'Ваш выбор сохраняется' };
function Globe() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9Z" /></svg>; }

export function LanguageSelector() {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 284, maxHeight: 320 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef(0);
  const id = useId();
  const current = LANGUAGES.find((item) => item.code === language) ?? LANGUAGES[0]!;
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(284, window.innerWidth - 24);
    const top = rect.bottom + 10;
    setPosition({ left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top, width, maxHeight: Math.max(0, window.innerHeight - top - 12) });
  }, []);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus(); };
  const show = (index = LANGUAGES.findIndex((item) => item.code === language)) => {
    requestedFocus.current = Math.max(0, index); place(); setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    };
    const focusOutside = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    place();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[requestedFocus.current]?.focus();
  }, [open]);

  return <div className="language-selector" ref={rootRef}>
    <button ref={triggerRef} id={`${id}-trigger`} type="button" className={`language-selector-trigger${open ? ' is-open' : ''}`}
      aria-label={`${t('common.languageLabel')}: ${t(current.nameKey)}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp' ? LANGUAGES.length - 1 : 0); } }}>
      <Globe /><span>{current.label}</span><svg className="language-selector-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && createPortal(<div id={id} ref={menuRef} className="language-selector-menu" role="menu" aria-labelledby={`${id}-trigger`} style={position}
      onKeyDown={(event) => {
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = index;
        if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else if (event.key === 'Tab') { close(true); return; }
        else return;
        event.preventDefault(); buttons[next]?.focus();
      }}>
      <div className="language-selector-heading"><span><Globe /></span><div><strong>{t('common.languageLabel')}</strong><small>{HINT[language]}</small></div></div>
      <div className="language-selector-options">{LANGUAGES.map((item) => <button key={item.code} type="button" role="menuitemradio" aria-checked={language === item.code} className={language === item.code ? 'is-active' : undefined} tabIndex={-1}
        onClick={() => { setLanguage(item.code); close(true); }}>
        <span className={`fi fi-${item.flag}`} aria-hidden="true" />
        <span className="language-selector-name" lang={item.code}>{item.native}</span>
        {language === item.code ? <svg className="language-selector-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 10 3.5 3.5L15 7" /></svg> : <span className="language-selector-code" aria-hidden="true">{item.label}</span>}
      </button>)}</div>
    </div>, document.body)}
  </div>;
}
