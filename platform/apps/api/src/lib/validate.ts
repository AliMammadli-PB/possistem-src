import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType, ZodTypeDef } from 'zod/v3';

/**
 * Şemanın *çıktı* tipini döner.
 *
 * `ZodSchema<T>` girdi ve çıktıyı aynı sayar; `.default()` kullanan alanlarda
 * bu, doldurulmuş değerleri de `undefined` gösteriyordu. Üç parametreli
 * `ZodType` ile çıktı tipi doğru çıkarılıyor ve çağıran tarafta gereksiz
 * `?? default` tekrarları kalkıyor.
 */
export function parseBody<Out, In>(
  schema: ZodType<Out, ZodTypeDef, In>,
  body: unknown,
  reply: FastifyReply,
): Out | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.code(400).send({
      error: 'Validation failed',
      details: result.error.flatten(),
    });
    return null;
  }
  return result.data;
}

export function clientIp(req: FastifyRequest): string | null {
  return req.ip ?? null;
}
