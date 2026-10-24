import fp from 'fastify-plugin';
import { createDb, type Db } from '@milioner/database';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export const dbPlugin = fp(async (app) => {
  const db = createDb(env.databaseUrl);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await db.$client.end({ timeout: 5 });
  });
});
