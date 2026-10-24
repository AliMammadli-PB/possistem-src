/**
 * The live mirror schema, applied by the API itself at boot.
 *
 * This database is the meeting point between the till and the WhatsApp bot:
 * the POS streams its floor in every few seconds, the bot answers questions
 * straight out of these tables and never has to wake the restaurant's PC.
 *
 * Everything is `IF NOT EXISTS` and additive, so a redeploy against a running
 * installation is a no-op. `scripts/setup-mysql-live.mjs` created the first two
 * tables over SSH; keeping the DDL in-process means a new control server needs
 * no manual step.
 */
import type { Pool } from 'mysql2/promise';

const TABLES: string[] = [
  // -- pre-existing, kept verbatim so an old install migrates cleanly ---------
  `CREATE TABLE IF NOT EXISTS device_status (
    customer_id CHAR(36) NOT NULL PRIMARY KEY,
    device_id CHAR(36) NULL,
    connected TINYINT(1) NOT NULL DEFAULT 0,
    app_version VARCHAR(64) NULL,
    restaurant_name VARCHAR(200) NULL,
    last_error VARCHAR(500) NULL,
    last_seen_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS floor_live (
    customer_id CHAR(36) NOT NULL PRIMARY KEY,
    device_id CHAR(36) NULL,
    open_tables INT NOT NULL DEFAULT 0,
    open_total_minor BIGINT NOT NULL DEFAULT 0,
    today_sales_minor BIGINT NOT NULL DEFAULT 0,
    today_paid_minor BIGINT NOT NULL DEFAULT 0,
    payment_count INT NOT NULL DEFAULT 0,
    business_date VARCHAR(32) NULL,
    payload JSON NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // -- the live mirror -------------------------------------------------------

  /** One row per restaurant, opened the moment the customer is created. */
  `CREATE TABLE IF NOT EXISTS customer_live (
    customer_id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(200) NULL,
    phone VARCHAR(64) NULL,
    notify_email VARCHAR(200) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** One row per table, so "which table is on how much" is a plain SELECT. */
  `CREATE TABLE IF NOT EXISTS table_live (
    customer_id CHAR(36) NOT NULL,
    table_id VARCHAR(64) NOT NULL,
    label VARCHAR(120) NOT NULL DEFAULT '',
    area_name VARCHAR(120) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'available',
    order_id VARCHAR(64) NULL,
    guest_count INT NOT NULL DEFAULT 0,
    item_count INT NOT NULL DEFAULT 0,
    total_minor BIGINT NOT NULL DEFAULT 0,
    paid_minor BIGINT NOT NULL DEFAULT 0,
    due_minor BIGINT NOT NULL DEFAULT 0,
    waiter_name VARCHAR(160) NULL,
    opened_at VARCHAR(40) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (customer_id, table_id),
    KEY table_live_open_idx (customer_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** Who the till knows, and who is signed in right now. */
  `CREATE TABLE IF NOT EXISTS staff_live (
    customer_id CHAR(36) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    code VARCHAR(32) NULL,
    full_name VARCHAR(160) NOT NULL DEFAULT '',
    role VARCHAR(64) NULL,
    shift_id VARCHAR(64) NULL,
    logged_in TINYINT(1) NOT NULL DEFAULT 0,
    logged_in_at DATETIME(3) NULL,
    last_seen_at DATETIME(3) NOT NULL,
    PRIMARY KEY (customer_id, user_id),
    KEY staff_live_active_idx (customer_id, logged_in)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** Today's money, one row per restaurant, every figure its own column. */
  `CREATE TABLE IF NOT EXISTS sales_live (
    customer_id CHAR(36) NOT NULL PRIMARY KEY,
    business_date VARCHAR(32) NULL,
    business_day_id VARCHAR(64) NULL,
    business_day_status VARCHAR(32) NULL,
    gross_minor BIGINT NOT NULL DEFAULT 0,
    net_minor BIGINT NOT NULL DEFAULT 0,
    paid_minor BIGINT NOT NULL DEFAULT 0,
    discount_minor BIGINT NOT NULL DEFAULT 0,
    tax_minor BIGINT NOT NULL DEFAULT 0,
    service_minor BIGINT NOT NULL DEFAULT 0,
    tips_minor BIGINT NOT NULL DEFAULT 0,
    refund_minor BIGINT NOT NULL DEFAULT 0,
    order_count INT NOT NULL DEFAULT 0,
    payment_count INT NOT NULL DEFAULT 0,
    avg_ticket_minor BIGINT NOT NULL DEFAULT 0,
    cash_minor BIGINT NOT NULL DEFAULT 0,
    card_minor BIGINT NOT NULL DEFAULT 0,
    open_tables INT NOT NULL DEFAULT 0,
    open_total_minor BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** Menu mirror: price lookups and "what sold today" without touching the POS. */
  `CREATE TABLE IF NOT EXISTS product_live (
    customer_id CHAR(36) NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL DEFAULT '',
    category_name VARCHAR(120) NULL,
    price_minor BIGINT NOT NULL DEFAULT 0,
    sold_out TINYINT(1) NOT NULL DEFAULT 0,
    available TINYINT(1) NOT NULL DEFAULT 1,
    qty_today INT NOT NULL DEFAULT 0,
    revenue_today_minor BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (customer_id, product_id),
    KEY product_live_name_idx (customer_id, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /** Last X and last Z, kept so "son hesabat" is instant. */
  `CREATE TABLE IF NOT EXISTS report_live (
    customer_id CHAR(36) NOT NULL,
    kind VARCHAR(8) NOT NULL,
    sequence_no INT NULL,
    business_date VARCHAR(32) NULL,
    totals_json JSON NULL,
    canonical_json JSON NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (customer_id, kind)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  /**
   * Work the bot hands to the till. The POS drains this on its sync tick; the
   * row is the audit trail of every remotely triggered action.
   */
  `CREATE TABLE IF NOT EXISTS bot_commands (
    id CHAR(36) NOT NULL PRIMARY KEY,
    customer_id CHAR(36) NOT NULL,
    command VARCHAR(64) NOT NULL,
    args_json JSON NULL,
    requested_by VARCHAR(64) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    result_json JSON NULL,
    error VARCHAR(500) NULL,
    error_code VARCHAR(64) NULL,
    created_at DATETIME(3) NOT NULL,
    taken_at DATETIME(3) NULL,
    done_at DATETIME(3) NULL,
    expires_at DATETIME(3) NOT NULL,
    KEY bot_commands_pending_idx (customer_id, status, created_at),
    KEY bot_commands_recent_idx (customer_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let ensured = false;

/**
 * Creates any missing live table. Safe to call repeatedly; runs once per process.
 *
 * A failure here must not stop the API from serving: the live mirror is an
 * enhancement, and the owner web app still works off Postgres.
 */
export async function ensureLiveSchema(
  pool: Pool,
  log?: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void },
): Promise<boolean> {
  if (ensured) return true;
  try {
    for (const ddl of TABLES) {
      await pool.query(ddl);
    }
    ensured = true;
    log?.info({ tables: TABLES.length }, 'mysql_live_schema_ready');
    return true;
  } catch (err) {
    log?.warn({ err }, 'mysql_live_schema_failed');
    return false;
  }
}
