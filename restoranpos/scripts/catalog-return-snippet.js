/* spliced by apply-catalog-calm — not executed alone */
  const visibleProducts = productQuery.trim()
    ? products2.filter((p) => localizedName(p, lang).toLowerCase().includes(productQuery.trim().toLowerCase()))
    : products2;
  if (loading) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-full items-center justify-center text-muted", children: t.common.loading });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-page flex h-full flex-col overflow-hidden", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "border-b border-hairline px-4 py-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl text-cream", children: t.catalog.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-catalog-hint", children: t.catalog.hint })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-body", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "ps-catalog-cats", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-catalog-cats-head", children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: t.catalog.categories }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-add", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: categoryName, onChange: (e) => setCategoryName(e.target.value), placeholder: t.catalog.newCategory, className: "ps-catalog-search" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void saveCategory(), children: "+" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-catalog-cat-list", children: categories2.map((cat, index) => {
          const selected = categoryId === cat.id;
          const menuOn = openMenu === "c:" + cat.id;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-cat" + (selected ? " is-on" : ""), style: { position: "relative" }, children: [
            editingCategoryId === cat.id ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex w-full items-center gap-1 px-1", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { autoFocus: true, value: editingCategoryName, onChange: (event) => setEditingCategoryName(event.target.value), onKeyDown: (event) => { if (event.key === "Enter") void saveCategoryRename(cat); if (event.key === "Escape") setEditingCategoryId(null); }, className: "ps-catalog-search" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-kebab", onClick: () => void saveCategoryRename(cat), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Check, { size: 16 }) })
            ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "ps-catalog-cat-main", onClick: () => { setCategoryId(cat.id); setOpenMenu(null); }, children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate", children: localizedName(cat, lang) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-catalog-count", children: cat.itemCount ?? 0 })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-kebab" + (menuOn ? " is-on" : ""), "aria-label": t.catalog.actions, onClick: () => setOpenMenu(menuOn ? null : "c:" + cat.id), children: "⋮" }),
              menuOn ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-menu", style: { right: 0, top: "2.85rem" }, children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || index === 0, onClick: () => { setOpenMenu(null); void moveCategory(index, -1); }, children: t.catalog.moveUp }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || index === categories2.length - 1, onClick: () => { setOpenMenu(null); void moveCategory(index, 1); }, children: t.catalog.moveDown }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); setEditingCategoryId(cat.id); setEditingCategoryName(localizedName(cat, lang)); }, children: t.catalog.renameCategory }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "is-danger", onClick: () => { setOpenMenu(null); void removeCategory(cat.id); }, children: t.staff.delete })
              ] }) : null
            ] })
          ] }, cat.id);
        }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-main", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-toolbar", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: t.catalog.products }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: productQuery, onChange: (e) => setProductQuery(e.target.value), placeholder: t.catalog.search, className: "ps-catalog-search" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); }, children: "+ " + t.catalog.newProduct })
        ] }),
        visibleProducts.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-catalog-empty", children: t.catalog.empty }) : /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "ps-catalog-list", children: visibleProducts.map((product, index) => {
          const sold = isSoldOut(product);
          const hiddenImage = isImageHidden(product);
          const menuOn = openMenu === "p:" + product.id;
          const live = product.active === true || product.active === 1;
          const pill = sold ? t.catalog.soldOut : live ? t.catalog.available : t.catalog.draft;
          const pillClass = sold ? "ps-pill is-danger" : live ? "ps-pill" : "ps-pill is-warn";
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row", style: { position: "relative" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image), alt: "", className: hiddenImage ? "opacity-25 grayscale" : "" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "ps-catalog-row-copy", onClick: () => { setShowLocales(false); void startEdit(product); }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: localizedName(product, lang) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: product.priceMinor > 0 ? (product.priceMinor / 100).toFixed(2) + " ₼" : t.catalog.draft })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: pillClass, children: pill }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-kebab" + (menuOn ? " is-on" : ""), "aria-label": t.catalog.actions, onClick: () => setOpenMenu(menuOn ? null : "p:" + product.id), children: "⋮" }),
            menuOn ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-menu", style: { right: "0.6rem", top: "2.9rem" }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); void toggleSoldOut(product); }, children: sold ? t.catalog.available : t.catalog.hideItem }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => { setOpenMenu(null); void toggleImageHidden(product); }, children: hiddenImage ? t.catalog.showImage : t.catalog.hideImage }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || index === 0, onClick: () => { setOpenMenu(null); void moveProduct(index, -1); }, children: t.catalog.moveUp }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || index === visibleProducts.length - 1, onClick: () => { setOpenMenu(null); void moveProduct(index, 1); }, children: t.catalog.moveDown }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "is-danger", onClick: () => { setOpenMenu(null); void removeProduct(product.id); }, children: t.staff.delete })
            ] }) : null
          ] }, product.id);
        }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "ps-catalog-mods", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("summary", { children: t.catalog.modifiers }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3 p-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-[1fr_auto]", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: modGroupName, onChange: (e) => setModGroupName(e.target.value), placeholder: t.catalog.newModifierGroup, className: "ps-catalog-search" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void saveModGroup(), className: "ps-catalog-new-btn", children: t.catalog.addGroup })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-[10rem_1fr_6rem_auto]", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("select", { value: modGroupId, onChange: (e) => setModGroupId(e.target.value), className: "ps-catalog-search", children: modifierGroups.map((g) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: g.id, children: localizedName(g, lang) }, g.id)) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: modName, onChange: (e) => setModName(e.target.value), placeholder: t.catalog.modifierName, className: "ps-catalog-search" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: modPrice, onChange: (e) => setModPrice(e.target.value), inputMode: "decimal", placeholder: t.catalog.price, className: "ps-catalog-search" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void saveModifier(), className: "ps-catalog-new-btn", children: t.catalog.addModifier })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { children: modifierGroups.flatMap((group) => (group.modifiers ?? []).map((mod) => /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 flex-1", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: mod.nameAz }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-xs text-faint", children: localizedName(group, lang) })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-kebab is-danger", onClick: () => void removeModifier(mod.id), children: t.staff.delete })
            ] }, mod.id))) })
          ] })
        ] })
      ] })
    ] }),
    editorOpen ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-editor-backdrop", "aria-label": t.catalog.closeEditor, onClick: () => setEditorOpen(false) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-catalog-editor-panel p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-3 flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-xl text-cream", children: editId ? t.catalog.editProduct : t.catalog.newProduct }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setEditorOpen(false), className: "ps-kebab", children: t.catalog.closeEditor })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-3", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "w-28 shrink-0", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "aspect-square overflow-hidden rounded-xl border border-hairline bg-elevated", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(editId ?? "", categoryId, imageUrl), alt: "", className: "h-full w-full object-cover" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void pickProductImage(), className: "touch-target mt-2 w-full rounded-xl border border-hairline px-2 py-2 text-xs", children: "Şəkil seç" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "min-w-0 flex-1 space-y-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (AZ)" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameAz, onChange: (e) => setNameAz(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream outline-none focus:border-gold/50" })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.catalog.price }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: priceRaw, onChange: (e) => setPriceRaw(e.target.value), inputMode: "decimal", placeholder: "0.00", className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream outline-none focus:border-gold/50" })
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-3 rounded-xl border border-hairline px-3 py-2 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", checked: published, onChange: (e) => setPublished(e.target.checked), className: "h-4 w-4" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Menyuda yayımla" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setShowLocales((v) => !v), className: "touch-target text-left text-sm text-muted", children: t.catalog.moreLocales }),
          showLocales ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (TR)" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameTr, onChange: (e) => setNameTr(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (EN)" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameEn, onChange: (e) => setNameEn(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Təsvir" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("textarea", { value: descriptionAz, onChange: (e) => setDescriptionAz(e.target.value), rows: 2, className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Stansiya" }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value: station, onChange: (e) => setStation(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-2 py-2 text-cream", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "kitchen", children: "Mətbəx" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "bar", children: "Bar" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "hookah", children: "Qəlyan" })
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Kurs" }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("select", { value: course, onChange: (e) => setCourse(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-2 py-2 text-cream", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "main", children: "Əsas" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "starter", children: "Başlanğıc" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "drink", children: "İçki" })
                ] })
              ] })
            ] }),
            modifierGroups.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-2", children: modifierGroups.map((group) => /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => toggleProductGroup(group.id), className: "touch-target rounded-xl border border-hairline px-3 py-2 text-xs", children: localizedName(group, lang) }, group.id)) }) : null
          ] }) : null,
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void saveProduct(), className: "ps-catalog-new-btn w-full", children: t.common.save })
        ] })
      ] })
    ] }) : null,
    confirmDialog
  ] });
}
