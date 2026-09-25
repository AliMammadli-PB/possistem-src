from pathlib import Path
import re

conf = Path("/etc/nginx/sites-enabled/possistem")
text = conf.read_text()

ENV_JS = (
    "// possistem.az RustDesk override\n"
    "(function(){var k=\"dw8ACToVyLG5UPrDwi9CON50CluDQ0nBRhpYjVhCyrI=\";"
    "localStorage.setItem(\"custom-rendezvous-server\",\"possistem.az/ws/id\");"
    "localStorage.setItem(\"relay-server\",\"possistem.az/ws/relay\");"
    "localStorage.setItem(\"api-server\",\"possistem.az\");"
    "localStorage.setItem(\"key\",k);})();"
)

inject = (
    '<script>(function(){var k="dw8ACToVyLG5UPrDwi9CON50CluDQ0nBRhpYjVhCyrI=";'
    'localStorage.setItem("custom-rendezvous-server","possistem.az/ws/id");'
    'localStorage.setItem("relay-server","possistem.az/ws/relay");'
    'localStorage.setItem("api-server","possistem.az");'
    'localStorage.setItem("key",k);})();</script>'
)

env_block = f"""
    location = /env-config.js {{
        default_type application/javascript;
        add_header Cache-Control "no-store";
        return 200 '{ENV_JS}';
    }}

    location = /rd-web/env-config.js {{
        default_type application/javascript;
        add_header Cache-Control "no-store";
        return 200 '{ENV_JS}';
    }}
""".strip()

for pat in [
    r"\n?\s*location = /env-config\.js \{[^}]*\}",
    r"\n?\s*location = /rd-web/env-config\.js \{[^}]*\}",
]:
    text = re.sub(pat, "", text, flags=re.S)

# Exact env-config locations MUST appear before ^~ /rd-web/ prefix block
if "location = /rd-web/env-config.js" not in text:
    marker = "    location ^~ /rd-web/ {"
    text = text.replace(marker, env_block + "\n\n" + marker, 1)

# Ensure rd-web proxy also rewrites stale docker env-config if exact match missed
extra_filters = """
        sub_filter_types text/html application/javascript text/javascript;
        sub_filter '169.58.242.152:21116' 'possistem.az/ws/id';
        sub_filter '169.58.242.152:21117' 'possistem.az/ws/relay';
        sub_filter '"api-server", "169.58.242.152"' '"api-server", "possistem.az"';
"""
if "169.58.242.152:21116" not in text:
    text = re.sub(
        r"(location \^~ /rd-web/ \{.*?sub_filter '<base href=\"/\">' '<base href=\"/rd-web/\">';)",
        r"\1" + extra_filters,
        text,
        count=1,
        flags=re.S,
    )

if "sub_filter '<head>' '<head>" + inject not in text:
    text = re.sub(
        r"(location \^~ /rd-web/ \{.*?sub_filter '<base href=\"/\">' '<base href=\"/rd-web/\">';)",
        r"\1\n        sub_filter '<head>' '<head>" + inject + "';",
        text,
        count=1,
        flags=re.S,
    )

conf.write_text(text)
print("nginx env override patched")
