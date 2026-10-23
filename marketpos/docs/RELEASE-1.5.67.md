# Market POS 1.5.67

- Concurrent warehouse startup requests now wait for the same readiness result.
- A stopped warehouse retries startup before an authorized screen request or manual resync.
- Recovery UI retries the warehouse instead of offering to disable it. Startup failures are visible.
- Hidden remote branch frames no longer consume layout space or intercept controls.
- The branch selector stays visible while scrolling operation tabs.

Validation: TypeScript; startup recovery; permissions and manager approval; 4229-product cache; real-core warehouse create/edit/archive/return; 4229-product reconciliation; transfer revoke and waste workflows.

Customer diagnosis: Nermanov reported 1.5.66 on 2026-10-23; Genclik last reported 1.5.47 on 2026-10-21. No stock, HWID, PIN or financial history was reset. Windows client logs and current Genclik connectivity are required to confirm any remaining device-specific failure.
