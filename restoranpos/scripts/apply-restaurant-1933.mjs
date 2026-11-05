// 1.9.33: sub-categories on the order screen and in the catalog, set menus, moving products, editing
// staff, goods that reach the order screen, sizes in other units, cash-only till cards, portal
// branches in the till form, no stock photos on the order screen, the cart following what was added.
// Components live in catalog/subcats.js (replaced each run).
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index-DAmHwBc4.js');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('1933 anchor missing/repeated: '+a.slice(0,100));return s.replace(a,b)};
let s=fs.readFileSync(file,'utf8');
const start='/* POSSISTEM_SUBCATS_1926 */',end='/* END_POSSISTEM_STAFF_EDIT_1926 */',parts=fs.readFileSync(path.join(root,'catalog/subcats.js'),'utf8').trim();
const boot='const container = document.getElementById("root");';
if(s.includes(start)){const a=s.indexOf(start),b=s.indexOf(end,a);if(b<0)throw Error('1933 block end missing');s=s.slice(0,a)+parts+s.slice(b+end.length);}
else s=once(s,boot,parts+'\n'+boot);

const mark='/* POSSISTEM_1933 */';
if(!s.includes(mark)){
 // Order screen: top-level categories on the left; a parent shows its sub-categories as tiles.
 s=once(s,'      setCategories(list);\n      setCategoryId((prev) => prev || list[0]?.id || "");\n    } catch (err)','      setCategories(list);\n      psOrderCats = list;\n      setCategoryId((prev) => prev || psTopCats(list)[0]?.id || "");\n    } catch (err)');
 s=once(s,'const orderProducts=reactExports.useMemo(()=>psGroupOrderSizes(products2,lang),[products2,lang]);',mark+'const orderProducts=reactExports.useMemo(()=>[...psSubcatTiles(categoryId),...psGroupOrderSizes(products2,lang)],[products2,lang,categoryId,categories2]);');
 s=once(s,'Math.ceil(categories2.length / categoryPageSize)','Math.ceil(psTopCats(categories2).length / categoryPageSize)');
 s=once(s,'const visibleCategories = categories2.slice(','const visibleCategories = psTopCats(categories2).slice(');
 s=once(s,'${categoryId === cat.id ? "border-gold/55','${categoryId === cat.id || psParentOf(categories2, categoryId) === cat.id ? "border-gold/55');
 s=once(s,'children: visibleProducts.map((product) => {\n            const disabled = isTruthy(product.soldOut)','children: visibleProducts.map((product) => {\n            if (product._psTile) return psSubcatTile(product, () => setCategoryId(product._psTile.id), lang);\n            const disabled = isTruthy(product.soldOut)');

 // No stock photos on the order screen: a dish shows a picture only if the owner gave it one.
 s=once(s,'const hideImage = isTruthy(product.imageHidden);\n            return /* @__PURE__ */ jsxRuntimeExports.jsx(\n              "button",','const hideImage = isTruthy(product.imageHidden) || !product.image;\n            return /* @__PURE__ */ jsxRuntimeExports.jsx(\n              "button",');

 // The cart shows 4 lines a page and stayed on its page, so a line added past it looked lost.
 s=once(s,'  const [cartPage, setCartPage] = reactExports.useState(0);','  const [cartPage, setCartPage] = reactExports.useState(0);\n  const psAddedProduct = reactExports.useRef(null);\n  const [psAddedLine, setPsAddedLine] = reactExports.useState(null);\n  const [psSizeError, setPsSizeError] = reactExports.useState("");');
 s=once(s,'  const addProduct = async (product, modifierIds = []) => {\n    if (!order) return;\n    setAdding(true);','  const addProduct = async (product, modifierIds = []) => {\n    if (!order) {\n      const none = psAdminText("Sifariş açılmayıb", "Sipariş açılmadı", "No order is open");\n      toast(none, "danger");\n      return none;\n    }\n    setAdding(true);');
 s=once(s,'    setAdding(false);\n    if (!res.success) {\n      toast(res.error.message, "danger");\n      return;\n    }\n    setPending(null);\n    await loadOrder(order.id);\n  };','    setAdding(false);\n    if (!res.success) {\n      toast(res.error.message, "danger");\n      return res.error.message;\n    }\n    setPending(null);\n    psAddedProduct.current = product.id;\n    await loadOrder(order.id);\n    return null;\n  };');
 s=once(s,'    setCartPage((page) => Math.min(page, cartPages - 1));\n  }, [cartPages]);','    setCartPage((page) => Math.min(page, cartPages - 1));\n  }, [cartPages]);\n  reactExports.useEffect(() => {\n    if (!psAddedProduct.current) return;\n    let at = -1;\n    cartItems.forEach((item, i) => { if (item.productId === psAddedProduct.current) at = i; });\n    psAddedProduct.current = null;\n    if (at < 0) return;\n    setCartPage(Math.floor(at / cartPageSize));\n    setPsAddedLine(cartItems[at].id);\n    const timer = setTimeout(() => setPsAddedLine(null), 900);\n    return () => clearTimeout(timer);\n  }, [cartItems]);');
 s=once(s,'return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "border-b border-gold/12 px-1 py-3", children: [\n            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-2", children: [\n              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0", children: [\n                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "truncate text-sm text-cream", children: item.name }),','return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "border-b border-gold/12 px-1 py-3" + (psAddedLine === item.id ? " ps-sale-line-added" : ""), children: [\n            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between gap-2", children: [\n              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0", children: [\n                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "truncate text-sm text-cream", children: item.name }),');
 // The size dialog stays open until the add has worked, and shows why it did not.
 s=once(s,'jsxRuntimeExports.jsx(PsOrderSizes,{family:sizeFamily,onClose:()=>setSizeFamily(null),busy:adding,onPick:p=>{setSizeFamily(null);void onProductClick(p);}})','jsxRuntimeExports.jsx(PsOrderSizes,{family:sizeFamily,error:psSizeError,onClose:()=>{setPsSizeError("");setSizeFamily(null);},busy:adding,onPick:async p=>{setPsSizeError("");const r=await window.pos.products.modifierGroups(p.id);if(!r.success){setPsSizeError(r.error.message);return;}const groups=r.data.groups??[];if(groups.length){setSizeFamily(null);openModifierModal(p,groups);return;}const failed=await addProduct(p);if(failed)setPsSizeError(failed);else setSizeFamily(null);}})');

 // Catalog: sub-categories indented, parent picker for a new category, move a category inside another.
 s=once(s,'"ps-catalog-cat" + (selected ? " is-on" : "")','"ps-catalog-cat" + (cat.parentId ? " is-sub" : "") + (selected ? " is-on" : "")');
 s=once(s,'const [dragId, setDragId] = reactExports.useState(null);','const [dragId, setDragId] = reactExports.useState(null);\n  const [newParentId, setNewParentId] = reactExports.useState("");\n  const [productCategoryId, setProductCategoryId] = reactExports.useState("");\n  const [setMenu, setSetMenu] = reactExports.useState(null);\n  const [sizeUnit, setSizeUnit] = reactExports.useState("sm");\n  reactExports.useEffect(() => { setProductCategoryId(""); }, [editId, editorOpen, categoryId]);');
 s=once(s,'sortOrder: Math.max(0, ...categories2.map((category) => category.sortOrder ?? 0)) + 1\n      },','sortOrder: Math.max(0, ...categories2.map((category) => category.sortOrder ?? 0)) + 1,\n        ...(newParentId ? { parentId: newParentId } : {})\n      },');
 s=once(s,'onClick: () => void saveCategory(), children: "+" })\n        ] }),','onClick: () => void saveCategory(), children: "+" })\n        ] }),\n        jsxRuntimeExports.jsx(PsCategoryPick, { categories: categories2, value: newParentId, onChange: setNewParentId, blank: psAdminText("Ana kateqoriya kimi", "Ana kategori olarak", "As a top-level category"), topOnly: true, className: "ps-catalog-parent-pick", label: psAdminText("Hansı kateqoriyanın içində", "Hangi kategorinin içinde", "Inside which category") }),');
 s=once(s,'/* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "is-danger", onClick: () => { setOpenMenu(null); void removeCategory(cat.id); }, children: t.staff.delete })','!cat.parentId ? jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); setNewParentId(cat.id); }, children: psAdminText("+ Alt kateqoriya", "+ Alt kategori", "+ Sub-category") }) : null,\n                jsxRuntimeExports.jsx(PsCategoryMove, { cat, categories: categories2, onMove: (c, parentId) => { setOpenMenu(null); void moveCategoryInto(c, parentId); } }),\n                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "is-danger", onClick: () => { setOpenMenu(null); void removeCategory(cat.id); }, children: t.staff.delete })');
 s=once(s,'const saveCategoryRename = async (category) => {',`const moveCategoryInto = async (category, parentId) => {
    setSaving(true);
    const res = await window.pos.catalogAdmin.upsertCategory({ ...categoryPayload(category), parentId }, { idempotencyKey: newIdempotencyKey() });
    setSaving(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    toast(psAdminText("Köçürüldü", "Taşındı", "Moved"), "success");
    await loadCategories();
  };
  const saveCategoryRename = async (category) => {`);
 // Up/down moves among the category's own level, so a parent with children is not in the way.
 s=once(s,'    const targetIndex = index + direction;\n    if (targetIndex < 0 || targetIndex >= categories2.length || saving) return;\n    const current = categories2[index];\n    const target = categories2[targetIndex];\n    if (!current || !target) return;\n    const currentOrder = current.sortOrder ?? index + 1;\n    const targetOrder = target.sortOrder ?? targetIndex + 1;','    const current = categories2[index];\n    if (!current || saving) return;\n    const peers = categories2.filter((row) => (row.parentId || "") === (current.parentId || ""));\n    const target = peers[peers.findIndex((row) => row.id === current.id) + direction];\n    if (!target) return;\n    const currentOrder = current.sortOrder ?? index + 1;\n    const targetOrder = target.sortOrder ?? categories2.indexOf(target) + 1;');
 s=once(s,'    const from = categories2.findIndex((row) => row.id === fromId);\n    const to = categories2.findIndex((row) => row.id === toId);\n    if (from < 0 || to < 0) return;','    const from = categories2.findIndex((row) => row.id === fromId);\n    const to = categories2.findIndex((row) => row.id === toId);\n    if (from < 0 || to < 0 || (categories2[from].parentId || "") !== (categories2[to].parentId || "")) return;');

 // Set menus in the catalog.
 s=once(s,'/* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); },','jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-menu-btn", onClick: () => setSetMenu({}), children: psAdminText("+ Menyu yarat", "+ Menü oluştur", "+ Create menu") }),\n          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); },');
 s=once(s,'/* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); void toggleSoldOut(product); },','product.componentCount > 0 ? jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); setSetMenu(product); }, children: psAdminText("Menyunun tərkibi", "Menü içeriği", "Menu contents") }) : null,\n              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); void toggleSoldOut(product); },');
 s=once(s,'/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: pillClass, children: pill }),','product.componentCount > 0 ? jsxRuntimeExports.jsx("span", { className: "ps-catalog-menu-tag", children: psAdminText("Menyu", "Menü", "Menu") }) : null,\n            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: pillClass, children: pill }),');
 s=once(s,'    editorOpen ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [\n      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-editor-backdrop",','    setMenu ? jsxRuntimeExports.jsx(PsSetMenuDialog, { menu: setMenu.id ? setMenu : null, categories: categories2, onClose: () => setSetMenu(null), onSaved: async (target) => { setSetMenu(null); await loadCategories(); setCategoryId(target); await loadProducts(target); } }) : null,\n    editorOpen ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [\n      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-editor-backdrop",');

 // Products: bulk move and a category field in the dish editor.
 s=once(s,'  const removeProduct = async (id) => {',`  const moveSelected = async (target) => {
    const ids = bulkIds.filter((id) => products2.some((p) => p.id === id));
    if (!target || target === categoryId || !ids.length) return;
    setSaving(true);
    const failed = await psMoveProducts(ids, products2, target);
    setSaving(false);
    setBulkIds([]);
    toast(
      failed
        ? psAdminText(failed + " məhsul köçürülmədi", failed + " ürün taşınamadı", failed + " products not moved")
        : psAdminText(ids.length + " məhsul köçürüldü", ids.length + " ürün taşındı", ids.length + " products moved"),
      failed ? "danger" : "success"
    );
    await loadProducts(categoryId);
    await loadCategories();
  };
  const removeProduct = async (id) => {`);
 s=once(s,'children: psAdminText("Seçilənləri sil", "Seçilenleri sil", "Delete selected") }) : null','children: psAdminText("Seçilənləri sil", "Seçilenleri sil", "Delete selected") }) : null,\n          bulkIds.length ? jsxRuntimeExports.jsx(PsCategoryPick, { categories: categories2, value: "", onChange: (v) => void moveSelected(v), blank: psAdminText("Seçilənləri köçür →", "Seçilenleri taşı →", "Move selected →"), className: "ps-catalog-bulk-move", label: psAdminText("Seçilənləri köçür", "Seçilenleri taşı", "Move selected") }) : null');
 s=once(s,'      categoryId,\n      image: imageUrl,','      categoryId: productCategoryId || categoryId,\n      image: imageUrl,');
 s=once(s,'children: "Menyuda yayımla" })\n          ] }),','children: "Menyuda yayımla" })\n          ] }),\n          jsxRuntimeExports.jsx(PsDishCategory, { categories: categories2, value: productCategoryId || categoryId, onChange: setProductCategoryId }),');

 // Sizes in other units.
 s=once(s,'row.sizeCm<=0||row.sizeCm>300||','row.sizeCm<=0||row.sizeCm>(sizeUnit==="sm"?300:100000)||');
 s=once(s,'if(sizes.length)payload.sizeVariants=sizes;','if(sizes.length){payload.sizeVariants=sizes;payload.sizeUnit=sizeUnit;}');
 s=once(s,'jsxRuntimeExports.jsx(PsSizeVariants,{rows:sizeVariants,onChange:setSizeVariants,price:priceRaw,disabled:saving})','jsxRuntimeExports.jsx(PsSizeVariants,{rows:sizeVariants,onChange:setSizeVariants,price:priceRaw,disabled:saving,unit:sizeUnit,onUnit:setSizeUnit})');

 // Till card: card money belongs to the bank when there is one for this till.
 s=once(s,'a.kind === "till" ? h("p", { className: "ps-kassa-today" }, "Bu gün: nağd " + formatMoney(a.todayCashMinor ?? 0) + " · kart " + formatMoney(a.todayCardMinor ?? 0))','a.kind === "till" ? h("p", { className: "ps-kassa-today" }, "Bu gün: nağd " + formatMoney(a.todayCashMinor ?? 0) + (data.accounts.some((b) => b.kind === "bank" && (!b.objectId || b.objectId === a.objectId)) ? "" : " · kart " + formatMoney(a.todayCardMinor ?? 0)))');
 // Till form: portal branches are objects too, and a lone object is the obvious choice.
 s=once(s,'const [moves, setMoves] = reactExports.useState(null);\n  const [confirmAsk, confirmDialog] = useConfirm();\n  const hasPermission = useAuthStore((st) => st.hasPermission);\n  const canManage = hasPermission("cash.accounts");\n  const reload = reactExports.useCallback(async () => {\n    const [from, to] = psToday();\n    const r = await window.pos.cashAccounts.list(from, to);\n    if (r.success) { _psAccountsCache = r.data; setData(r.data); } else toast(r.error.message, "danger");\n  }, []);\n  reactExports.useEffect(() => { void reload(); }, [reload]);','const [moves, setMoves] = reactExports.useState(null);\n  const [confirmAsk, confirmDialog] = useConfirm();\n  const hasPermission = useAuthStore((st) => st.hasPermission);\n  const canManage = hasPermission("cash.accounts");\n  const reload = reactExports.useCallback(async () => {\n    const [from, to] = psToday();\n    const r = await window.pos.cashAccounts.list(from, to);\n    if (r.success) { _psAccountsCache = r.data; setData(r.data); } else toast(r.error.message, "danger");\n  }, []);\n  reactExports.useEffect(() => { void reload(); }, [reload]);\n  const objectsLoaded = Boolean(data);\n  reactExports.useEffect(() => {\n    if (!objectsLoaded || !canManage || psMarketMode() || window.__psCloudBranchMode) return;\n    let live = true;\n    void psSyncCloudObjects(_psAccountsCache?.objects).then((added) => { if (live && added) void reload(); }).catch(() => {});\n    return () => { live = false; };\n  }, [objectsLoaded, canManage, reload]);');
 s=once(s,'onClick: () => setForm({ name: "", kind: "till", objectId: objectId !== "all" && objectId !== "none" ? objectId : "",','onClick: () => setForm({ name: "", kind: "till", objectId: objectId !== "all" && objectId !== "none" ? objectId : data.objects.length === 1 ? data.objects[0].id : "",');

 // Goods: "Satışda göstər". On by default for a new good; a good already on sale stays in step.
 s=once(s,'    copyOf: copy ? g?.name : ""\n  };','    copyOf: copy ? g?.name : "",\n    onSale: Boolean(g?.menuItemId && !copy),\n    sell: !g || copy,\n    saleCategoryId: ""\n  };');
 s=once(s,'function PsGoodDialog({ form, setForm, categories, objects, onSaved }) {\n  const h = psH;','function PsGoodDialog({ form, setForm, categories, objects, onSaved }) {\n  const h = psH;\n  const canSell = useAuthStore((st) => st.hasPermission)("catalog.manage");\n  const [saleCategories, setSaleCategories] = reactExports.useState([]);\n  reactExports.useEffect(() => { let live = true; void window.pos.products.categories().then((r) => { if (live && r.success) setSaleCategories(r.data.categories ?? []); }); return () => { live = false; }; }, []);');
 s=once(s,'    const barcode = String(form.barcode || "").trim() || psMakeBarcode(new Set());\n    void run(window.pos.inventory.saveIngredient({','    const toSale = canSell && (form.onSale ? sale > 0 : form.sell);\n    if (canSell && !form.onSale && form.sell && sale <= 0) { toast("Satışda göstərmək üçün satış qiymətini yazın", "danger"); return; }\n    const barcode = String(form.barcode || "").trim() || psMakeBarcode(new Set());\n    void run(window.pos.inventory.saveIngredient({');
 s=once(s,'      idempotencyKey: newIdempotencyKey()\n    }), form.id ? "Saxlanıldı" : "Yeni mal yaradıldı").then((ok) => { if (ok) setForm(null); });','      idempotencyKey: newIdempotencyKey()\n    }).then(async (saved) => {\n      if (!saved.success || !toSale) return saved;\n      const published = await psBusinessCall("catalog.publish", { ingredientId: saved.data?.id || form.id, categoryId: form.onSale ? "" : form.saleCategoryId || "" }, newIdempotencyKey());\n      return published.success ? saved : published;\n    }), form.id ? "Saxlanıldı" : "Yeni mal yaradıldı").then((ok) => { if (ok) setForm(null); });');
 s=once(s,'    h("div", { className: "flex gap-2" },\n      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),\n      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(null), children: "İmtina" })))\n  });\n}\nconst PS_GOODS_HEADERS','    canSell ? h("div", { className: "ps-good-sale" }, form.onSale\n      ? h("p", null, "Bu mal satışdadır. Adı və qiyməti satışda da dəyişəcək.")\n      : [h("label", { key: "sell" }, h("input", { type: "checkbox", checked: form.sell, onChange: (e) => set({ sell: e.target.checked }) }), "Satışda göstər"),\n        form.sell ? h("label", { key: "cat", className: "block text-sm" }, "Satış kateqoriyası", jsxRuntimeExports.jsx(PsCategoryPick, { categories: saleCategories.filter((c) => c.id !== "cat-goods"), value: form.saleCategoryId, onChange: (v) => set({ saleCategoryId: v }), blank: "Mallar", label: "Satış kateqoriyası" })) : null,\n        h("p", { key: "hint" }, form.sell ? "Sifariş ekranında görünəcək. Satış qiyməti mütləqdir." : "Xammal kimi yalnız anbarda qalacaq.")]) : null,\n    h("div", { className: "flex gap-2" },\n      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),\n      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(null), children: "İmtina" })))\n  });\n}\nconst PS_GOODS_HEADERS');

 // Labels: the catalog and the categories are one list.
 s=once(s,'    catalog: "Kataloq",','    catalog: "Kateqoriyalar",');
 s=once(s,'    title: "Kataloq",','    title: "Kateqoriyalar",');
 s=once(s,'    catalog: "Katalog",','    catalog: "Kategoriler",');
 s=once(s,'    title: "Katalog",','    title: "Kategoriler",');
 s=once(s,'    catalog: "Catalog",','    catalog: "Categories",');
 s=once(s,'    title: "Catalog",','    title: "Categories",');
 s=once(s,'[["menu","Restoran menyusu","Restoran menüsü","Restaurant menu"],["goods","Mallar və xammal","Ürünler ve hammaddeler","Goods and ingredients"],["categories","Mal kateqoriyaları","Ürün kategorileri","Goods categories"]]','[["menu","Kateqoriyalar","Kategoriler","Categories"],["goods","Mallar və xammal","Ürünler ve hammaddeler","Goods and ingredients"],["categories","Anbar kateqoriyaları","Depo kategorileri","Warehouse categories"]]');

 // Staff: edit name, role and PIN; PIN is exactly 4 digits.
 s=once(s,'  const [busy, setBusy] = reactExports.useState(false);\n  reactExports.useEffect(() => {\n    // Only an operator with roles.manage','  const [busy, setBusy] = reactExports.useState(false);\n  const [editingUser, setEditingUser] = reactExports.useState(null);\n  reactExports.useEffect(() => {\n    // Only an operator with roles.manage');
 s=once(s,'                  maxLength: 8,\n                  value: pin,\n                  onChange: (e) => setPin(e.target.value.replace(/\\D/g, "").slice(0, 8)),','                  maxLength: 4,\n                  value: pin,\n                  onChange: (e) => setPin(e.target.value.replace(/\\D/g, "").slice(0, 4)),');
 s=once(s,'children: t.staff.list }),\n        /* @__PURE__ */ jsxRuntimeExports.jsxs("ul", { className: "mt-4 space-y-2", children: [','children: t.staff.list }),\n        editingUser ? jsxRuntimeExports.jsx(PsStaffEdit, { user: editingUser, roles: roles.length ? roles : ["waiter", "cashier", "kitchen", "storekeeper", "supervisor", "manager"], onDone: (changed) => { setEditingUser(null); if (changed) void load(); } }, editingUser.id) : null,\n        /* @__PURE__ */ jsxRuntimeExports.jsxs("ul", { className: "mt-4 space-y-2", children: [');
 s=once(s,'                user.role !== "administrator" && user.id !== "usr-admin" ? /* @__PURE__ */ jsxRuntimeExports.jsx(\n                  "button",\n                  {\n                    type: "button",\n                    onClick: () => void deactivate(user),','                jsxRuntimeExports.jsx("button", { type: "button", className: "ps-staff-edit-btn", onClick: () => setEditingUser(user), children: psAdminText("Düzəliş", "Düzenle", "Edit") }),\n                user.role !== "administrator" && user.id !== "usr-admin" ? /* @__PURE__ */ jsxRuntimeExports.jsx(\n                  "button",\n                  {\n                    type: "button",\n                    onClick: () => void deactivate(user),');
 s=once(s,'addWaiter: "Ofisiant əlavə et"','addWaiter: "İşçi əlavə et"');
 s=once(s,'created: "Ofisiant əlavə olundu"','created: "İşçi əlavə olundu"');
 s=once(s,'addWaiter: "Add waiter"','addWaiter: "Add staff"');
 s=once(s,'created: "Waiter added"','created: "Staff added"');
 s=once(s,'addWaiter: "Garson ekle"','addWaiter: "Personel ekle"');
 s=once(s,'created: "Garson eklendi"','created: "Personel eklendi"');
 s=once(s,'pin: "PIN (4-8 rəqəm)"','pin: "PIN (4 rəqəm)"');
 s=once(s,'pin: "PIN (4-8 digits)"','pin: "PIN (4 digits)"');
 s=once(s,'pin: "PIN (4-8 rakam)"','pin: "PIN (4 rakam)"');
}
fs.writeFileSync(file,s);
console.log('1933: sub-categories, set menus, goods on sale, size units, till cards, portal objects, plain order cards');
