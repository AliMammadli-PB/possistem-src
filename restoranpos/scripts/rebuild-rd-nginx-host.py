from pathlib import Path

conf = Path("/etc/nginx/sites-enabled/possistem")
text = conf.read_text()
start = text.find("    location = /rd-web {")
end = text.find("    location / {")
if start == -1 or end == -1:
    raise SystemExit("markers missing")

inject = (
    '<script>(function(){var k="dw8ACToVyLG5UPrDwi9CON50CluDQ0nBRhpYjVhCyrI=";'
    'localStorage.removeItem("rendezvous-server");'
    'localStorage.setItem("custom-rendezvous-server","possistem.az");'
    'localStorage.setItem("relay-server","possistem.az");'
    'localStorage.setItem("api-server","possistem.az");'
    'localStorage.setItem("key",k);'
    'var h=location.hash,m;'
    'if((m=h.match(/^#\\/([^?#/]+)(?:\\?(.*))?/))){'
    'var id=decodeURIComponent(m[1]),q=new URLSearchParams(m[2]||""),pw=q.get("pw")||q.get("password")||"";'
    'if(id!=="connect"){'
    'var u="#/connect?id="+encodeURIComponent(id);'
    'if(pw)u+="&pw="+encodeURIComponent(pw);'
    'location.replace(u);'
    'return;'
    '}}})();</script>'
)

env_body = (
    "// possistem\\n"
    "(function(){var k=\\\"dw8ACToVyLG5UPrDwi9CON50CluDQ0nBRhpYjVhCyrI=\\\";"
    "localStorage.removeItem(\\\"rendezvous-server\\\");"
    "localStorage.setItem(\\\"custom-rendezvous-server\\\",\\\"possistem.az\\\");"
    "localStorage.setItem(\\\"relay-server\\\",\\\"possistem.az\\\");"
    "localStorage.setItem(\\\"api-server\\\",\\\"possistem.az\\\");"
    "localStorage.setItem(\\\"key\\\",k);"
    "var h=location.hash,m;"
    "if((m=h.match(/^#\\\\\\/([^?#/]+)(?:\\\\?(.*))?/))){"
    "var id=decodeURIComponent(m[1]),q=new URLSearchParams(m[2]||\\\"\\\"),pw=q.get(\\\"pw\\\")||q.get(\\\"password\\\")||\\\"\\\";"
    "if(id!==\\\"connect\\\"){"
    "var u=\\\"#/connect?id=\\\"+encodeURIComponent(id);"
    "if(pw)u+=\\\"&pw=\\\"+encodeURIComponent(pw);"
    "location.replace(u);"
    "return;"
    "}}})();\\n"
)

block = f"""    location = /rd-web {{
        return 301 /rd-web/;
    }}

    location = /env-config.js {{
        default_type application/javascript;
        add_header Cache-Control "no-store";
        return 200 '{env_body}';
    }}

    location = /rd-web/env-config.js {{
        default_type application/javascript;
        add_header Cache-Control "no-store";
        return 200 '{env_body}';
    }}

    location ^~ /rd-web/ {{
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
        sub_filter '<head>' '<head>{inject}';
        sub_filter '<script src="env-config.js"></script>' '';
    }}

    location /ws/id {{
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
    }}

    location /ws/relay {{
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
    }}

    location = /yuv-canvas-1.2.6.js {{ proxy_pass http://127.0.0.1:8787/yuv-canvas-1.2.6.js; }}
    location = /main.dart.js {{ proxy_pass http://127.0.0.1:8787/main.dart.js; }}
    location = /flutter_service_worker.js {{ proxy_pass http://127.0.0.1:8787/flutter_service_worker.js; }}
    location = /manifest.json {{ proxy_pass http://127.0.0.1:8787/manifest.json; }}
    location = /favicon.svg {{ proxy_pass http://127.0.0.1:8787/favicon.svg; }}
    location ^~ /js/dist/ {{ proxy_pass http://127.0.0.1:8787/js/dist/; }}
    location ^~ /ogvjs-1.8.6/ {{ proxy_pass http://127.0.0.1:8787/ogvjs-1.8.6/; }}
    location ^~ /libs/ {{ proxy_pass http://127.0.0.1:8787/libs/; }}
    location ^~ /icons/ {{ proxy_pass http://127.0.0.1:8787/icons/; }}
    location ~ ^/flutter_service_worker\\.js(\\?.*)?$ {{ proxy_pass http://127.0.0.1:8787$request_uri; }}

"""

text = text[:start] + block + text[end:]
conf.write_text(text)
print("rebuilt ok")
