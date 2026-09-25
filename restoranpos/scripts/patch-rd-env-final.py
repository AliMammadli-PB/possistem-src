from pathlib import Path
import re

conf = Path("/etc/nginx/sites-enabled/possistem")
text = conf.read_text()
inject = '<script>(function(){var k="dw8ACToVyLG5UPrDwi9CON50CluDQ0nBRhpYjVhCyrI=";localStorage.setItem("custom-rendezvous-server","possistem.az/ws/id");localStorage.setItem("relay-server","possistem.az/ws/relay");localStorage.setItem("api-server","possistem.az");localStorage.setItem("key",k);})();</script>'

env_js = (
    "// possistem override\\n"
    "(function(){var k=\\\"dw8ACToVyLG5UPrDwi9CON50CluDQ0nBRhpYjVhCyrI=\\\";"
    "localStorage.setItem(\\\"custom-rendezvous-server\\\",\\\"possistem.az/ws/id\\\");"
    "localStorage.setItem(\\\"relay-server\\\",\\\"possistem.az/ws/relay\\\");"
    "localStorage.setItem(\\\"api-server\\\",\\\"possistem.az\\\");"
    "localStorage.setItem(\\\"key\\\",k);})();\\n"
)

for old in [
    r"\n?\s*location = /env-config\.js \{[^}]*\}",
    r"\n?\s*location = /rd-web/env-config\.js \{[^}]*\}",
]:
    text = re.sub(old, "", text, flags=re.S)

env_block = f"""
    location = /env-config.js {{
        default_type application/javascript;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        add_header Pragma "no-cache";
        return 200 '{env_js}';
    }}

    location = /rd-web/env-config.js {{
        default_type application/javascript;
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        add_header Pragma "no-cache";
        return 200 '{env_js}';
    }}
""".strip()

if "location = /rd-web/env-config.js" not in text:
    text = text.replace("    location ^~ /rd-web/ {", env_block + "\n\n    location ^~ /rd-web/ {", 1)

# Strip env-config.js include from HTML — head inject is enough
text = re.sub(
    r"\n?\s*sub_filter '<script src=\"env-config\.js\"></script>' '';",
    "",
    text,
)
if "env-config.js\"></script>' ''" not in text:
    text = re.sub(
        r"(sub_filter '<head>' '<head>" + re.escape(inject) + "';)",
        r"\1\n        sub_filter '<script src=\"env-config.js\"></script>' '';",
        text,
        count=1,
    )

conf.write_text(text)
print("ok")
