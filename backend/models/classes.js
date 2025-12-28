const { pool } = require('../db');

async function createClass(department_id, name) {
  const { rows } = await pool.query(
    'INSERT INTO classes (department_id, name) VALUES ($1,$2) RETURNING *',
    [department_id, name]
  );
  return rows[0];
}

async function listClasses(department_id) {
  if (department_id) {
    const { rows } = await pool.query('SELECT * FROM classes WHERE department_id = $1 ORDER BY name', [department_id]);
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM classes ORDER BY name');
  return rows;
}

module.exports = { createClass, listClasses };
