import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { customerSupportUploads } from '@milioner/database';
import { env } from '../env.js';
import { writeAudit } from '../lib/audit.js';
import { clientIp } from '../lib/validate.js';
import { requireCustomer } from '../plugins/customer-auth.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.log', '.txt', '.json', '.zip']);
const ALLOWED_MIME = new Set([
  'text/plain',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

function safeOriginalName(filename: string): string {
  return path.basename(filename).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180);
}

function contentLooksValid(extension: string, buffer: Buffer): boolean {
  if (extension === '.zip') {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(buffer[2] ?? -1)
    );
  }
  if (buffer.includes(0)) return false;
  if (extension === '.json') {
    try {
      JSON.parse(buffer.toString('utf8'));
    } catch {
      return false;
    }
  }
  return true;
}

async function cleanupExpiredUploads(app: FastifyInstance) {
  const expired = await app.db
    .select()
    .from(customerSupportUploads)
    .where(lt(customerSupportUploads.expiresAt, new Date()))
    .limit(100);
  if (!expired.length) return;
  for (const row of expired) {
    const target = path.join(env.supportUploadDir, path.basename(row.storedName));
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') app.log.warn({ error, uploadId: row.id }, 'expired_upload_unlink_failed');
    });
  }
  await app.db
    .delete(customerSupportUploads)
    .where(inArray(customerSupportUploads.id, expired.map((row) => row.id)));
}

export async function customerUploadRoutes(app: FastifyInstance) {
  app.get('/customer/support/uploads', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    await cleanupExpiredUploads(app);
    const rows = await app.db
      .select()
      .from(customerSupportUploads)
      .where(eq(customerSupportUploads.customerId, identity.id))
      .orderBy(desc(customerSupportUploads.createdAt))
      .limit(20);
    return {
      uploads: rows.map((row) => ({
        id: row.id,
        name: row.originalName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.post(
    '/customer/support/upload',
    { config: { rateLimit: { max: 8, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const identity = requireCustomer(req, reply);
      if (!identity) return;
      await cleanupExpiredUploads(app);
      const part = await req.file({
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES, fields: 0 },
      });
      if (!part) {
        return reply.code(400).send({
          error: 'Yükləmək üçün bir diaqnostika faylı seçin.',
          code: 'FILE_REQUIRED',
        });
      }

      const originalName = safeOriginalName(part.filename || 'diagnostic.log');
      const extension = path.extname(originalName).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME.has(part.mimetype)) {
        part.file.resume();
        return reply.code(415).send({
          error: 'Yalnız LOG, TXT, JSON və ZIP diaqnostika faylları qəbul edilir.',
          code: 'FILE_TYPE_INVALID',
        });
      }

      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        return reply.code(413).send({
          error: 'Fayl 10 MB limitini keçir.',
          code: 'FILE_TOO_LARGE',
        });
      }
      if (part.file.truncated || buffer.length > MAX_UPLOAD_BYTES) {
        return reply.code(413).send({
          error: 'Fayl 10 MB limitini keçir.',
          code: 'FILE_TOO_LARGE',
        });
      }
      if (!contentLooksValid(extension, buffer)) {
        return reply.code(415).send({
          error: 'Fayl məzmunu seçilmiş formatla uyğun deyil.',
          code: 'FILE_CONTENT_INVALID',
        });
      }

      await mkdir(env.supportUploadDir, { recursive: true, mode: 0o700 });
      const storedName = `${identity.id}-${randomUUID()}${extension}`;
      const target = path.join(env.supportUploadDir, storedName);
      await writeFile(target, buffer, { mode: 0o600, flag: 'wx' });

      const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000);
      const [row] = await app.db
        .insert(customerSupportUploads)
        .values({
          customerId: identity.id,
          originalName,
          storedName,
          mimeType: part.mimetype,
          sizeBytes: buffer.length,
          status: 'received',
          expiresAt,
        })
        .returning();
      await writeAudit(app, {
        actorCustomerId: identity.id,
        action: 'customer.support_upload',
        entityType: 'support_upload',
        entityId: row?.id,
        meta: { originalName, sizeBytes: buffer.length, mimeType: part.mimetype },
        ip: clientIp(req),
      });

      return reply.code(201).send({
        upload: row
          ? {
              id: row.id,
              name: row.originalName,
              sizeBytes: row.sizeBytes,
              status: row.status,
              expiresAt: row.expiresAt.toISOString(),
              createdAt: row.createdAt.toISOString(),
            }
          : null,
      });
    },
  );

  app.delete('/customer/support/uploads/:id', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const { id } = req.params as { id: string };
    const [row] = await app.db
      .select()
      .from(customerSupportUploads)
      .where(
        and(
          eq(customerSupportUploads.id, id),
          eq(customerSupportUploads.customerId, identity.id),
        ),
      )
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Fayl tapılmadı.' });

    const target = path.join(env.supportUploadDir, path.basename(row.storedName));
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await app.db
      .delete(customerSupportUploads)
      .where(eq(customerSupportUploads.id, row.id));
    await writeAudit(app, {
      actorCustomerId: identity.id,
      action: 'customer.support_upload_delete',
      entityType: 'support_upload',
      entityId: row.id,
      ip: clientIp(req),
    });
    return { ok: true };
  });
}
