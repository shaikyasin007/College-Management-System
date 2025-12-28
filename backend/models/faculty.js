const { pool } = require('../db');

async function createFaculty({ name, email, phone, department_id, password_hash }) {
  const { rows } = await pool.query(
    `INSERT INTO faculty (name, email, phone, department_id, password_hash)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, phone, department_id, status, created_at` ,
    [name, email, phone || null, department_id || null, password_hash]
  );
  return rows[0];
}

async function listFaculty({ department_id } = {}) {
  const clauses = [];
  const params = [];
  let i = 1;
  if (department_id) { clauses.push(`department_id = $${i++}`); params.push(department_id); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, department_id, status, created_at FROM faculty ${where} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function findFacultyByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, department_id, status, password_hash
     FROM faculty WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

module.exports = { createFaculty, listFaculty, findFacultyByEmail };
