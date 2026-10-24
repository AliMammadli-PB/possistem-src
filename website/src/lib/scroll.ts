/**
 * Scrolls a section to just under the sticky header.
 *
 * Sections below the fold use `content-visibility: auto` (.section-defer) and
 * report a placeholder height until they render, so a plain scrollIntoView
 * lands hundreds of pixels off. The sections are rendered for the jump
 * (html.is-jumping), the target is measured after that, and the position is
 * corrected once the smooth scroll ends.
 */
export function scrollToSection(id: string, behavior: ScrollBehavior = 'smooth') {
  const target = document.getElementById(id);
  if (!target) return false;

  const root = document.documentElement;
  root.classList.add('is-jumping');
  const header = document.querySelector<HTMLElement>('.ps-header, .site-header, body > header, header');
  const sectionNav = target.closest('.ps-info-page')?.querySelector<HTMLElement>('.info-section-nav');
  const offset = (header?.getBoundingClientRect().height ?? 0) + (sectionNav ? sectionNav.getBoundingClientRect().height + 16 : 0);
  const top = () => Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);

  // one frame so the deferred sections lay out at their real height
  requestAnimationFrame(() => {
    window.scrollTo({ top: top(), behavior: behavior === 'smooth' ? 'smooth' : 'instant' });
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      // Sections above the target keep their real height; dropping them back
      // to the placeholder would shift the page after it has arrived.
      document.querySelectorAll<HTMLElement>('.section-defer').forEach((section) => {
        if (section.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING || section === target) {
          section.classList.add('is-shown');
        }
      });
      if (Math.abs(target.getBoundingClientRect().top - offset) > 2) {
        window.scrollTo({ top: top(), behavior: 'instant' });
      }
      root.classList.remove('is-jumping');
    };
    if (behavior === 'smooth') {
      window.addEventListener('scrollend', settle, { once: true });
      window.setTimeout(settle, 1200);
    } else {
      settle();
    }
  });

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return true;
}
