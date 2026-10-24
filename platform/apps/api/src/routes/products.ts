import { importCatalog, overlayCommerce, updateCommerceProduct } from '../lib/billing/catalog.js';
import { BillingError } from '../lib/billing/domain.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { writeAudit } from '../lib/audit.js';
import {
  getPublicTradeProduct,
  listAdminProducts,
  listPublicTradeProducts,
  openProductImageStream,
  productImageDir,
  productImagePublicUrl,
  updateProductOverride,
  ensureProductDirs,
} from '../lib/product-catalog.js';
import { clientIp } from '../lib/validate.js';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function publicProductRoutes(app: FastifyInstance) {
  app.get('/public/products', async () => {
    const products = await overlayCommerce(app.db,await listPublicTradeProducts());
    const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'az'),
    );
    const parents = Array.from(new Set(products.map((p) => p.parentCategory).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'az'),
    );
    return {
      count: products.length,
      categories,
      parents,
      products,
    };
  });

  app.get('/public/products/images/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^[0-9a-f-]{36}\.webp$/i.test(file)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    try {
      const stream = await openProductImageStream(file);
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return reply.send(stream);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  app.get('/public/products/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const product = await getPublicTradeProduct(id);
    if (!product) return reply.code(404).send({ error: 'Məhsul tapılmadı.' });
    return { product: (await overlayCommerce(app.db,[product]))[0] };
  });
}

export async function adminProductRoutes(app: FastifyInstance) {
  app.get('/admin/products', async (req, reply) => {
    reply.header('Cache-Control','private, no-store').header('Vary','Cookie, x-admin-session');
    if (!requireSuperadmin(req, reply)) return;
    const query = req.query as { q?: string; parent?: string };
    const products = await listAdminProducts({
      q: typeof query.q === 'string' ? query.q : '',
      parent: typeof query.parent === 'string' ? query.parent : '',
    });
    const parents = Array.from(new Set(products.map((p) => p.parentCategory).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'az'),
    );
    const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'az'),
    );
    return { count: products.length, parents, categories, products: await overlayCommerce(app.db,products,true) };
  });

  app.patch('/admin/products/:id', async (req, reply) => {
    reply.header('Cache-Control','private, no-store').header('Vary','Cookie, x-admin-session');
    if (!requireSuperadmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return reply.code(400).send({error:'Məhsul məlumatı düzgün deyil.'});
    const body = (req.body ?? {}) as {
      price?: number | null;
      partnerPrice?: number | null;
      imageUrl?: string | null;
      hidden?: boolean;
      stockQuantity?: number | null;
    };

    const patch: {
      price?: number;
      partnerPriceMinor?: number;
      imageUrl?: string;
      hidden?: boolean;
      stockQuantity?: number;
    } = {};

    if ('price' in body) {
      if (body.price === null || body.price === undefined || body.price === ('' as unknown)) {
        patch.price = Number.NaN; // signals clear in updateProductOverride
      } else {
        const n = Number(body.price);
        if (!Number.isFinite(n) || n < 0) {
          return reply.code(400).send({ error: 'Qiymət düzgün deyil.' });
        }
        patch.price = n;
      }
    }
    if ('partnerPrice' in body) {
      if(body.partnerPrice===null)patch.partnerPriceMinor=Number.NaN;
      else {
        const n=body.partnerPrice;
        if(typeof n!=='number'||!Number.isFinite(n)||n<=0||n>1_000_000||Math.abs(n*100-Math.round(n*100))>0.000001)return reply.code(400).send({error:'Partnyor qiyməti müsbət olmalı və ən çox iki onluq rəqəm daşımalıdır.'});
        patch.partnerPriceMinor=Math.round(n*100);
      }
    }
    if ('imageUrl' in body) {
      patch.imageUrl = body.imageUrl ? String(body.imageUrl).trim() : '';
    }
    if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
    if ('stockQuantity' in body) {
      const n = Number(body.stockQuantity);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || !Number.isInteger(n)) {
        return reply.code(400).send({ error: 'Stok miqdarı düzgün deyil.' });
      }
      patch.stockQuantity = n;
    }

    await importCatalog(app.db);
    try {
      if ('price' in body || 'stockQuantity' in body || 'hidden' in body) await app.db.transaction(tx => updateCommerceProduct(tx,id,{...('price' in body ? {price:Number.isFinite(patch.price)?patch.price:null}:{}),...('stockQuantity' in body ? {stockQuantity:patch.stockQuantity}:{}),...('hidden' in body ? {hidden:patch.hidden}:{})},currentUser(req).id));
    } catch (error) {
      if (error instanceof BillingError) return reply.code(error.httpStatus).send({error:error.message});
      throw error;
    }
    const updated = await updateProductOverride(id, patch);
    if (!updated) return reply.code(404).send({ error: 'Məhsul tapılmadı.' });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'product.override',
      entityType: 'product',
      entityId: id,
      ip: clientIp(req),
      meta: { patch },
    });

    return updated;
  });

  app.post(
    '/admin/products/:id/image',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      reply.header('Cache-Control','private, no-store').header('Vary','Cookie, x-admin-session');
    if (!requireSuperadmin(req, reply)) return;
      const id = (req.params as { id: string }).id;
      await ensureProductDirs();

      const part = await req.file({
        limits: { files: 1, fileSize: MAX_IMAGE_BYTES, fields: 0 },
      });
      if (!part) {
        return reply.code(400).send({ error: 'Şəkil faylı seçin.' });
      }

      const mime = (part.mimetype || '').toLowerCase();
      if (!ALLOWED_MIME.has(mime)) {
        return reply.code(400).send({ error: 'Yalnız JPEG, PNG, WebP və ya GIF yükləyin.' });
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of part.file) {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) {
          return reply.code(400).send({ error: 'Şəkil 8 MB-dan böyük ola bilməz.' });
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      let webp: Buffer;
      try {
        webp = await sharp(buffer)
          .rotate()
          .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        return reply.code(400).send({ error: 'Şəkil emal edilə bilmədi.' });
      }

      const storedName = `${randomUUID()}.webp`;
      await mkdir(productImageDir(), { recursive: true });
      await writeFile(path.join(productImageDir(), storedName), webp);

      const imageUrl = productImagePublicUrl(storedName);
      const updated = await updateProductOverride(id, { imageUrl });
      if (!updated) {
        return reply.code(404).send({ error: 'Məhsul tapılmadı.' });
      }

      await writeAudit(app, {
        actorUserId: currentUser(req).id,
        action: 'product.image_upload',
        entityType: 'product',
        entityId: id,
        ip: clientIp(req),
        meta: { storedName, bytes: webp.length },
      });

      return { ...updated, imageUrl };
    },
  );
}
