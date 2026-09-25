#!/usr/bin/env node
/**
 * Restaurant Possistem shell: login is not MarketPos, catalog fills width,
 * sidebar stays floor-calm. Idempotent against the checked-in renderer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_SHELL_v2 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('already applied');
  process.exit(0);
}

must(!s.includes('MarketPos'), 'restaurant bundle already contains MarketPos');
must(!s.includes('Sahibkar'), 'restaurant bundle already contains Sahibkar');

s = replaceOnce(
  s,
  `  const adminLinksNav = [
    { to: "/admin", label: t.nav.admin, icon: LayoutDashboard, show: canAdmin },
    { to: "/dashboard", label: t.nav.dashboard, icon: ChartColumn, show: !floorMode && hasPermission("reports.view") },
    { to: "/admin/catalog", label: t.nav.catalog, icon: Utensils, show: !floorMode && hasPermission("catalog.manage") },
    { to: "/admin/gifts", label: t.nav.gifts, icon: Gift, show: !floorMode && hasPermission("gifts.manage") },
    { to: "/settings", label: t.nav.settings, icon: Settings, show: !floorMode }
  ];`,
  `  const adminLinksNav = [
    { to: "/admin", label: t.nav.admin, icon: LayoutDashboard, show: canAdmin }
  ];`,
  'calm sidebar rail',
);

s = replaceOnce(
  s,
  `          NavLink,
          {
            to,
            title: label,
            className: ({ isActive }) => \`group relative flex min-h-11 items-center justify-center gap-3 rounded-lg px-2 py-2.5 text-[13px] font-medium transition 2xl:justify-start 2xl:px-3 \${isActive ? "bg-oxblood/70 text-cream shadow-[inset_3px_0_0_#c4a66a]" : "text-muted hover:bg-elevated hover:text-cream"}\${floorMode && to === "/admin" ? " ps-floor-nav-admin" : ""}\`,`,
  `          NavLink,
          {
            to,
            end: to === "/admin",
            title: label,
            className: ({ isActive }) => \`ps-nav \${isActive ? "ps-nav-on" : "ps-nav-off"}\`,`,
  'nav active exact /admin',
);

s = replaceOnce(
  s,
  `          !floorMode && hasPermission("settings.manage") && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              className: "mb-1 flex min-h-10 w-full items-center justify-center gap-3 rounded-lg px-2 py-2 text-left text-xs text-faint hover:bg-elevated hover:text-gold 2xl:justify-start 2xl:px-3",
              title: t.nav.diagnostics,`,
  `          false && hasPermission("settings.manage") && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              className: "mb-1 flex min-h-10 w-full items-center justify-center gap-3 rounded-lg px-2 py-2 text-left text-xs text-faint hover:bg-elevated hover:text-gold 2xl:justify-start 2xl:px-3",
              title: t.nav.diagnostics,`,
  'hide diagnostics in rail',
);

s = replaceOnce(
  s,
  `    { to: "/admin/catalog", label: t.nav.catalog, icon: UtensilsCrossed, show: hasPermission("catalog.manage") },
    { to: "/admin/staff", label: t.nav.staff, icon: Users, show: hasPermission("users.manage") },`,
  `    { to: "/admin/catalog", label: t.nav.catalog, icon: UtensilsCrossed, show: hasPermission("catalog.manage") },
    { to: "/admin/gifts", label: t.nav.gifts, icon: Gift, show: hasPermission("gifts.manage") },
    { to: "/settings", label: t.nav.settings, icon: Settings, show: hasPermission("settings.manage") },
    { to: "/admin/staff", label: t.nav.staff, icon: Users, show: hasPermission("users.manage") },`,
  'hub gifts+settings',
);

s = replaceOnce(
  s,
  `      className: "ps-login-staff relative h-full min-h-[32rem] overflow-hidden bg-ink",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(7,6,5,.15),rgba(7,6,5,.6)_46%,rgba(7,6,5,.97)_100%)]" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_76%,rgba(96,44,44,.32),transparent_31%),radial-gradient(circle_at_72%_18%,rgba(196,166,106,.09),transparent_22%)]" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative z-10 grid h-full grid-cols-[minmax(15rem,.82fr)_minmax(31rem,1.18fr)] gap-5 p-5 xl:gap-9 xl:p-8", children: [`,
  `      className: "ps-rest-staff",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-staff-photo", style: { backgroundImage: \`url(\${loginBackground})\` }, "aria-hidden": "true" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-staff-grid", children: [`,
  'staff login shell',
);

s = replaceOnce(
  s,
  `              className: "flex min-w-0 flex-col justify-between overflow-hidden rounded-[1.4rem] border border-gold/12 bg-ink/28 p-6 backdrop-blur-[2px] xl:p-9",`,
  `              className: "ps-rest-staff-brand",`,
  'staff brand panel',
);

s = replaceOnce(
  s,
  `              className: "glass-raised relative flex min-w-0 flex-col overflow-hidden rounded-[1.4rem]",`,
  `              className: "ps-rest-staff-card",`,
  'staff card hug',
);

s = replaceOnce(
  s,
  `  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-login-tenant relative flex min-h-full items-center justify-center overflow-hidden bg-ink px-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,rgba(224,122,47,0.22),transparent_48%),radial-gradient(ellipse_at_82%_88%,rgba(26,18,8,0.35),transparent_42%)]" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(
      motion.div,
      {
        className: "relative z-10 grid w-full max-w-4xl gap-10 md:grid-cols-2 md:items-center",
        initial: reduce ? false : { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45 },
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-brand-lockup ps-brand-lockup--hero mb-7", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              "img",
              {
                src: brandMark,
                alt: "possistem",
                className: "ps-brand-logo ps-brand-logo--hero",
                draggable: false
              }
            ) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "mt-3 font-display text-3xl text-gold md:text-4xl", children: t.brand }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "gold-rule mt-4 w-24 opacity-60" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-4 max-w-sm text-sm leading-relaxed text-muted", children: t.tenant.gateHint }),
            trialHint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 text-sm text-gold/90", children: trialHint }) : null
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "form",
            {
              className: "rounded-2xl border border-hairline bg-elevated p-6 shadow-[var(--shadow-lift)]",
              onSubmit: (e) => {
                e.preventDefault();
                void submit();
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-5 flex items-center gap-3 md:hidden", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "possistem", className: "ps-brand-logo ps-brand-logo--compact", draggable: false }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-xl text-cream", children: t.tenant.title })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "hidden font-display text-xl text-cream md:block", children: t.tenant.title }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "gold-rule mt-2 hidden w-16 opacity-50 md:block" }),`,
  `  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate-photo", style: { backgroundImage: \`url(\${loginBackground})\` }, "aria-hidden": "true" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-grid", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-brand", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-head", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-brand-lockup ps-brand-lockup--hero", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
                "img",
                {
                  src: brandMark,
                  alt: "possistem",
                  className: "ps-brand-logo ps-brand-logo--hero",
                  draggable: false
                }
              ) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-wordmark", children: t.brand }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-sub", children: t.tagline })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-copy", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-kicker", children: t.tagline }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-rest-gate-title", children: t.tenant.title }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate-rule" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-hint", children: t.tenant.gateHint }),
              trialHint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-hint", children: trialHint }) : null
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-secure", children: t.login.secureAccess })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "form",
            {
              className: "ps-rest-gate-card",
              onSubmit: (e) => {
                e.preventDefault();
                void submit();
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-mobile", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "possistem", className: "ps-brand-logo ps-brand-logo--compact", draggable: false }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: t.tenant.title })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "ps-rest-gate-desk-title", children: t.tenant.title }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate-rule ps-rest-gate-rule--card" }),`,
  'tenant possistem two-column gate',
);

s = replaceOnce(
  s,
                  `                    className: "mt-1 w-full rounded-xl border border-hairline bg-ink/30 px-3 py-3 text-cream outline-none focus:border-gold/50",
                      required: true
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "mt-4 block text-sm", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.tenant.password }),`,
  `                    className: "ps-rest-gate-input",
                      required: true
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "mt-4 block text-sm", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.tenant.password }),`,
  'tenant email input class',
);

s = replaceOnce(
  s,
  `                      className: "mt-1 w-full rounded-xl border border-hairline bg-ink/30 px-3 py-3 text-cream outline-none focus:border-gold/50",
                      required: true
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "mt-4 flex items-center gap-3 text-sm text-muted", children: [`,
  `                      className: "ps-rest-gate-input",
                      required: true
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "ps-rest-gate-remember", children: [`,
  'tenant password+remember',
);

s = replaceOnce(
  s,
  `                    className: "touch-target mt-5 w-full rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-on-gold hover:brightness-105 disabled:opacity-50",
                    children: busy ? t.common.loading : t.tenant.submit
                  }
                )
              ]
            }
          )
        ]
      }
    )
  ] });
}`,
  `                    className: "ps-rest-gate-submit",
                    children: busy ? t.common.loading : t.tenant.submit
                  }
                )
              ]
            }
          )
        ] })
  ] });
}`,
  'tenant gate close',
);

must(s.includes('ps-rest-gate-grid'), 'tenant two-col grid missing');
must(s.includes('ps-rest-gate-brand'), 'tenant brand column missing');
must(s.includes('ps-rest-staff'), 'staff shell missing');
must(s.includes('end: to === "/admin"'), 'admin NavLink end missing');
must(!s.includes('ps-login-tenant'), 'old tenant class remains');
must(!s.includes('ps-login-staff'), 'old staff class remains (collides with MarketPos CSS)');
must(!s.includes('MarketPos'), 'MarketPos leaked into restaurant bundle');
must(!s.includes('Sahibkar'), 'Sahibkar leaked into restaurant bundle');

s = s.replace('/* POS_BRAND_v1 */', `/* POS_BRAND_v1 */\n${MARK}`);
must(s.includes(MARK), 'shell mark inserted');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
