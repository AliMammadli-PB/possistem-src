# POS 1.5 security and customer builds

## Activation and device trust

- The control API signs licence payloads with Ed25519.
- The desktop verifies the signature, expiry, active state, and device fingerprint before the native core receives the licence.
- The first online activation pins the control signing key over HTTPS. A different or silently rotated key is rejected.
- Every activated till creates its own Ed25519 device key. Heartbeats include a signed timestamp and one-time nonce; the API rejects altered, stale, replayed, or differently keyed requests.
- The database migration `control/migrations/0013_device_proof.sql` stores the device public key and replay watermark.
- Heartbeats retry every 45–75 seconds. Owner data sync continues on its existing five-second schedule and queues safely while the network is down.

No client application can be literally unbreakable against an administrator who owns the machine. Production installers therefore add defence in depth: Windows code signing is mandatory, Electron ASAR integrity is enabled, unsafe Electron runtime switches are fused off, and the licence is bound to the physical till identity.

## Create a customer-specific POS

1. In the admin panel, create the customer and open the setup/branding section.
2. Set the product name, tagline, restaurant/market mode, font, density, colours, logo, background, product-image policy, and enabled modules.
3. Complete the sale. Download **Setup profilini yüklə** and keep the generated activation key in the customer's delivery record.
4. On the release machine, provide the Windows signing certificate through `CSC_LINK` and `CSC_KEY_PASSWORD`.
5. Build the customer's installer:

   `npm run package:customer -- --profile C:\profiles\milioner-pub.json`

The output is written to `release-customer-<customer-name>/` with a customer-specific executable, shortcut, installer name, and embedded bootstrap appearance. After activation, the signed server profile takes precedence, so later branding/module changes cannot be overridden by an old installer profile.

Unsigned customer installers are rejected. `POS_ALLOW_UNSIGNED_PACKAGE=1` exists only for isolated development and must never be used for delivery.

## Release checklist

- Apply the Postgres migration before deploying the API.
- Deploy the API and admin panel together because the activation and branding contracts changed.
- Build version 1.5.0 from the same source tree and sign the installer.
- Activate one clean test till, confirm a signed heartbeat appears within 75 seconds, then disconnect the network and confirm sales still work and sync resumes after reconnection.
- Keep signing private keys off developer workstations and never place them in customer profiles or source control.
