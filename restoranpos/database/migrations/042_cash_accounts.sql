-- Kassalar (1.7.23): named tills, the treasury and the bank, grouped by
-- branch (obyekt), each till fed by one sales point (PC).
--
-- Only new tables and columns; nothing existing is rebuilt.
--
--   cash_objects        - branches the kassas belong to.
--   cash_accounts       - till / treasury / bank. A till is tied to the PC
--                          (terminal_id) whose cash sales it receives.
--   cash_account_moves  - every movement that is not a sale: opening balance,
--                          transfers, salaries, debts, expenses... signed.
--   pos_terminals       - the PCs seen ringing up, so a till can be tied to one.
--   payments/refunds.terminal_id - which PC took the money.
--
-- A balance is never stored: sales since the account was opened plus its moves.

CREATE TABLE IF NOT EXISTS cash_objects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_accounts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('till','treasury','bank')),
    object_id    TEXT REFERENCES cash_objects(id),
    terminal_id  TEXT NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at   INTEGER NOT NULL
);

-- One sales point feeds one till.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_accounts_terminal
    ON cash_accounts(terminal_id) WHERE active = 1 AND kind = 'till' AND terminal_id != '';

CREATE TABLE IF NOT EXISTS cash_account_moves (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES cash_accounts(id),
    amount_minor  INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    ref_type      TEXT NOT NULL DEFAULT '',
    ref_id        TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    actor_user_id TEXT REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_account_moves ON cash_account_moves(account_id, created_at);

CREATE TABLE IF NOT EXISTS pos_terminals (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT '',
    last_seen_at  INTEGER NOT NULL
);

ALTER TABLE payments ADD COLUMN terminal_id TEXT NOT NULL DEFAULT '';
ALTER TABLE refunds ADD COLUMN terminal_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_payments_terminal ON payments(terminal_id, created_at);
