"use strict";
const electron = require("electron");
const IPC = {
  invoke: "pos:invoke",
  coreStatus: "pos:coreStatus",
  coreStatusSnapshot: "pos:coreStatus:get",
  coreEvent: "pos:coreEvent",
  coreRestart: "pos:coreRestart",
  appInfo: "pos:appInfo",
  openLogs: "pos:openLogs",
  sessionGet: "pos:session:get",
  sessionChanged: "pos:session:changed",
  updateStatus: "pos:update:status",
  updateCheck: "pos:update:check",
  updateInstall: "pos:update:install",
  updateChanged: "pos:update:changed",
  displayGet: "pos:display:get",
  displaySet: "pos:display:set",
  catalogPickImage: "pos:catalog:image:pick",
  openExternal: "pos:openExternal"
};
async function call(method, payload, options) {
  try {
    /* POS_LOCKED_VISIBLE_v1 */
    const result = await electron.ipcRenderer.invoke(IPC.invoke, { method, payload, options });
    if (result && result.success === false && result.error && result.error.code === "E_FORBIDDEN") {
      result.error.message = "Buna icazəniz yoxdur";
      // DOM events cross the isolated world, so the page's toast hears this even
      // where the calling screen swallows the error.
      try { window.dispatchEvent(new CustomEvent("ps:denied")); } catch {}
    }
    return result;
  } catch (err) {
    return {
      success: false,
      data: null,
      error: {
        code: "E_INTERNAL",
        message: err instanceof Error ? err.message : "IPC bridge failure",
        retryable: false
      }
    };
  }
}
function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  electron.ipcRenderer.on(channel, listener);
  return () => {
    electron.ipcRenderer.removeListener(channel, listener);
  };
}
const api = {
  app: {
    info: () => call("__app.info"),
    openLogs: () => electron.ipcRenderer.invoke(IPC.openLogs),
    displayGet: () => electron.ipcRenderer.invoke(IPC.displayGet),
    displaySet: (prefs) => electron.ipcRenderer.invoke(IPC.displaySet, prefs)
  },
  updates: {
    status: () => electron.ipcRenderer.invoke(IPC.updateStatus),
    check: () => electron.ipcRenderer.invoke(IPC.updateCheck),
    install: () => electron.ipcRenderer.invoke(IPC.updateInstall),
    onStatus: (cb) => subscribe(IPC.updateChanged, cb)
  },
  core: {
    ping: () => call("core.ping"),
    info: () => call("core.info"),
    stats: () => call("core.stats"),
    /** Latest supervisor snapshot; pair with onStatus to avoid missing early pushes. */
    status: () => electron.ipcRenderer.invoke(IPC.coreStatusSnapshot),
    restart: () => electron.ipcRenderer.invoke(IPC.coreRestart),
    onStatus: (cb) => subscribe(IPC.coreStatus, cb),
    onEvent: (cb) => subscribe(IPC.coreEvent, cb)
  },
  auth: {
    /**
     * `userId` is null for the normal floor sign-in: the PIN identifies the
     * member of staff on its own. Pass an id only where one is already known.
     */
    listUsers: () => call("auth.listUsers"),
    login: (userId, pin, newPin) => /* POS_DEFAULT_PIN_v1 */ call("auth.login", newPin ? { userId: userId ?? "", pin, newPin } : { userId: userId ?? "", pin }),
    updateUser: (input) => call("users.update", input),
    setPin: (userId, pin) => call("users.setPin", { userId, pin }),
    logout: () => call("auth.logout"),
    verifyManagerPin: (pin, action) => call("auth.verifyManagerPin", { pin, action }),
    /** Latest main-held session; pair with onSession (pull-then-subscribe). */
    session: () => electron.ipcRenderer.invoke(IPC.sessionGet),
    onSession: (cb) => subscribe(IPC.sessionChanged, cb)
  },
  files: {
    /** Asks main to write text to a file the operator picks. */
    saveText: (filename, text) => call("files.saveText", { filename, text }),
    /** Renders HTML to PDF in a hidden window, so the till keeps working. */
    savePdf: (filename, html) => call("files.savePdf", { filename, html }, { timeoutMs: 60000 })
  },

  inventory: {
    warehouses: () => call("warehouses.list"),
    saveWarehouse: (input) => call("warehouses.save", input),
    ingredients: (search) => call("ingredients.list", { search: search ?? "" }),
    saveIngredient: (input) => call("ingredients.save", input),
    deactivateIngredient: (ingredientId) => call("ingredients.deactivate", { ingredientId }),
    levels: (warehouseId) => call("inventory.levels", { warehouseId: warehouseId ?? "" }),
    lowStock: () => call("inventory.lowStock"),
    /** Kalkulyasiya: every dish costed from its recipe at today's prices. */
    costing: () => call("reports.costing", {}, { timeoutMs: 15000 }),
    valuation: (warehouseId) => call("inventory.valuation", { warehouseId: warehouseId ?? "" }),
    movements: (params) => call("inventory.movements", params ?? {}),
    adjust: (input) => call("inventory.adjust", input),
    waste: (input) => call("inventory.waste", input),
    transfer: (input) => call("inventory.transfer", input),
    recipe: (menuItemId) => call("recipes.get", { menuItemId }),
    saveRecipe: (menuItemId, lines) => call("recipes.save", { menuItemId, lines }),
    stocktakes: () => call("stocktake.list"),
    createStocktake: (warehouseId) => call("stocktake.create", { warehouseId: warehouseId ?? "" }),
    getStocktake: (stocktakeId) => call("stocktake.get", { stocktakeId }),
    countLine: (lineId, countedMilli) => call("stocktake.count", { lineId, countedMilli }),
    postStocktake: (stocktakeId) => call("stocktake.post", { stocktakeId }, { timeoutMs: 30000 })
  },

  suppliers: {
    list: () => call("suppliers.list"),
    save: (input) => call("suppliers.save", input),
    ledger: (supplierId) => call("suppliers.ledger", { supplierId }),
    pay: (input) => call("suppliers.pay", input),
    purchases: () => call("purchases.list"),
    purchase: (purchaseId) => call("purchases.get", { purchaseId }),
    savePurchase: (input) => call("purchases.save", input),
    receive: (purchaseId) => call("purchases.receive", { purchaseId }, { timeoutMs: 30000 })
  },

  guests: {
    list: (search) => call("customers.list", { search: search ?? "" }),
    get: (customerId) => call("customers.get", { customerId }),
    save: (input) => call("customers.save", input),
    deactivate: (customerId) => call("customers.deactivate", { customerId }),
    ledger: (customerId) => call("customers.ledger", { customerId }),
    charge: (input) => call("customers.charge", input),
    payDebt: (input) => call("customers.payDebt", input),
    earnPoints: (input) => call("loyalty.earn", input),
    redeemPoints: (input) => call("loyalty.redeem", input),
    pointsLedger: (customerId) => call("loyalty.ledger", { customerId })
  },

  reservations: {
    list: (params) => call("reservations.list", params ?? {}),
    save: (input) => call("reservations.save", input),
    setStatus: (reservationId, status) => call("reservations.setStatus", { reservationId, status }),
    seat: (reservationId, orderId) => call("reservations.seat", { reservationId, orderId })
  },

  delivery: {
    couriers: () => call("couriers.list"),
    saveCourier: (input) => call("couriers.save", input),
    list: (status) => call("delivery.list", { status: status ?? "" }),
    create: (input) => call("delivery.create", input),
    assign: (deliveryId, courierId) => call("delivery.assign", { deliveryId, courierId }),
    setStatus: (deliveryId, status, note) => call("delivery.setStatus", { deliveryId, status, note }),
    courierReport: (params) => call("delivery.courierReport", params ?? {})
  },

  roster: {
    shifts: (params) => call("schedule.list", params ?? {}),
    saveShift: (input) => call("schedule.save", input),
    removeShift: (shiftId) => call("schedule.remove", { shiftId }),
    clockIn: (userId) => call("attendance.clockIn", userId ? { userId } : {}),
    clockOut: (userId, note) => call("attendance.clockOut", { userId, note }),
    attendance: (params) => call("attendance.list", params ?? {})
  },

  /** Reports as CSV text; the renderer asks main to write the file. */
  reportExport: {
    csv: (kind, from, to) => call("reports.export", { kind, from, to }, { timeoutMs: 30000 })
  },

  roles: {
    /** Every permission key the core knows, grouped by what it governs. */
    catalogue: () => call("permissions.list"),
    list: () => call("roles.list"),
    /** Creates when `id` is absent; `permissions` replaces the whole set. */
    save: (role) => call("roles.save", role),
    remove: (roleId) => call("roles.delete", { roleId })
  },
  users: {
    list: () => call("users.list"),
    create: (payload, options) => call("users.create", payload, options),
    deactivate: (userId, options) => call("users.deactivate", { userId }, options)
  },
  products: {
    list: (params) => call("catalog.products", params),
    get: (productId, includeDrafts = false) => call("catalog.product", { productId, includeDrafts }),
    categories: () => call("catalog.categories"),
    modifierGroups: (productId) => call("catalog.modifierGroups", productId ? { productId } : {}),
    setAvailability: (productId, available) => call("catalog.setAvailability", { productId, available })
  },
  tables: {
    list: () => call("tables.list"),
    get: (tableId) => call("tables.get", { tableId }),
    setStatus: (tableId, status) => call("tables.setStatus", { tableId, status }),
    transfer: (fromTableId, toTableId, versions, options) => call(
      "tables.transfer",
      {
        fromTableId,
        toTableId,
        expectedFromVersion: versions?.expectedVersionFrom,
        expectedToVersion: versions?.expectedVersionTo
      },
      options
    ),
    merge: (sourceTableIds, targetTableId, versions, options) => call(
      "tables.merge",
      {
        sourceTableIds,
        targetTableId,
        expectedFromVersion: versions?.expectedVersionFrom,
        expectedToVersion: versions?.expectedVersionTo
      },
      options
    ),
    split: (tableId, itemIds, toTableId, options) => call("tables.split", { tableId, itemIds, toTableId }, options),
    previewTransfer: (fromTableId, toTableId) => call("tables.previewTransfer", { fromTableId, toTableId }),
    // Same from/to naming as transfer and merge - the A/B spelling was a third
    // name for one concept and made the callers easy to get wrong.
    swap: (tableIdA, tableIdB, versions, options) => call(
      "tables.swap",
      {
        tableIdA,
        tableIdB,
        expectedFromVersion: versions?.expectedVersionFrom,
        expectedToVersion: versions?.expectedVersionTo
      },
      options
    ),
    transferItems: (input, options) => call(
      "tables.transferItems",
      {
        fromTableId: input.fromTableId,
        toTableId: input.toTableId,
        items: input.items,
        expectedFromVersion: input.expectedVersionFrom,
        expectedToVersion: input.expectedVersionTo
      },
      options
    ),
    updateLayout: (tables, options) => call("tables.updateLayout", { tables }, options),
    upsertArea: (payload, options) => call("tables.upsertArea", payload, options),
    archiveArea: (areaId) => call("tables.archiveArea", { areaId }),
    upsertTable: (payload, options) => call("tables.upsertTable", payload, options),
    archiveTable: (tableId) => call("tables.archiveTable", { tableId })
  },
  businessDay: {
    current: () => call("businessDay.current"),
    open: (openingFloatMinor, note, options) => call("businessDay.open", { openingFloatMinor, note }, options),
    readiness: (businessDayId) => call("businessDay.readiness", { businessDayId }),
    // No counted-cash figure: the drawer is never counted into the system.
    close: (businessDayId, note, options) => call("businessDay.close", { businessDayId, note }, options)
  },
  gifts: {
    listCampaigns: (activeOnly = true) => call("gifts.listCampaigns", { activeOnly }),
    upsertCampaign: (payload, options) => call("gifts.upsertCampaign", payload, options),
    evaluateOrder: (orderId) => call("gifts.evaluateOrder", { orderId }),
    apply: (orderId, campaignId, tierId, options) => call("gifts.apply", { orderId, campaignId, tierId }, options),
    approveReview: (orderId, managerPin) => call("gifts.approveReview", { orderId, managerPin })
  },
  cash: {
    list: (businessDayId) => call("cash.list", { businessDayId }),
    movement: (input, options) => call("cash.movement", input, options)
  },
  catalogAdmin: {
    pickImage: () => electron.ipcRenderer.invoke(IPC.catalogPickImage),
    upsertCategory: (payload, options) => call("catalog.upsertCategory", payload, options),
    archiveCategory: (categoryId) => call("catalog.archiveCategory", { categoryId }),
    upsertProduct: (payload, options) => call("catalog.upsertProduct", payload, options),
    archiveProduct: (productId) => call("catalog.archiveProduct", { productId }),
    setSoldOut: (productId, soldOut) => call("catalog.setSoldOut", { productId, soldOut }),
    setImageHidden: (productId, imageHidden) => call("catalog.setImageHidden", { productId, imageHidden }),
    setAllImagesHidden: (imageHidden) => call("catalog.setAllImagesHidden", {
      imageHidden
    }),
    priceHistory: (productId) => call("catalog.priceHistory", { productId }),
    upsertModifierGroup: (payload, options) => call("catalog.upsertModifierGroup", payload, options),
    upsertModifier: (payload, options) => call("catalog.upsertModifier", payload, options),
    archiveModifier: (modifierId) => call("catalog.archiveModifier", { modifierId }),
    setProductModifierGroups: (productId, groupIds, options) => call("catalog.setProductModifierGroups", { productId, groupIds }, options),
    importPreview: (csvText, filename) => call("catalog.importPreview", { csvText, filename }),
    importCommit: (batchId, options) => call("catalog.importCommit", { batchId }, options),
    export: () => call("catalog.export")
  },
  license: {
    status: () => call("license.status"),
    activate: (activationKey, options) => call("license.activate", { activationKey }, options),
    lookup: (activationKey) => call("license.lookup", { activationKey }),
    /** Pass file contents, or omit to open a native `.cposlic` file dialog in main. */
    importOffline: (licenseFileContents, options) => call(
      "license.importOffline",
      licenseFileContents !== void 0 ? { licenseFileContents } : {},
      options
    ),
    /** Builds a signed request and opens a native save dialog for `.cposreq`. */
    exportOfflineRequest: () => call("license.exportOfflineRequest"),
    heartbeat: () => call("license.heartbeat")
  },
  /**
   * Owner alert bot. Pairing is per restaurant: the QR links this customer's
   * WhatsApp, and X/Z reports then arrive on the number saved here.
   */
  /** Live support: ask the office for help and read the reply, from the till. */
  support: {
    request: (message) => call("support.request", { message }),
    thread: () => call("support.thread"),
    /** Downloads an attachment then asks the OS to open it. */
    attachment: (attachmentId, fileName) => call(
      "support.attachment",
      { attachmentId, fileName },
      { timeoutMs: 12e4 }
    )
  },
  whatsapp: {
    get: () => call("whatsapp.get"),
    status: () => call("whatsapp.status"),
    /** Starts (or reuses) a pairing session and resolves once a QR exists. */
    connect: (options) => call("whatsapp.connect", {}, options),
    disconnect: () => call("whatsapp.disconnect"),
    save: (input) => call("whatsapp.save", input),
    test: (phone) => call("whatsapp.test", phone ? { phone } : {})
  },
  tenant: {
    status: () => call("tenant.status"),
    login: (email, password, controlUrl) => call("tenant.login", { email, password, controlUrl }),
    logout: () => call("tenant.logout"),
    openPaymentUrl: (url) => call("tenant.openPaymentUrl", url ? { url } : {})
  },
  backup: {
    create: (note, options) => call("backup.create", { note }, options),
    list: () => call("backup.list"),
    restorePreview: (backupId) => call("backup.restorePreview", { backupId }),
    restore: (backupId, adminPin, options) => call("backup.restore", { backupId, adminPin }, options)
  },
  orders: {
    create: (input, options) => call("orders.create", input, options),
    get: (orderId) => call("orders.get", { orderId }),
    list: (params) => call("orders.list", params),
    /** Settled bills, so a guest who disputes a charge can still be found. */
    closedList: (params) => call("orders.closedList", params ?? {}),
    addItem: (input, options) => call("orders.addItem", input, options),
    updateItemQuantity: (orderId, itemId, quantity) => call("orders.updateItemQuantity", { orderId, itemId, quantity }),
    setItemNote: (orderId, itemId, note) => call("orders.setItemNote", { orderId, itemId, note }),
    setItemSeat: (orderId, itemId, seat) => call("orders.setItemSeat", { orderId, itemId, seat }),
    setItemCourse: (orderId, itemId, course) => call("orders.setItemCourse", { orderId, itemId, course }),
    holdItem: (orderId, itemId, held) => call("orders.holdItem", { orderId, itemId, held }),
    removeItem: (orderId, itemId) => call("orders.removeItem", { orderId, itemId }),
    voidItem: (orderId, itemId, reason, managerPin) => call("orders.voidItem", { orderId, itemId, reason, managerPin }),
    applyDiscount: (orderId, discount, managerPin) => call("orders.applyDiscount", { orderId, ...discount, managerPin }),
    setDeposit: (orderId, depositMinor) => call("orders.setDeposit", { orderId, depositMinor }),
    setGuestCount: (orderId, guestCount) => call("orders.setGuestCount", { orderId, guestCount }),
    submit: (orderId, options) => call("orders.submit", { orderId }, options),
    close: (orderId, options) => call("orders.close", { orderId }, options),
    void: (orderId, reason, managerPin, options) => call("orders.void", { orderId, reason, managerPin }, options)
  },
  kds: {
    list: (params) => call("kds.list", params),
    setStatus: (jobId, status) => call("kds.setStatus", { jobId, status }),
    bump: (jobId) => call("kds.bump", { jobId })
  },
  receipts: {
    preview: (orderId, kind = "customer_receipt", options) => call("receipts.preview", { orderId, kind, ...options }),
    get: (receiptId) => call("receipts.get", { receiptId }),
    /**
     * The sale behind the code printed on a guest's receipt.
     *
     * Answers what is still refundable per payment and per line, so the
     * counter can decide without a second round trip.
     */
    lookupByCode: (code) => call("receipts.lookupByCode", { code })
  },
  print: {
    enqueue: (input, options) => call("print.enqueue", input, options),
    jobs: (params) => call("print.jobs", params),
    retry: (jobId) => call("print.retry", { jobId }),
    cancel: (jobId) => call("print.cancel", { jobId }),
    printers: () => call("print.printers"),
    /**
     * Enumerates every attached printer and, with `probe`, sends each one a
     * short page until one produces paper. The winner is stored as the target,
     * so an unknown USB printer needs no configuration at all.
     */
    detect: (input, options) => call("print.detect", input ?? {}, options),
    setPrinter: (target, printerName, settings) => call("print.setPrinter", { target, printerName, settings }),
    previewTest: (options) => call("print.previewTest", options ?? {})
  },
  shifts: {
    current: () => call("shifts.current"),
    open: (openingFloatMinor, options) => call("shifts.open", { openingFloatMinor }, options),
    close: (closingCashMinor, options) => call("shifts.close", { closingCashMinor }, options)
  },
  settings: {
    getAll: () => call("settings.getAll"),
    set: (key, value) => call("settings.set", { key, value })
  },
  receiptLogo: {
    /**
     * `dataUrl` is the on-screen preview; `raster` is the same mark thresholded
     * to 1 bpp at the print head's dot width. The renderer produces both on a
     * canvas so the core never needs an image decoder.
     */
    apply: (logo) => call("receiptLogo.apply", logo),
    clear: () => call("receiptLogo.clear")
  },
  audit: {
    list: (params) => call("audit.list", params)
  },
  reports: {
    dashboard: () => call("reports.dashboard"),
    topProducts: (limit) => call("reports.topProducts", { limit }),
    salesSummary: (params) => call("reports.salesSummary", params),
    /**
     * Takings between two instants, on the payment clock, with optional
     * local-time hour/day buckets. Drives both the period receipt and the
     * dashboard's hourly view.
     */
    period: (params) => call("reports.period", params),
    x: (businessDayId, options) => call("reports.x", { businessDayId }, options),
    // Same operation as businessDay.close; the core now registers it for real
    // rather than this being an alias.
    z: (businessDayId, note, options) => call("reports.z", { businessDayId, note }, options),
    list: (businessDayId) => call("reports.list", { businessDayId }),
    getSnapshot: (snapshotId) => call("reports.getSnapshot", { snapshotId })
  },
  payments: {
    list: (orderId) => call("payments.list", { orderId }),
    get: (paymentId) => call("payments.get", { paymentId }),
    createCash: (input, options) => call("payments.createCash", input, options),
    createCard: (input, options) => call("payments.createCard", input, options),
    createMixed: (input, options) => call("payments.createMixed", input, options),
    /** `parts` as a number splits equally; as an array it defines each part. */
    splitBill: (input, options) => call("payments.splitBill", input, options),
    cancel: (paymentId) => call("payments.cancel", { paymentId }),
    reconcile: (paymentId, resolution, managerPin) => call("payments.reconcile", { paymentId, resolution, managerPin }),
    refund: (input, options) => call("payments.refund", input, options),
    listRefunds: (paymentId) => call("payments.listRefunds", { paymentId }),
    unresolved: () => call("payments.unresolved"),
    /**
     * Control over the mock terminal (force approve/decline/timeout).
     *
     * The core requires `settings.manage` for it, so a cashier or waiter cannot
     * force a card decline on a shipped till.
     */
    simulate: (mode) => call("payments.simulate", { mode })
  },
  sync: {
    status: () => call("sync.status"),
    outbox: (limit) => call("sync.outbox", { limit })
  }
};
electron.contextBridge.exposeInMainWorld("pos", api);
