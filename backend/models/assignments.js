const { pool } = require('../db');

async function assignCourseToClass(class_id, course_id) {
  const { rows } = await pool.query(
    `INSERT INTO class_courses (class_id, course_id)
     VALUES ($1,$2)
     ON CONFLICT (class_id, course_id) DO NOTHING
     RETURNING *`,
    [class_id, course_id]
  );
  return rows[0] || { class_id, course_id };
}

async function listClassCourses(class_id) {
  const { rows } = await pool.query(
    `SELECT cc.class_id, cc.course_id, c.code, c.name
     FROM class_courses cc
     JOIN courses c ON c.id = cc.course_id
     WHERE cc.class_id = $1
     ORDER BY c.code`,
    [class_id]
  );
  return rows;
}

async function listAllClassCourses() {
  const { rows } = await pool.query(
    `SELECT cc.class_id, cl.name AS class_name,
            cc.course_id, c.code AS course_code, c.name AS course_name
     FROM class_courses cc
     JOIN classes cl ON cl.id = cc.class_id
     JOIN courses c ON c.id = cc.course_id
     ORDER BY cl.name, c.code`
  );
  return rows;
}

async function assignFacultyToCourse(faculty_id, course_id, class_id = null) {
  const { rows } = await pool.query(
    `INSERT INTO faculty_assignments (faculty_id, course_id, class_id)
     VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [faculty_id, course_id, class_id]
  );
  return rows[0] || { faculty_id, course_id, class_id };
}

async function listFacultyAssignments({ faculty_id, course_id, class_id } = {}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (faculty_id) { parts.push(`fa.faculty_id = $${i++}`); params.push(faculty_id); }
  if (course_id) { parts.push(`fa.course_id = $${i++}`); params.push(course_id); }
  if (class_id) { parts.push(`fa.class_id = $${i++}`); params.push(class_id); }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT fa.*, f.name as faculty_name, c.code as course_code, c.name as course_name, cl.name as class_name
     FROM faculty_assignments fa
     JOIN faculty f ON f.id = fa.faculty_id
     JOIN courses c ON c.id = fa.course_id
     LEFT JOIN classes cl ON cl.id = fa.class_id
     ${where}
     ORDER BY fa.id DESC`,
    params
  );
  return rows;
}

module.exports = {
  assignCourseToClass,
  listClassCourses,
  assignFacultyToCourse,
  listFacultyAssignments,
  listAllClassCourses,
};
