from pathlib import Path
import re

conf = Path("/etc/nginx/sites-enabled/possistem")
text = conf.read_text()

text = re.sub(r"\n?\s*location /ws/id \{[^}]*\}", "", text, flags=re.S)
text = re.sub(r"\n?\s*location /ws/relay \{[^}]*\}", "", text, flags=re.S)

ws = """
    location /ws/id {
        proxy_pass http://127.0.0.1:21118/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }

    location /ws/relay {
        proxy_pass http://127.0.0.1:21119/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
""".strip()

marker = "    location / {"
if marker not in text:
    raise SystemExit("marker missing")
text = text.replace(marker, ws + "\n\n" + marker, 1)
conf.write_text(text)
print("ws proxy updated")
