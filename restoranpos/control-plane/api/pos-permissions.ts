/**
 * What each product can be told to do, per product.
 *
 * The two tills do not share a permission vocabulary: the restaurant core
 * checks dotted lowercase keys (`settings.manage`), the market core checks
 * SCREAMING_SNAKE (`MANAGE_SETTINGS`). Serving one catalogue for both is how
 * a panel ends up promising a right the till has never heard of - it says
 * "granted" and nothing changes on the floor.
 *
 * Generated from each product's own source of truth: the restaurant list from
 * its Azerbaijani catalogue patch, the market list from migration
 * 004_role_catalogue.sql. Regenerate rather than hand-edit.
 */
export type PosProduct = "restaurant" | "market";
export type PermissionEntry = { key: string; label: string; hint?: string };
export type PermissionGroup = { key: string; label: string; permissions: PermissionEntry[] };

export const POS_PRODUCTS: PosProduct[] = ["restaurant", "market"];

export function isPosProductKey(value: unknown): value is PosProduct {
  return value === "restaurant" || value === "market";
}

const CATALOGUE: Record<PosProduct, PermissionGroup[]> = {
  "restaurant": [
    {
      "key": "inventory",
      "label": "Anbar və stok",
      "permissions": [
        {
          "key": "inventory.adjust",
          "label": "Stok düzəlişi və silinmə",
          "hint": "Qalığı düzəltmək, itki və zay yazmaq"
        },
        {
          "key": "inventory.count",
          "label": "İnventarizasiya",
          "hint": "Sayım aparmaq və yekunlaşdırmaq"
        },
        {
          "key": "inventory.manage",
          "label": "Anbar və xammal kartları",
          "hint": "Anbar və xammal yaratmaq, redaktə etmək"
        },
        {
          "key": "inventory.transfer",
          "label": "Anbarlararası transfer",
          "hint": "Malı bir anbardan digərinə köçürmək"
        },
        {
          "key": "inventory.view",
          "label": "Stok qalığına baxmaq",
          "hint": "Qalıqlar və mal hərəkətləri"
        }
      ]
    },
    {
      "key": "audit",
      "label": "Audit",
      "permissions": [
        {
          "key": "audit.view",
          "label": "Audit jurnalına baxmaq",
          "hint": "Kimin nə etdiyinin tarixçəsi"
        }
      ]
    },
    {
      "key": "delivery",
      "label": "Çatdırılma",
      "permissions": [
        {
          "key": "delivery.assign",
          "label": "Kuryer təyin etmək",
          "hint": "Sifarişi kuryerə vermək və statusu irəlilətmək"
        },
        {
          "key": "delivery.manage",
          "label": "Çatdırılmanı idarə etmək",
          "hint": "Çatdırılma yaratmaq və kuryerləri idarə etmək"
        },
        {
          "key": "delivery.view",
          "label": "Çatdırılmaya baxmaq",
          "hint": "Çatdırılma sifarişləri və kuryer hesabatları"
        }
      ]
    },
    {
      "key": "receipt",
      "label": "Çek",
      "permissions": [
        {
          "key": "receipt.print",
          "label": "Çek çap etmək",
          "hint": "Çek çapı və təkrar çap"
        }
      ]
    },
    {
      "key": "discount",
      "label": "Endirimlər",
      "permissions": [
        {
          "key": "discount.manage",
          "label": "Endirim qaydaları",
          "hint": "Endirim qaydalarını təyin etmək"
        }
      ]
    },
    {
      "key": "reports",
      "label": "Hesabatlar",
      "permissions": [
        {
          "key": "reports.export",
          "label": "Hesabatı ixrac etmək",
          "hint": "Excel və ya PDF-ə çıxarmaq"
        },
        {
          "key": "reports.view",
          "label": "Hesabatlara baxmaq",
          "hint": "Satış və əməliyyat hesabatları"
        },
        {
          "key": "reports.x",
          "label": "X hesabatı",
          "hint": "Gün ərzində aralıq hesabat almaq"
        },
        {
          "key": "reports.z",
          "label": "Z hesabatı",
          "hint": "Gün sonu hesabatı almaq"
        }
      ]
    },
    {
      "key": "gifts",
      "label": "Hədiyyələr",
      "permissions": [
        {
          "key": "gifts.manage",
          "label": "Hədiyyə kampaniyaları",
          "hint": "Kampaniyaları qurmaq və dəyişmək"
        },
        {
          "key": "gifts.override",
          "label": "Hədiyyəni təsdiqləmək",
          "hint": "Yoxlamadan keçirmə icazəsi vermək"
        }
      ]
    },
    {
      "key": "users",
      "label": "İstifadəçilər",
      "permissions": [
        {
          "key": "users.manage",
          "label": "İşçiləri idarə etmək",
          "hint": "İşçi yaratmaq və deaktiv etmək"
        }
      ]
    },
    {
      "key": "businessDay",
      "label": "İş günü",
      "permissions": [
        {
          "key": "businessDay.manage",
          "label": "İş gününü açıb-bağlamaq",
          "hint": "Gün açılışı, bağlanışı və Z hesabatı"
        }
      ]
    },
    {
      "key": "schedule",
      "label": "İş qrafiki",
      "permissions": [
        {
          "key": "schedule.clock",
          "label": "Gəliş-gediş qeydi",
          "hint": "İşə giriş və çıxış vurmaq"
        },
        {
          "key": "schedule.manage",
          "label": "Qrafiki idarə etmək",
          "hint": "Növbə planlamaq və dəyişmək"
        },
        {
          "key": "schedule.view",
          "label": "Qrafikə baxmaq",
          "hint": "Növbələr və davamiyyət"
        }
      ]
    },
    {
      "key": "cash",
      "label": "Kassa",
      "permissions": [
        {
          "key": "cash.manage",
          "label": "Kassa əməliyyatları",
          "hint": "Kassaya mədaxil/məxaric və çekmecə"
        }
      ]
    },
    {
      "key": "license",
      "label": "Lisenziya",
      "permissions": [
        {
          "key": "license.manage",
          "label": "Lisenziya",
          "hint": "Aktivləşdirmə və lisenziya statusu"
        }
      ]
    },
    {
      "key": "tables",
      "label": "Masalar",
      "permissions": [
        {
          "key": "tables.layout",
          "label": "Masa sxemi",
          "hint": "Zal planını redaktə etmək"
        },
        {
          "key": "tables.status",
          "label": "Masa statusu",
          "hint": "Masanın vəziyyətini dəyişmək"
        }
      ]
    },
    {
      "key": "catalog",
      "label": "Menyu və kataloq",
      "permissions": [
        {
          "key": "catalog.import",
          "label": "Kataloqu idxal/ixrac etmək",
          "hint": "Menyunu CSV ilə yükləmək və çıxarmaq"
        },
        {
          "key": "catalog.manage",
          "label": "Menyunu idarə etmək",
          "hint": "Kateqoriya, məhsul və qiymət dəyişmək"
        }
      ]
    },
    {
      "key": "kds",
      "label": "Mətbəx ekranı",
      "permissions": [
        {
          "key": "kds.operate",
          "label": "Mətbəx ekranını idarə etmək",
          "hint": "Sifariş statuslarını dəyişmək"
        },
        {
          "key": "kds.view",
          "label": "Mətbəx ekranına baxmaq",
          "hint": "Hazırlanan sifarişləri görmək"
        }
      ]
    },
    {
      "key": "customers",
      "label": "Müştərilər",
      "permissions": [
        {
          "key": "customers.credit",
          "label": "Müştəri borcu",
          "hint": "Borc yazmaq və borc ödənişi qəbul etmək"
        },
        {
          "key": "customers.loyalty",
          "label": "Bonus balları",
          "hint": "Bal qazandırmaq və xərcləmək"
        },
        {
          "key": "customers.manage",
          "label": "Müştəri yaratmaq və redaktə etmək",
          "hint": "Müştəri kartlarını idarə etmək"
        },
        {
          "key": "customers.view",
          "label": "Müştərilərə baxmaq",
          "hint": "Müştəri, borc və bal məlumatı"
        }
      ]
    },
    {
      "key": "shift",
      "label": "Növbə",
      "permissions": [
        {
          "key": "shift.manage",
          "label": "Növbəni idarə etmək",
          "hint": "Növbə açmaq və bağlamaq"
        }
      ]
    },
    {
      "key": "payment",
      "label": "Ödəniş və kassa",
      "permissions": [
        {
          "key": "payment.reconcile",
          "label": "Kassa uzlaşdırması",
          "hint": "Gün sonu kassanı uzlaşdırmaq"
        },
        {
          "key": "payment.refund",
          "label": "Geri qaytarma",
          "hint": "Ödənişi müştəriyə qaytarmaq"
        },
        {
          "key": "payment.split",
          "label": "Hesabı bölmək",
          "hint": "Hesabı bir neçə ödənişə bölmək"
        },
        {
          "key": "payment.take",
          "label": "Ödəniş qəbul etmək",
          "hint": "Nağd, kart və digər ödəniş növləri"
        },
        {
          "key": "payment.view",
          "label": "Ödənişlərə baxmaq",
          "hint": "Hesabda alınmış ödənişləri görmək"
        }
      ]
    },
    {
      "key": "printer",
      "label": "Printer",
      "permissions": [
        {
          "key": "printer.manage",
          "label": "Printer ayarları",
          "hint": "Printeri qurmaq, çapı təkrarlamaq və ləğv etmək"
        }
      ]
    },
    {
      "key": "recipes",
      "label": "Reseptlər",
      "permissions": [
        {
          "key": "recipes.manage",
          "label": "Reseptlər",
          "hint": "Məhsulun nədən hazırlandığını təyin etmək"
        }
      ]
    },
    {
      "key": "reservations",
      "label": "Rezervasiyalar",
      "permissions": [
        {
          "key": "reservations.manage",
          "label": "Rezervasiyanı idarə etmək",
          "hint": "Rezerv yaratmaq, köçürmək, ləğv etmək"
        },
        {
          "key": "reservations.view",
          "label": "Rezervasiyalara baxmaq",
          "hint": "Masa rezervlərini görmək"
        }
      ]
    },
    {
      "key": "roles",
      "label": "Rollar və səlahiyyətlər",
      "permissions": [
        {
          "key": "roles.manage",
          "label": "Rol və səlahiyyətlər",
          "hint": "Rol yaratmaq və səlahiyyət vermək"
        }
      ]
    },
    {
      "key": "order",
      "label": "Sifarişlər",
      "permissions": [
        {
          "key": "order.closeOther",
          "label": "Başqasının sifarişini bağlamaq",
          "hint": "Öz sifarişi olmayanı da bağlamaq"
        },
        {
          "key": "order.create",
          "label": "Sifariş yaratmaq",
          "hint": "Yeni sifariş açmaq və məhsul əlavə etmək"
        },
        {
          "key": "order.discount",
          "label": "Sifarişə endirim tətbiq etmək",
          "hint": "Hesaba faiz və ya məbləğlə endirim"
        },
        {
          "key": "order.priceOverride",
          "label": "Qiyməti əl ilə dəyişmək",
          "hint": "Sifarişdə məhsulun qiymətini dəyişmək"
        },
        {
          "key": "order.transfer",
          "label": "Sifarişi köçürmək",
          "hint": "Hesabı başqa masaya köçürmək"
        },
        {
          "key": "order.view",
          "label": "Sifarişlərə baxmaq",
          "hint": "Sifarişlər və onların tarixçəsi"
        },
        {
          "key": "order.void",
          "label": "Sifarişi ləğv etmək",
          "hint": "Sifarişi və ya içindəki məhsulu ləğv etmək"
        }
      ]
    },
    {
      "key": "suppliers",
      "label": "Təchizatçılar və alış",
      "permissions": [
        {
          "key": "suppliers.manage",
          "label": "Təchizatçı və alış sifarişi",
          "hint": "Təchizatçı yaratmaq, alış sifarişini redaktə etmək"
        },
        {
          "key": "suppliers.pay",
          "label": "Təchizatçıya ödəniş",
          "hint": "Alış fakturasını ödəmək"
        },
        {
          "key": "suppliers.receive",
          "label": "Mal qəbulu",
          "hint": "Gələn malı anbara qəbul etmək"
        },
        {
          "key": "suppliers.view",
          "label": "Təchizatçılara baxmaq",
          "hint": "Təchizatçılar və alışlar"
        }
      ]
    },
    {
      "key": "settings",
      "label": "Tənzimləmələr",
      "permissions": [
        {
          "key": "settings.manage",
          "label": "Tənzimləmələr",
          "hint": "Sistem və restoran ayarları"
        }
      ]
    },
    {
      "key": "backup",
      "label": "Yedəkləmə",
      "permissions": [
        {
          "key": "backup.manage",
          "label": "Yedəkləmə və bərpa",
          "hint": "Yerli ehtiyat nüsxə yaratmaq və geri qaytarmaq"
        }
      ]
    }
  ],
  "market": [
    {
      "key": "satis",
      "label": "Satış",
      "permissions": [
        {
          "key": "SALE_DISCOUNT",
          "label": "Endirim tətbiq etmək"
        },
        {
          "key": "SALE_CANCEL",
          "label": "Satışı ləğv etmək"
        },
        {
          "key": "SALE_REFUND",
          "label": "Geri qaytarma"
        },
        {
          "key": "PARTIAL_REFUND",
          "label": "Qismən geri qaytarma"
        },
        {
          "key": "PRICE_OVERRIDE",
          "label": "Qiyməti dəyişmək"
        },
        {
          "key": "HOLD_CANCEL",
          "label": "Gözləyən satışı ləğv etmək"
        }
      ]
    },
    {
      "key": "kassa",
      "label": "Kassa",
      "permissions": [
        {
          "key": "OPEN_DRAWER",
          "label": "Kassa şüşəsini açmaq"
        },
        {
          "key": "CASH_IN",
          "label": "Kassaya pul girişi"
        },
        {
          "key": "CASH_OUT",
          "label": "Kassadan pul çıxışı"
        },
        {
          "key": "SAFE_DROP",
          "label": "Seyfə köçürmə"
        },
        {
          "key": "CLOSE_SHIFT",
          "label": "Növbəni bağlamaq"
        }
      ]
    },
    {
      "key": "menyu",
      "label": "Menyu və məhsul",
      "permissions": [
        {
          "key": "CREATE_PRODUCT",
          "label": "Məhsul yaratmaq"
        },
        {
          "key": "EDIT_PRODUCT",
          "label": "Məhsulu redaktə etmək"
        },
        {
          "key": "EDIT_PRICE",
          "label": "Qiyməti dəyişmək"
        },
        {
          "key": "VIEW_COST",
          "label": "Maya dəyərini görmək"
        }
      ]
    },
    {
      "key": "anbar",
      "label": "Anbar",
      "permissions": [
        {
          "key": "EDIT_STOCK",
          "label": "Stoku dəyişmək"
        },
        {
          "key": "STOCK_ADJUSTMENT",
          "label": "Stok düzəlişi"
        },
        {
          "key": "RECEIVE_PURCHASE",
          "label": "Mal qəbulu"
        },
        {
          "key": "TRANSFER_STOCK",
          "label": "Anbarlararası transfer"
        },
        {"key":"DOCS_VIEW","label":"Qaimələrə baxmaq"},
        {"key":"DOCS_CREATE","label":"Qaimə yaratmaq"},
        {"key":"DOCS_EDIT","label":"Qaimələrdə düzəliş etmək"},
        {"key":"DOCS_DELETE","label":"Qaimələri ləğv etmək"}
      ]
    },
    {
      "key": "hesabat",
      "label": "Hesabatlar",
      "permissions": [
        {
          "key": "VIEW_REPORTS",
          "label": "Hesabatlara baxmaq"
        },
        {
          "key": "VIEW_PROFIT",
          "label": "Mənfəəti görmək"
        }
      ]
    },
    {
      "key": "sistem",
      "label": "Sistem",
      "permissions": [
        {
          "key": "MANAGE_USERS",
          "label": "İstifadəçiləri idarə etmək"
        },
        {
          "key": "MANAGE_SETTINGS",
          "label": "Tənzimləmələri dəyişmək"
        },
        {
          "key": "MANAGE_ROLES",
          "label": "Rol və səlahiyyətləri idarə etmək"
        }
      ]
    }
  ]
};

export function catalogueFor(product: PosProduct): PermissionGroup[] {
  return CATALOGUE[product] ?? [];
}

/** Every key this product understands - the set an entitlement may draw from. */
export function allKeysFor(product: PosProduct): string[] {
  return catalogueFor(product).flatMap((g) => g.permissions.map((p) => p.key));
}

export function isKnownKey(product: PosProduct, key: string): boolean {
  return allKeysFor(product).includes(key);
}

/**
 * Essentials every till needs regardless of package: printing a receipt and
 * keeping the printer configured. Without these a sold POS cannot finish a sale.
 */
export const ALWAYS_ON_PERMISSIONS: Record<PosProduct, readonly string[]> = {
  restaurant: ["receipt.print", "printer.manage"],
  market: [],
};

export function alwaysOnFor(product: PosProduct): string[] {
  const known = new Set(allKeysFor(product));
  return (ALWAYS_ON_PERMISSIONS[product] ?? []).filter((key) => known.has(key));
}

/**
 * Narrows a role policy to what the customer is actually entitled to.
 *
 * Two layers, and this is the join between them: POSSISTEM grants a customer a
 * set of capabilities, and inside that set the customer's own manager hands
 * rights to staff. A key the customer was never sold cannot be handed out by
 * editing the policy, and an entitlement withdrawn later takes effect on the
 * till's next pull without anyone re-editing roles.
 *
 * `allowed` of null means "everything this product has" - the default for a
 * customer nobody has restricted.
 *
 * Çek and printer keys are always re-attached to every role so a restricted
 * package cannot leave a till unable to print.
 */
export function clampToEntitlements(
  product: PosProduct,
  roles: Array<{ name: string; permissions: string[] }>,
  allowed: string[] | null,
): Array<{ name: string; permissions: string[] }> {
  const known = new Set(allKeysFor(product));
  const always = alwaysOnFor(product);
  const grant =
    allowed === null
      ? known
      : new Set([...allowed.filter((k) => known.has(k)), ...always]);
  return roles.map((role) => {
    const next = new Set(role.permissions.filter((k) => grant.has(k)));
    for (const key of always) next.add(key);
    return { name: role.name, permissions: [...next] };
  });
}
