const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL. Ensuring schema...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        address TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS admins_set_updated_at ON admins;
      CREATE TRIGGER admins_set_updated_at
      BEFORE UPDATE ON admins
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
    `);

    const email = process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@heema.edu';
    const name = process.env.SEED_SUPERADMIN_NAME || 'Super Admin';
    const plainPassword = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe123!';

    const { rows: existing } = await client.query('SELECT id FROM admins WHERE email = $1', [email]);
    if (existing.length) {
      console.log(`Super admin already exists with email ${email} (id=${existing[0].id}). Skipping insert.`);
    } else {
      console.log('Creating SUPER_ADMIN account...');
      const password_hash = await bcrypt.hash(plainPassword, 10);
      const { rows } = await client.query(
        `INSERT INTO admins (name, email, phone, address, password_hash, role, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, email, role, status` ,
        [name, email, null, null, password_hash, 'SUPER_ADMIN', 'ACTIVE']
      );
      console.log('Created SUPER_ADMIN:', rows[0]);
      console.log(`Login with email: ${email} password: ${plainPassword}`);
    }
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
