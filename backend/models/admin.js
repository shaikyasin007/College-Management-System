const { pool } = require('../db');

async function findAdminByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
  return rows[0] || null;
}

async function createAdmin({ name, email, phone, address, password_hash, role }) {
  const { rows } = await pool.query(
    `INSERT INTO admins (name, email, phone, address, password_hash, role)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [name, email, phone || null, address || null, password_hash, role]
  );
  return rows[0];
}

async function updateAdmin(id, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) return;
    fields.push(`${key} = $${idx++}`);
    values.push(value);
  });

  if (!fields.length) return null;
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE admins SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function setAdminStatus(id, status) {
  const { rows } = await pool.query(
    'UPDATE admins SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [status, id]
  );
  return rows[0] || null;
}

async function listAdmins() {
  const { rows } = await pool.query(
    'SELECT id, name, email, phone, address, role, status, created_at, updated_at FROM admins ORDER BY created_at DESC'
  );
  return rows;
}

module.exports = {
  findAdminByEmail,
  createAdmin,
  updateAdmin,
  setAdminStatus,
  listAdmins,
};


