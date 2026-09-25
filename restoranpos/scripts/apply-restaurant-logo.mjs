#!/usr/bin/env node
/**
 * Lets the venue put its own logo on the receipt.
 *
 * The mark used to be compiled into the core binary, so every customer printed
 * the first venue's logo and changing it meant a rebuild. The core now reads two
 * settings rows; this screen is what writes them.
 *
 * The image is decoded here rather than in the core: a canvas gives us a small
 * PNG for the on-screen preview and a 1 bpp raster already thresholded at the
 * print head's dot width, so the core needs no image decoder.
 *
 * Also adds the trading-hours field, which the receipt prints but nothing could
 * edit — its value was hardcoded to one venue's 12:00-02:00.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LOGO_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}
function replaceAll(src, find, repl, want, label) {
  const n = src.split(find).length - 1;
  must(n === want, `${label}: expected ${want} matches, got ${n}`);
  return src.split(find).join(repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

// --- trading hours joins the editable fields ------------------------------
s = replaceOnce(
  s,
  `  { key: "restaurant.taxId", max: 40 }
];`,
  `  { key: "restaurant.taxId", max: 40 },
  { key: "restaurant.hours", max: 60 }
];`,
  'hours field',
);
s = replaceOnce(
  s,
  `  "restaurant.taxId": ""
};`,
  `  "restaurant.taxId": "",
  "restaurant.hours": ""
};`,
  'hours empty value',
);
s = replaceAll(
  s,
  `      "restaurant.taxId": "VÖEN"
    },`,
  `      "restaurant.taxId": "VÖEN",
      "restaurant.hours": "İş saatı"
    },`,
  1,
  'hours label az',
);
for (const [tax, hours] of [
  ['"restaurant.taxId": "Tax ID"', '"restaurant.hours": "Opening hours"'],
  ['"restaurant.taxId": "Vergi No"', '"restaurant.hours": "Çalışma saatleri"'],
]) {
  if (s.includes(tax)) s = replaceOnce(s, tax, `${tax},\n      ${hours}`, `hours label ${hours}`);
}

// --- the canvas pipeline, next to the component ---------------------------
s = replaceOnce(
  s,
  'function RestaurantInfoSettings() {',
  `const LOGO_RASTER_WIDTH = 384;
const LOGO_PREVIEW_WIDTH = 220;
const LOGO_LUMINANCE_ON = 140;
const LOGO_MAX_BYTES = 400 * 1024;
async function decodeLogoFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("decode failed"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function drawLogo(image, width) {
  const scale = width / image.naturalWidth;
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, ctx, width, height };
}
function logoRasterFrom(image) {
  const { ctx, width, height } = drawLogo(image, LOGO_RASTER_WIDTH);
  const data = ctx.getImageData(0, 0, width, height).data;
  const stride = Math.ceil(width / 8);
  const bytes = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] ?? 0;
      const luminance = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
      if (alpha <= 128 || luminance >= LOGO_LUMINANCE_ON) continue;
      const at = y * stride + (x >> 3);
      bytes[at] = (bytes[at] ?? 0) | (128 >> (x & 7));
    }
  }
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return { w: width, h: height, hex };
}
async function logoAssetsFromFile(file) {
  const image = await decodeLogoFile(file);
  return {
    dataUrl: drawLogo(image, LOGO_PREVIEW_WIDTH).canvas.toDataURL("image/png"),
    raster: logoRasterFrom(image),
  };
}
function RestaurantInfoSettings() {`,
  'canvas logo pipeline',
);

// --- component state ------------------------------------------------------
s = replaceOnce(
  s,
  `  const [saving, setSaving] = reactExports.useState(false);
  reactExports.useEffect(() => {
    void (async () => {
      const res = await window.pos.settings.getAll();`,
  `  const [saving, setSaving] = reactExports.useState(false);
  const [logo, setLogo] = reactExports.useState("");
  const [logoBusy, setLogoBusy] = reactExports.useState(false);
  const [previewHtml, setPreviewHtml] = reactExports.useState(null);
  const logoInput = reactExports.useRef(null);
  const refreshPreview = reactExports.useCallback(async () => {
    const res = await window.pos.print.previewTest();
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    setPreviewHtml(res.data.html ?? "");
  }, []);
  const pickLogo = async (file) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const assets = await logoAssetsFromFile(file);
      if (assets.dataUrl.length > LOGO_MAX_BYTES) {
        toast("Loqo çox böyükdür — daha kiçik şəkil seçin", "danger");
        return;
      }
      const res = await window.pos.receiptLogo.apply(assets);
      if (!res.success) {
        toast(res.error.message, "danger");
        return;
      }
      setLogo(assets.dataUrl);
      toast("Loqo yadda saxlanıldı", "success");
      if (previewHtml !== null) await refreshPreview();
    } catch {
      toast("Şəkil oxunmadı və ya format dəstəklənmir", "danger");
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  };
  const clearLogo = async () => {
    setLogoBusy(true);
    const res = await window.pos.receiptLogo.clear();
    setLogoBusy(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    setLogo("");
    if (previewHtml !== null) await refreshPreview();
  };
  reactExports.useEffect(() => {
    void (async () => {
      const res = await window.pos.settings.getAll();`,
  'logo state and handlers',
);

s = replaceOnce(
  s,
  `      setSaved(next);
      setDraft(next);
    })();
  }, []);
  const dirty = FIELDS.some`,
  `      setSaved(next);
      setDraft(next);
      if (typeof all["printer.logoDataUrl"] === "string") setLogo(all["printer.logoDataUrl"]);
    })();
  }, []);
  const dirty = FIELDS.some`,
  'load stored logo',
);

// --- the picker and the preview, above the save button --------------------
s = replaceOnce(
  s,
  `    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "button",
      {
        type: "button",
        disabled: !dirty || saving || loading,
        onClick: () => void save(),
        className: "touch-target rounded-xl border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold disabled:border-hairline disabled:bg-elevated disabled:text-faint",
        children: saving ? t.common.saving : t.common.save
      }
    )
  ] });
}`,
  `    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 rounded-xl border border-hairline p-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: "Çek loqosu" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted", children: "Şəkil seçin — çekin başında çap olunacaq. Boş buraxsanız loqo çap olunmur." }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "flex h-16 w-40 items-center justify-center rounded-lg border border-hairline bg-white", children: logo ? /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: logo, alt: "", className: "max-h-14 max-w-36 object-contain" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-ink/50", children: "Loqo yoxdur" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("input", { ref: logoInput, type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, onChange: (e) => void pickLogo(e.target.files?.[0]) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: logoBusy, onClick: () => logoInput.current?.click(), className: "touch-target rounded-xl border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold disabled:opacity-40", children: logoBusy ? t.common.saving : "Şəkil seç" }),
        logo ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: logoBusy, onClick: () => void clearLogo(), className: "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:text-danger disabled:opacity-40", children: "Loqonu sil" }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          disabled: !dirty || saving || loading,
          onClick: () => void save(),
          className: "touch-target rounded-xl border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold disabled:border-hairline disabled:bg-elevated disabled:text-faint",
          children: saving ? t.common.saving : t.common.save
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => previewHtml === null ? void refreshPreview() : setPreviewHtml(null), className: "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:text-cream", children: previewHtml === null ? "Çek önizləməsi" : "Önizləməni bağla" })
    ] }),
    previewHtml !== null ? /* @__PURE__ */ jsxRuntimeExports.jsx("iframe", { title: "cek-onizleme", sandbox: "allow-same-origin", srcDoc: previewHtml, className: "h-[520px] w-full rounded-xl border border-hairline bg-transparent" }) : null
  ] });
}`,
  'logo picker and receipt preview',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('logoAssetsFromFile'), 'canvas pipeline missing');
must(s.includes('window.pos.receiptLogo.apply'), 'apply call missing');
must(s.includes('"restaurant.hours": "İş saatı"'), 'hours label missing');
must(s.includes('previewTest()'), 'receipt preview missing');

console.log('patched', BUNDLE);
