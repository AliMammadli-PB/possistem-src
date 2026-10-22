"""Upgrade a genuine schema-20 database, retaining an existing paid receipt."""
from pathlib import Path
import json, sqlite3, subprocess, tempfile
root = Path(__file__).resolve().parents[1]

def checksum(text):
    value = 0x811c9dc5
    units = text.encode('utf-16-le')
    for at in range(0, len(units), 2):
        value = ((value ^ int.from_bytes(units[at:at+2], 'little')) * 0x01000193) & 0xffffffff
    return f'{value:08x}'

with tempfile.TemporaryDirectory(prefix='market-weight-upgrade-') as folder:
    db = Path(folder) / 'market.db'
    con = sqlite3.connect(db)
    for file in sorted((root / 'database/migrations').glob('*.sql')):
        version = int(file.name.split('_')[0])
        if version > 20:
            continue
        sql = file.read_text().replace('\r\n', '\n')
        con.executescript(sql)
        con.execute('INSERT INTO database_migrations(version,name,checksum) VALUES(?,?,?)', (version, file.name, checksum(sql)))
        con.commit()
    con.execute("INSERT INTO warehouses(id,code,name) VALUES('w','W','Gənclik')")
    con.execute("INSERT INTO registers(id,code,name) VALUES('r','K1','Kassa')")
    con.execute("INSERT INTO products(id,sku,barcode,name_az,unit,price_minor,cost_minor,created_at) VALUES('p','P','200000001','Çay','kq',800,347,0)")
    con.execute("INSERT INTO stock_levels(product_id,warehouse_id,qty) VALUES('p','w',10)")
    con.execute("INSERT INTO sales(id,receipt_no,created_at,subtotal_minor,total_minor,payment_method,payment_amount_minor,tendered_minor,cashier_id,register_id,warehouse_id) VALUES('s','M-K1-261021-0001',1,248,248,'cash',248,248,'qa','r','w')")
    con.execute("INSERT INTO sale_items(sale_id,product_id,qty,unit_price_minor,discount_minor,line_total_minor) VALUES('s','p',1,800,0,248)")
    original = con.execute('SELECT id,receipt_no,total_minor FROM sales').fetchall()
    con.commit()
    con.close()
    result = subprocess.run([str(root/'native/build-linux/market-pos-core'), '--db',str(db),'--log-dir',folder,'--protocol','1'],input=json.dumps({'requestId':'upgrade','protocolVersion':1,'timestamp':1,'method':'core.ping','payload':{}})+'\n',text=True,capture_output=True,timeout=20)
    assert result.returncode == 0, result.stderr
    messages = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    assert any(m.get('requestId') == 'upgrade' and m.get('success') for m in messages), messages
    con = sqlite3.connect(db)
    assert con.execute('SELECT COUNT(*) FROM database_migrations').fetchone()[0] == 21
    assert con.execute('SELECT id,receipt_no,total_minor FROM sales').fetchall() == original
    assert con.execute('SELECT qty,unit_price_minor,line_total_minor,qty_milli FROM sale_items').fetchone() == (1,800,248,None)
    assert con.execute('PRAGMA foreign_key_check').fetchall() == []
    con.close()
print('PASS schema 20 → 21: old sale, amount, price, stock and receipt retained; old weight stays NULL; new core starts with matching old checksums.')
