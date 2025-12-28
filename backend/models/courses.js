const { pool } = require('../db');

async function createCourse(department_id, code, name) {
  const { rows } = await pool.query(
    'INSERT INTO courses (department_id, code, name) VALUES ($1,$2,$3) RETURNING *',
    [department_id, code, name]
  );
  return rows[0];
}

async function listCourses(department_id) {
  if (department_id) {
    const { rows } = await pool.query('SELECT * FROM courses WHERE department_id = $1 ORDER BY code', [department_id]);
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM courses ORDER BY code');
  return rows;
}

module.exports = { createCourse, listCourses };
