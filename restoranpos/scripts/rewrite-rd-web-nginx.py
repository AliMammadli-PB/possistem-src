from pathlib import Path
import re

conf = Path("/etc/nginx/sites-enabled/possistem")
text = conf.read_text()

# Remove broken/duplicate rd-web blocks
text = re.sub(r"\n?\s*location\s*=\s*/rd-web\s*\{[^}]*\}", "", text)
text = re.sub(r"\n?\s*location\s+\^~\s+/rd-web/\s*\{[^?#]*?\n    \}", "", text, flags=re.S)
text = re.sub(r"\}\s*location\s+/rd-web/\s*\{[^}]*\}", "}", text, flags=re.S)

rd_web_block = """
    location = /rd-web {
        return 301 /rd-web/;
    }

    location ^~ /rd-web/ {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:8787/;
        proxy_redirect off;
        proxy_set_header Accept-Encoding "";
        sub_filter_types text/html;
        sub_filter_once off;
        sub_filter '<base href="/">' '<base href="/rd-web/">';
    }
""".strip("\n")

# Fallback for cached clients / old service worker scope at site root
rd_root_assets = """
    location = /env-config.js { proxy_pass http://127.0.0.1:8787/env-config.js; }
    location = /yuv-canvas-1.2.6.js { proxy_pass http://127.0.0.1:8787/yuv-canvas-1.2.6.js; }
    location = /main.dart.js { proxy_pass http://127.0.0.1:8787/main.dart.js; }
    location = /flutter_service_worker.js { proxy_pass http://127.0.0.1:8787/flutter_service_worker.js; }
    location = /manifest.json { proxy_pass http://127.0.0.1:8787/manifest.json; }
    location = /favicon.svg { proxy_pass http://127.0.0.1:8787/favicon.svg; }
    location ^~ /js/dist/ { proxy_pass http://127.0.0.1:8787/js/dist/; }
    location ^~ /ogvjs-1.8.6/ { proxy_pass http://127.0.0.1:8787/ogvjs-1.8.6/; }
    location ^~ /libs/ { proxy_pass http://127.0.0.1:8787/libs/; }
    location ^~ /icons/ { proxy_pass http://127.0.0.1:8787/icons/; }
    location ~ ^/flutter_service_worker\.js(\?.*)?$ { proxy_pass http://127.0.0.1:8787$request_uri; }
""".strip("\n")

insert = rd_web_block + "\n\n" + rd_root_assets
marker = "    location / {"
if marker not in text:
    raise SystemExit("location / marker missing")
if "location ^~ /js/dist/" not in text:
    text = text.replace(marker, insert + "\n\n" + marker, 1)
else:
    print("root asset locations already present")

conf.write_text(text)
print("nginx conf updated")
