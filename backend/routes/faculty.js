const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// NOTE: This demo uses a lightweight header-based auth for faculty endpoints because
// the current app issues a mock token after OTP. We filter strictly by the provided faculty id.
function getFacultyId(req){
  const id = Number(req.headers['x-faculty-id'] || req.query.faculty_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// GET /api/faculty/me -> profile with department, assignments, classes, courses
router.get('/me', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });

// GET /api/faculty/assessments/:id -> assessment details
router.get('/assessments/:id', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  const id = Number(req.params.id||0);
  if(!id) return res.status(400).json({ error: 'invalid id' });
  try{
    const { rows } = await pool.query(
      `SELECT a.id, a.type, a.total_marks, a.instructions,
              a.start_at, a.due_at, a.due_date,
              a.class_id, cl.name AS class_name,
              a.course_id, c.code AS course_code, c.name AS course_name
       FROM assessments a
       JOIN classes cl ON cl.id = a.class_id
       JOIN courses c ON c.id = a.course_id
       WHERE a.id=$1 AND a.faculty_id=$2`, [id, facultyId]
    );
    if(!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ assessment: rows[0] });
  }catch(e){ console.error('[faculty/assessment details]', e); res.status(500).json({ error: 'Internal server error' }); }
});
  try{
    const facultyQ = await pool.query(
      `SELECT f.id, f.name, f.email, f.department_id, f.status, d.name AS department_name
       FROM faculty f
       LEFT JOIN departments d ON d.id = f.department_id
       WHERE f.id = $1`, [facultyId]
    );
    if(!facultyQ.rows.length) return res.status(404).json({ error: 'Faculty not found' });
    const fac = facultyQ.rows[0];

    const fa = await pool.query(
      `SELECT fa.id, fa.course_id, fa.class_id,
              c.code AS course_code, c.name AS course_name,
              cl.name AS class_name
       FROM faculty_assignments fa
       JOIN courses c ON c.id = fa.course_id
       LEFT JOIN classes cl ON cl.id = fa.class_id
       WHERE fa.faculty_id = $1
       ORDER BY fa.id DESC`, [facultyId]
    );

    const classes = [];
    const courses = [];
    const classSet = new Set();
    const courseSet = new Set();
    const courseIdsNeedingClasses = new Set();
    fa.rows.forEach(r=>{
      if(r.class_id && !classSet.has(r.class_id)){
        classSet.add(r.class_id); classes.push({ id: r.class_id, name: r.class_name });
      } else if(!r.class_id && r.course_id){
        courseIdsNeedingClasses.add(r.course_id);
      }
      if(r.course_id && !courseSet.has(r.course_id)){
        courseSet.add(r.course_id); courses.push({ id: r.course_id, code: r.course_code, name: r.course_name });
      }
    });

    if(courseIdsNeedingClasses.size){
      const ids = Array.from(courseIdsNeedingClasses);
      const placeholders = ids.map((_,i)=>`$${i+1}`).join(',');
      const cc = await pool.query(
        `SELECT cc.class_id, cl.name AS class_name
         FROM class_courses cc
         JOIN classes cl ON cl.id = cc.class_id
         WHERE cc.course_id IN (${placeholders})`, ids
      );
      cc.rows.forEach(r=>{
        if(r.class_id && !classSet.has(r.class_id)){
          classSet.add(r.class_id); classes.push({ id: r.class_id, name: r.class_name });
        }
      });
    }

    res.json({
      faculty: {
        id: fac.id,
        name: fac.name,
        email: fac.email,
        status: fac.status,
        department: { id: fac.department_id, name: fac.department_name },
        classes,
        courses,
        last_login: new Date().toISOString(), // placeholder; wire to real audit log if available
      }
    });
  }catch(e){
    console.error('[faculty/me]', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function canTeachCourseInClass(facultyId, courseId, classId){
  if(!classId){
    const q = await pool.query(
      `SELECT 1 FROM faculty_assignments fa
       WHERE fa.faculty_id=$1 AND fa.course_id=$2 LIMIT 1`, [facultyId, courseId]
    );
    return q.rowCount>0;
  }
  const q = await pool.query(
    `SELECT 1
     FROM faculty_assignments fa
     WHERE fa.faculty_id=$1 AND fa.course_id=$2 AND (fa.class_id=$3 OR fa.class_id IS NULL)
     AND EXISTS (
       SELECT 1 FROM class_courses cc WHERE cc.class_id=$3 AND cc.course_id=$2
     )
     LIMIT 1`, [facultyId, courseId, classId]
  );
  return q.rowCount>0;
}

router.get('/assessments', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const classId = req.query.class_id ? Number(req.query.class_id) : null;
    const params = [facultyId];
    let where = 'a.faculty_id = $1';
    if(classId){ params.push(classId); where += ` AND a.class_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT a.id, a.type, a.total_marks, a.due_date, a.class_id, a.course_id,
              c.code AS course_code, c.name AS course_name, cl.name AS class_name,
              a.created_at, a.start_at, a.due_at
       FROM assessments a
       JOIN courses c ON c.id = a.course_id
       JOIN classes cl ON cl.id = a.class_id
       WHERE ${where}
       ORDER BY a.id DESC`, params
    );
    res.json({ items: rows });
  }catch(e){ console.error('[faculty/assessments]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/assessments', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { class_id, course_id, type, total_marks, due_date, instructions, start_at, due_at } = req.body||{};
    if(!class_id||!course_id||!type||!due_date) return res.status(400).json({ error: 'Missing required fields' });
    const ok = await canTeachCourseInClass(facultyId, Number(course_id), Number(class_id));
    if(!ok) return res.status(403).json({ error: 'Not authorized for this class/course' });
    const { rows } = await pool.query(
      `INSERT INTO assessments (faculty_id, course_id, class_id, type, total_marks, due_date, instructions, start_at, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [facultyId, Number(course_id), Number(class_id), String(type), Number(total_marks||0), due_date, instructions||null, start_at||null, due_at||null]
    );
    res.status(201).json({ assessment: rows[0] });
  }catch(e){ console.error('[faculty/assessments POST]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/submissions', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const assessmentId = Number(req.query.assessment_id||0);
    if(!assessmentId) return res.status(400).json({ error: 'assessment_id required' });
    const own = await pool.query('SELECT 1 FROM assessments WHERE id=$1 AND faculty_id=$2',[assessmentId, facultyId]);
    if(!own.rowCount) return res.status(403).json({ error: 'Not authorized' });
    const { rows } = await pool.query(
      `SELECT s.id, s.student_id, st.name AS student_name, s.submitted_at, s.marks, s.feedback,
              s.content_text,
              COALESCE(json_agg(json_build_object('id', f.id, 'filename', f.filename, 'path', f.path, 'size', f.size)) FILTER (WHERE f.id IS NOT NULL), '[]') AS files
       FROM submissions s
       JOIN students st ON st.id = s.student_id
       LEFT JOIN uploaded_files f ON f.submission_id = s.id
       WHERE s.assessment_id=$1
       GROUP BY s.id, st.name
       ORDER BY s.submitted_at DESC NULLS LAST, st.name`, [assessmentId]
    );
    res.json({ items: rows.map(r=>({
      ...r,
      files: Array.isArray(r.files)? r.files.map(f=>({ ...f, url: `/files/${f.path}` })) : []
    })) });
  }catch(e){ console.error('[faculty/submissions]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// GET single submission detail (file/text)
router.get('/submissions/:id', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  const sid = Number(req.params.id||0);
  if(!sid) return res.status(400).json({ error: 'invalid id' });
  try{
    // Ensure faculty owns the assessment for this submission
    const own = await pool.query(
      `SELECT 1 FROM submissions s JOIN assessments a ON a.id=s.assessment_id WHERE s.id=$1 AND a.faculty_id=$2`, [sid, facultyId]
    );
    if(!own.rowCount) return res.status(403).json({ error: 'Not authorized' });
    const { rows } = await pool.query(
      `SELECT s.id, s.assessment_id, s.student_id, st.name AS student_name, s.submitted_at, s.marks, s.feedback, s.content_text
       FROM submissions s JOIN students st ON st.id=s.student_id WHERE s.id=$1`, [sid]
    );
    if(!rows.length) return res.status(404).json({ error: 'Not found' });
    const files = await pool.query(`SELECT id, filename, path, mime, size FROM uploaded_files WHERE submission_id=$1 ORDER BY id`, [sid]);
    res.json({ submission: rows[0], files: files.rows.map(f=>({ ...f, url: `/files/${f.path}` })) });
  }catch(e){ console.error('[faculty/submission detail]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/faculty/grade -> set marks/feedback on submission, or override quiz score
router.post('/grade', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  const { submission_id, marks, feedback, quiz_id, student_id } = req.body || {};
  try{
    if(submission_id){
      // Grade file/text assessment
      const own = await pool.query(`SELECT 1 FROM submissions s JOIN assessments a ON a.id=s.assessment_id WHERE s.id=$1 AND a.faculty_id=$2`, [Number(submission_id), facultyId]);
      if(!own.rowCount) return res.status(403).json({ error: 'Not authorized' });
      await pool.query('UPDATE submissions SET marks=$1, feedback=$2 WHERE id=$3',[Number(marks), feedback||null, Number(submission_id)]);
      return res.json({ ok:true });
    }
    if(quiz_id && student_id){
      // Override quiz score
      const own = await pool.query(`SELECT 1 FROM quizzes WHERE id=$1 AND faculty_id=$2`, [Number(quiz_id), facultyId]);
      if(!own.rowCount) return res.status(403).json({ error: 'Not authorized' });
      await pool.query('UPDATE quiz_submissions SET total_obtained=$1 WHERE quiz_id=$2 AND student_id=$3',[Number(marks)||0, Number(quiz_id), Number(student_id)]);
      return res.json({ ok:true });
    }
    return res.status(400).json({ error: 'submission_id or (quiz_id and student_id) required' });
  }catch(e){ console.error('[faculty/grade]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/roster', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const classId = Number(req.query.class_id||0);
    if(!classId) return res.status(400).json({ error: 'class_id required' });
    const auth = await pool.query(
      `SELECT 1 FROM faculty_assignments fa
       WHERE fa.faculty_id=$1 AND (
         fa.class_id=$2 OR (
           fa.class_id IS NULL AND EXISTS(
             SELECT 1 FROM class_courses cc WHERE cc.class_id=$2 AND cc.course_id=fa.course_id
           )
         )
       ) LIMIT 1`, [facultyId, classId]
    );
    if(!auth.rowCount) return res.status(403).json({ error: 'Not authorized for this class' });
    const { rows } = await pool.query('SELECT id, name FROM students WHERE class_id=$1 ORDER BY name',[classId]);
    res.json({ students: rows });
  }catch(e){ console.error('[faculty/roster]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/attendance', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const classId = Number(req.query.class_id||0); const date = req.query.date;
    if(!classId||!date) return res.status(400).json({ error: 'class_id and date required' });
    const { rows } = await pool.query(
      `SELECT ar.student_id, st.name AS student_name, ar.present
       FROM attendance_records ar
       JOIN students st ON st.id = ar.student_id
       WHERE ar.faculty_id=$1 AND ar.class_id=$2 AND ar.date=$3
       ORDER BY st.name`, [facultyId, classId, date]
    );
    res.json({ items: rows });
  }catch(e){ console.error('[faculty/attendance GET]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/attendance', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { class_id, date, items } = req.body||{};
    if(!class_id||!date||!Array.isArray(items)) return res.status(400).json({ error: 'class_id, date, items required' });
    const auth = await pool.query(
      `SELECT 1 FROM faculty_assignments fa
       WHERE fa.faculty_id=$1 AND (
         fa.class_id=$2 OR (
           fa.class_id IS NULL AND EXISTS(
             SELECT 1 FROM class_courses cc WHERE cc.class_id=$2 AND cc.course_id=fa.course_id
           )
         )
       ) LIMIT 1`, [facultyId, Number(class_id)]
    );
    if(!auth.rowCount) return res.status(403).json({ error: 'Not authorized for this class' });
    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      for(const it of items){
        await client.query(
          `INSERT INTO attendance_records (faculty_id, class_id, date, student_id, present)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (class_id, date, student_id) DO UPDATE SET present=EXCLUDED.present`,
          [facultyId, Number(class_id), date, Number(it.student_id), !!it.present]
        );
      }
      await client.query('COMMIT');
    }catch(err){ await client.query('ROLLBACK'); throw err; }
    finally{ client.release(); }
    res.status(200).json({ ok: true });
  }catch(e){ console.error('[faculty/attendance POST]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/materials', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.link, m.note, m.class_id, cl.name AS class_name, m.created_at
       FROM materials m
       JOIN classes cl ON cl.id = m.class_id
       WHERE m.faculty_id=$1
       ORDER BY m.id DESC`, [facultyId]
    );
    res.json({ items: rows });
  }catch(e){ console.error('[faculty/materials GET]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/materials', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { class_id, title, link, note } = req.body||{};
    if(!class_id||!title) return res.status(400).json({ error: 'class_id and title required' });
    const auth = await pool.query(
      `SELECT 1 FROM faculty_assignments fa
       WHERE fa.faculty_id=$1 AND (
         fa.class_id=$2 OR (
           fa.class_id IS NULL AND EXISTS(
             SELECT 1 FROM class_courses cc WHERE cc.class_id=$2 AND cc.course_id=fa.course_id
           )
         )
       ) LIMIT 1`, [facultyId, Number(class_id)]
    );
    if(!auth.rowCount) return res.status(403).json({ error: 'Not authorized for this class' });
    const { rows } = await pool.query(
      `INSERT INTO materials (faculty_id, class_id, title, link, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [facultyId, Number(class_id), String(title), link||null, note||null]
    );
    res.status(201).json({ material: rows[0] });
  }catch(e){ console.error('[faculty/materials POST]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/announcements', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.class_id, cl.name AS class_name, a.created_at
       FROM announcements a
       LEFT JOIN classes cl ON cl.id = a.class_id
       WHERE a.faculty_id=$1
       ORDER BY a.id DESC`, [facultyId]
    );
    res.json({ items: rows });
  }catch(e){ console.error('[faculty/announcements GET]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/announcements', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { class_id, title, body } = req.body||{};
    if(!title) return res.status(400).json({ error: 'title required' });
    if(class_id){
      const auth = await pool.query(
        `SELECT 1 FROM faculty_assignments fa
         WHERE fa.faculty_id=$1 AND (
           fa.class_id=$2 OR (
             fa.class_id IS NULL AND EXISTS(
               SELECT 1 FROM class_courses cc WHERE cc.class_id=$2 AND cc.course_id=fa.course_id
             )
           )
         ) LIMIT 1`, [facultyId, Number(class_id)]
      );
      if(!auth.rowCount) return res.status(403).json({ error: 'Not authorized for this class' });
    }
    const { rows } = await pool.query(
      `INSERT INTO announcements (faculty_id, class_id, title, body)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [facultyId, class_id?Number(class_id):null, String(title), body||null]
    );
    res.status(201).json({ announcement: rows[0] });
  }catch(e){ console.error('[faculty/announcements POST]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/performance', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const classId = Number(req.query.class_id||0);
    const courseId = Number(req.query.course_id||0);
    if(!classId||!courseId) return res.status(400).json({ error: 'class_id and course_id required' });
    const ok = await canTeachCourseInClass(facultyId, courseId, classId);
    if(!ok) return res.status(403).json({ error: 'Not authorized for this class/course' });
    const { rows } = await pool.query(
      `SELECT st.id as student_id, st.name as student_name,
              ROUND(AVG(s.marks)::numeric,2) as average
       FROM students st
       LEFT JOIN submissions s ON s.student_id=st.id
       LEFT JOIN assessments a ON a.id=s.assessment_id AND a.faculty_id=$1 AND a.class_id=$2 AND a.course_id=$3
       WHERE st.class_id=$2
       GROUP BY st.id, st.name
       ORDER BY st.name`, [facultyId, classId, courseId]
    );
    res.json({ items: rows });
  }catch(e){ console.error('[faculty/performance]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Create and list quizzes (with questions/options)
router.get('/quizzes', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { rows } = await pool.query(
      `SELECT q.id, q.title, q.total_marks, q.start_at, q.end_at,
              q.class_id, cl.name AS class_name, q.course_id, c.code AS course_code, c.name AS course_name,
              COUNT(qq.id) AS questions_count
       FROM quizzes q
       JOIN classes cl ON cl.id=q.class_id
       JOIN courses c ON c.id=q.course_id
       LEFT JOIN quiz_questions qq ON qq.quiz_id=q.id
       WHERE q.faculty_id=$1
       GROUP BY q.id, cl.name, c.code, c.name
       ORDER BY q.id DESC`, [facultyId]
    );
    res.json({ items: rows });
  }catch(e){ console.error('[faculty/quizzes GET]', e); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/quizzes', async (req, res) => {
  const facultyId = getFacultyId(req);
  if(!facultyId) return res.status(400).json({ error: 'faculty_id header missing' });
  try{
    const { title, course_id, class_id, instructions, total_marks, start_at, end_at, questions } = req.body||{};
    if(!title||!course_id||!class_id||!Array.isArray(questions)||!questions.length){
      return res.status(400).json({ error: 'title, course_id, class_id and at least one question are required' });
    }
    const ok = await canTeachCourseInClass(facultyId, Number(course_id), Number(class_id));
    if(!ok) return res.status(403).json({ error: 'Not authorized for this class/course' });
    let sum = 0;
    for(const q of questions){
      if(!q || !q.text || !Array.isArray(q.options) || q.options.length < 2) return res.status(400).json({ error: 'Each question must have text and at least 2 options' });
      const correctCount = q.options.filter(o=>!!o.is_correct).length;
      if(correctCount !== 1) return res.status(400).json({ error: 'Each question must have exactly one correct option' });
      const m = Number(q.marks||0); if(!m) return res.status(400).json({ error: 'Each question must specify marks > 0' });
      sum += m;
    }
    if(Number(total_marks) !== sum) return res.status(400).json({ error: 'Total marks must equal sum of question marks' });

    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      const qz = await client.query(
        `INSERT INTO quizzes (faculty_id, course_id, class_id, title, instructions, total_marks, start_at, end_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [facultyId, Number(course_id), Number(class_id), String(title), instructions||null, Number(total_marks), start_at||null, end_at||null]
      );
      const quizId = qz.rows[0].id;
      for(let i=0;i<questions.length;i++){
        const q = questions[i];
        const qq = await client.query(
          `INSERT INTO quiz_questions (quiz_id, q_index, text, type, marks)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [quizId, i+1, String(q.text), 'MCQ', Number(q.marks)]
        );
        const qid = qq.rows[0].id;
        for(let j=0;j<q.options.length;j++){
          const opt = q.options[j];
          await client.query(
            `INSERT INTO quiz_options (question_id, o_index, text, is_correct)
             VALUES ($1,$2,$3,$4)`,
            [qid, j+1, String(opt.text||''), !!opt.is_correct]
          );
        }
      }
      await client.query('COMMIT');
      res.status(201).json({ quiz: { id: quizId } });
    }catch(err){ await client.query('ROLLBACK'); throw err; }
    finally{ client.release(); }
  }catch(e){ console.error('[faculty/quizzes POST]', e); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
