# Applied host configuration

The public Cloudflare ranges in `cloudflare-realip.conf` were checked against the official IPv4/IPv6 lists on 2026-10-24. Refresh them from the official source before reuse; never trust arbitrary inbound `CF-Connecting-IP` or `X-Forwarded-For`.

The Possistem nginx TLS server includes this snippet and sends `X-Forwarded-For $remote_addr` to the loopback API. The API trusts only loopback proxies. The TLS server also sets host-only `Strict-Transport-Security: max-age=31536000`; no `includeSubDomains` or preload promise is made. nginx `add_header` inheritance must be considered when adding new locations with their own headers.

The API runtime is installed as a complete tree, including matching pnpm packages/node_modules, under `/opt/possistem-pos-control/.security-build-20261024`. A systemd drop-in overrides only ExecStart; the existing WorkingDirectory and protected EnvironmentFile remain unchanged. Deploying the new JS dist against the old dependency tree is unsupported.

See `../../../docs/SECURITY-REVIEW-20261024.md` at the repository root for backup paths, rollback, validation and application release details. No private key or environment file belongs here.
