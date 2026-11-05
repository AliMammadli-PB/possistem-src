# Restaurant POS 1.10.5

## Fixed

- **"Qaiməni ləğv et" opened empty, so nothing could be cancelled.** `psH` overwrote a `children` prop with nothing. The view dialog and the "Bax", "Düzəliş et", "Ləğv et" buttons in the document list had the same fault.
- **The recipe dialog squeezed to the right when a search found little.** The dialog body's `justify-content:flex-end` applied to the recipe grid.
- **Selling a doner did not take what is inside its sauce.** 1.10.4 converted only dishes shown on the sale screen, and only when the sauce had its recipe before the doner was saved. A sauce hidden from the sale screen now counts, and a dish that gets a recipe converts the lines already pointing at its stock card. Migration 071 does the same for existing recipes. A sauce that is a plain stock good with no dish behind it stays a stock line.
- **A paper never came out once the printer was back.** A waiting job moved only when the next print happened, and stopped after 5 tries with no button to resend.
  - The app now checks the queue every 15 s (`print.drain`), and retries at most a minute apart.
  - Receipts, kitchen tickets and reports wait up to 2 hours (`kPrintWaitsMs`), then become `failed`. A test page keeps the old limit of 5 tries.
  - "Yenidən çap et" appears on a failed job in the print screen's job list.

## Changed

- **A salary or an advance lives under İşçilər → Qaimələr only.** It is off Xərclər and its totals. Its money still leaves the till. "Maaş" is gone from the "+ Xərc" categories. An expense typed by hand under "Maaş" earlier has no salary document and stays in Xərclər.

## Checks

- Full native suite under Wine: 388 cases, with a doner sale taking meat and sauce ingredients, and a job that outlasts 5 tries, gives up at 2 hours, and a test page that does not.
- `scripts/qa-core-1933.mjs`, real core: tills from the diverged 1.9.25, 1.9.32, 1.9.34 and 1.10.2 reach schema 71; a hidden sauce on a 1.10.2 database converts and money stays.
- `scripts/qa-local-shared-categories1936.mjs`, real core and screens: the recipe keeps its width and left edge at 1536, 1000 and 390 px, the cancel dialog needs a reason and cancels, the view dialog has content, an advance is not in Xərclər and the till balance falls.
- Real core with a fake network printer: printer off, job waits; printer on, logged out, it prints once.
- `tests/unit`: 24 failures, the same list as on 1.10.4.

## Not tested

- **Paper out on a real printer.** A printer may accept the bytes into its buffer, and the job then reads as completed. Whether it prints once paper is in depends on the printer; on a Windows queue the spooler holds it. The Aclass printer was not attached.
- A real printer switched off and on through the new timer, a real Windows till, and how long a network printer that is off holds up the till on each try.
- The "Yenidən çap et" button and the conflict warning in Kassalar, on screen.

## Not included

- A fixed deposit per table. The owner portal. Market and the other tills.
