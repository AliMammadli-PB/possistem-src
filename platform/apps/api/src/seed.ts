import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb, users } from '@milioner/database';
import { hashPassword } from '@milioner/security';
import { env } from './env.js';

function randomPassword(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

async function main() {
  const db = createDb(env.databaseUrl);
  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@milioner.local').toLowerCase();

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) {
    console.log(`[seed] Superadmin already exists: ${email}`);
    await db.$client.end();
    return;
  }

  const password = randomPassword();
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role: 'superadmin',
      mustChangePassword: true,
      active: true,
    })
    .returning();

  console.log('══════════════════════════════════════════════════════');
  console.log('  POSSISTEM POS Control — superadmin seeded');
  console.log(`  email:    ${user.email}`);
  console.log(`  password: ${password}`);
  console.log('  (printed once — mustChangePassword=true)');
  console.log('══════════════════════════════════════════════════════');

  await db.$client.end();
}

main().catch(async (err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
