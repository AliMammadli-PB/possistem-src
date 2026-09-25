-- ============================================================================
-- 017 - network receipt printer auto-detection
--
-- 016 replaced the hardcoded `tcp:192.168.1.200:9100` default with the sentinel
-- `auto`. Auto-detection at that point only knew about USB, serial and spooler
-- queues, so on a till whose printer lives on the switch it had nothing real to
-- choose from - and settled on whatever software queue happened to be
-- installed. On the restaurant's terminal that was `PanCafe Printer`: an
-- internet-café tool's queue on the `Microsoft Print To PDF` driver, pointed at
-- a .pdf file. The spooler accepted every ESC/POS receipt and reported success,
-- so the POS said the bill had printed while no paper ever moved.
--
-- Discovery now sweeps the LAN and confirms a device by its `DLE EOT 1` reply,
-- and `isSoftwarePrinter()` rejects file-backed queues whatever they are named.
-- This migration releases the tills that are still pinned to such a queue.
-- ============================================================================

-- Only queues that are provably file-backed are reset. A queue the operator
-- deliberately selected, and anything already pointing at a real device, is
-- left exactly as it is.
UPDATE app_settings
   SET value = 'auto',
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE key IN ('printer.receipt', 'printer.kitchen')
   AND (
        value = 'win:PanCafe Printer'
     OR value LIKE 'win:%Print to PDF%'
     OR value LIKE 'win:%Print To PDF%'
     OR value LIKE 'win:%XPS%'
     OR value LIKE 'win:%OneNote%'
     OR value LIKE 'win:%Fax%'
   );

-- `printer.kitchen` shipped defaulting to `virtual`, which writes the ticket to
-- a text file and reports success - a kitchen that never receives an order and
-- a POS that says every ticket printed. `auto` puts it through the same
-- discovery as the receipt printer, so a till with one printer prints kitchen
-- tickets on it, and a site that later adds a dedicated kitchen printer has it
-- found and offered in settings instead of having to be told it exists.
--
-- Only the untouched default is moved; an operator who deliberately chose
-- `virtual` (or any real device) keeps it.
UPDATE app_settings
   SET value = 'auto',
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE key = 'printer.kitchen'
   AND value IN ('virtual', '');

-- Cached location of the last printer that actually took a page. The MAC is
-- what survives a DHCP lease change: the next sweep re-finds the same device at
-- its new address instead of reporting the printer missing.
INSERT INTO app_settings (key, value, value_type, updated_at) VALUES
  ('printer.lastKnownIp',  '', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.lastKnownMac', '', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('printer.networkScan',  '1', 'string', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO NOTHING;
