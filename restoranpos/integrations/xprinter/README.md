# Xprinter Ethernet configuration

Official Xprinter Windows SDK 2.1.5, ESC variant, x64 `printer.sdk.dll`.
Source: https://www.xprintertech.com/sdk.html (also XP-M7601 downloads).
Archive: https://omo-oss-file110.thefastfile.com/portal-saas/pg2026063016491884746/cms/file/window~1.zip
SHA-256 of bundled DLL: 9d6898c344464edc94a38f5f8108c3b88b7a9f22d123cf7657adb7559d85f71f

The manufacturer's ESC Windows SDK Manual, sections 5.46/5.47, documents
SearchEscNetDevice and SetEscNetInfo. Callback bytes: MAC 0..5, IPv4 8..11,
mask 12..15, gateway 16..19, DHCP flag 22. Configure selects one discovered MAC,
sets static networking, and rescans for matching settings. Sending a command
alone never counts as confirmation. No printer firmware or PC adapter settings
are changed. Supported hardware must implement these Xprinter ESC SDK APIs.
