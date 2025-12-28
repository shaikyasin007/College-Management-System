const { pool } = require('../db');

async function createDepartment(name) {
  const { rows } = await pool.query(
    'INSERT INTO departments (name) VALUES ($1) RETURNING *',
    [name]
  );
  return rows[0];
}

async function listDepartments() {
  const { rows } = await pool.query('SELECT * FROM departments ORDER BY name');
  return rows;
}

module.exports = { createDepartment, listDepartments };
