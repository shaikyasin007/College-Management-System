const { pool } = require('../db');

async function createStudent({ name, email, phone, department_id, class_id, password_hash }) {
  const { rows } = await pool.query(
    `INSERT INTO students (name, email, phone, department_id, class_id, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, phone, department_id, class_id, status, created_at` ,
    [name, email, phone || null, department_id || null, class_id || null, password_hash]
  );
  return rows[0];
}

async function listStudents({ department_id, class_id } = {}) {
  const clauses = [];
  const params = [];
  let i = 1;
  if (department_id) { clauses.push(`department_id = $${i++}`); params.push(department_id); }
  if (class_id) { clauses.push(`class_id = $${i++}`); params.push(class_id); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, department_id, class_id, status, created_at FROM students ${where} ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function findStudentByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, department_id, class_id, status, password_hash
     FROM students WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

module.exports = { createStudent, listStudents, findStudentByEmail };
