const express = require('express');
const { pool } = require('../db');
const path = require('path');
const fs = require('fs');
let multer; try { multer = require('multer'); } catch { /* optional */ }

const router = express.Router();

function getStudentId(req){
  const id = Number(req.headers['x-student-id'] || req.query.student_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// /api/student/me -> profile + courses
router.get('/me', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const sQ = await pool.query(
      `SELECT s.id, s.name, s.email, s.status, s.class_id, c.name as class_name,
              s.department_id, d.name as department_name, s.last_login
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN departments d ON d.id = s.department_id
       WHERE s.id=$1`, [sid]
    );
    if(!sQ.rows.length) return res.status(404).json({ error: 'Student not found' });
    const s = sQ.rows[0];

    const coursesQ = await pool.query(
      `SELECT crs.id, crs.code, crs.name,
              fa.faculty_id, f.name as faculty_name
       FROM class_courses cc
       JOIN courses crs ON crs.id = cc.course_id
       LEFT JOIN faculty_assignments fa ON fa.course_id = cc.course_id AND (fa.class_id = cc.class_id OR fa.class_id IS NULL)
       LEFT JOIN faculty f ON f.id = fa.faculty_id
       WHERE cc.class_id = $1
       ORDER BY crs.code`, [s.class_id]
    );

    res.json({
      student: {
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        department: { id: s.department_id, name: s.department_name },
        class: { id: s.class_id, name: s.class_name },
        last_login: s.last_login,
        courses: coursesQ.rows
      }
    });
  }catch(e){ console.error('[student/me]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Submit with file/text for non-quiz assessments (base64 JSON upload)
router.post('/submit-file', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const { assessment_id, filename, content_base64, content_text } = req.body || {};
    const aid = Number(assessment_id);
    if(!aid) return res.status(400).json({ error: 'assessment_id required' });
    // Verify assessment belongs to student's class and is open
    const sr = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!sr.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = sr.rows[0];
    const ar = await pool.query('SELECT id, start_at, due_at FROM assessments WHERE id=$1 AND class_id=$2',[aid, class_id]);
    if(!ar.rows.length) return res.status(403).json({ error: 'Not allowed for this assessment' });
    const { start_at, due_at } = ar.rows[0];
    const now = new Date();
    if(start_at && now < new Date(start_at)) return res.status(400).json({ error: 'Assessment not started' });
    if(due_at && now > new Date(due_at)) return res.status(400).json({ error: 'Assessment is closed' });

    const client = await pool.connect();
    try{
      await client.query('BEGIN');
      // Upsert submission (resub allowed until due)
      const exist = await client.query('SELECT id FROM submissions WHERE assessment_id=$1 AND student_id=$2',[aid, sid]);
      let submissionId;
      if(exist.rows.length){
        submissionId = exist.rows[0].id;
        await client.query('UPDATE submissions SET submitted_at=NOW(), content_text=$1 WHERE id=$2',[content_text||null, submissionId]);
        await client.query('DELETE FROM uploaded_files WHERE submission_id=$1',[submissionId]);
      } else {
        const ins = await client.query('INSERT INTO submissions (assessment_id, student_id, submitted_at, content_text) VALUES ($1,$2,NOW(),$3) RETURNING id',[aid, sid, content_text||null]);
        submissionId = ins.rows[0].id;
      }
      // Save file if provided
      if(filename && content_base64){
        const fs = require('fs'); const path = require('path');
        const dir = path.join(__dirname, '..', 'uploads');
        if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const safeName = `${submissionId}_${Date.now()}_${String(filename).replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const full = path.join(dir, safeName);
        const buf = Buffer.from(String(content_base64), 'base64');
        fs.writeFileSync(full, buf);
        await client.query('INSERT INTO uploaded_files (submission_id, filename, path, mime, size) VALUES ($1,$2,$3,$4,$5)', [submissionId, filename, safeName, null, buf.length]);
      }
      await client.query('COMMIT');
      res.status(201).json({ ok: true });
    }catch(e){ await client.query('ROLLBACK'); console.error('[student/submit-file tx]', e); res.status(500).json({ error: 'Internal server error' }); }
    finally{ client.release(); }
  }catch(e){ console.error('[student/submit-file]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Courses (alias of me.courses but standalone)
router.get('/courses', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const q = await pool.query(
      `SELECT crs.id, crs.code, crs.name,
              fa.faculty_id, f.name as faculty_name
       FROM class_courses cc
       JOIN courses crs ON crs.id = cc.course_id
       LEFT JOIN faculty_assignments fa ON fa.course_id = cc.course_id AND (fa.class_id = cc.class_id OR fa.class_id IS NULL)
       LEFT JOIN faculty f ON f.id = fa.faculty_id
       WHERE cc.class_id = $1
       ORDER BY crs.code`, [class_id]
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/courses]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Assessments for student's class
router.get('/assessments', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const q = await pool.query(
      `WITH base_ass AS (
         SELECT a.id, false as is_quiz, a.type, a.total_marks, a.start_at,
                COALESCE(a.due_at, a.due_date::timestamp) as due_at,
                a.course_id, c.code as course_code, c.name as course_name,
                f.name as faculty_name
         FROM assessments a
         JOIN courses c ON c.id = a.course_id
         JOIN faculty f ON f.id = a.faculty_id
         WHERE a.class_id = $2
       ), base_quiz AS (
         SELECT q.id, true as is_quiz, 'Quiz'::text as type, q.total_marks, q.start_at,
                q.end_at as due_at, q.course_id, c.code as course_code, c.name as course_name,
                f.name as faculty_name
         FROM quizzes q
         JOIN courses c ON c.id = q.course_id
         JOIN faculty f ON f.id = q.faculty_id
         WHERE q.class_id = $2
       ), unioned AS (
         SELECT * FROM base_ass
         UNION ALL
         SELECT * FROM base_quiz
       )
       SELECT u.id, u.is_quiz, u.type, u.total_marks, u.start_at, u.due_at,
              u.course_id, u.course_code, u.course_name, u.faculty_name,
              s.marks as submission_marks, s.submitted_at as submission_time,
              (CASE WHEN u.is_quiz THEN EXISTS (
                       SELECT 1 FROM quiz_submissions qs WHERE qs.quiz_id=u.id AND qs.student_id=$1
                    )
                    ELSE (s.assessment_id IS NOT NULL)
               END) as submitted
       FROM unioned u
       LEFT JOIN submissions s ON (NOT u.is_quiz AND s.assessment_id = u.id AND s.student_id = $1)
       ORDER BY u.due_at NULLS LAST`, [sid, class_id]
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/assessments]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Submissions for this student
router.get('/submissions', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const q = await pool.query(
      `SELECT s.id, s.assessment_id, s.submitted_at, s.marks, s.feedback,
              a.type, a.total_marks, a.course_id, c.code as course_code, c.name as course_name
       FROM submissions s
       JOIN assessments a ON a.id = s.assessment_id
       JOIN courses c ON c.id = a.course_id
       WHERE s.student_id = $1
       ORDER BY s.submitted_at DESC NULLS LAST`, [sid]
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/submissions]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Attendance summary and history
router.get('/attendance', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const hist = await pool.query(
      `SELECT ar.date, ar.present, cl.name as class_name
       FROM attendance_records ar
       JOIN classes cl ON cl.id = ar.class_id
       WHERE ar.student_id=$1
       ORDER BY ar.date DESC`, [sid]
    );
    const totals = await pool.query(
      `SELECT COUNT(*)::int as total, SUM(CASE WHEN present THEN 1 ELSE 0 END)::int as present
       FROM attendance_records WHERE student_id=$1`, [sid]
    );
    const total = totals.rows[0]?.total || 0; const present = totals.rows[0]?.present || 0;
    const pct = total? Math.round((present/total)*100): null;
    res.json({ history: hist.rows, summary: { total, present, percentage: pct } });
  }catch(e){ console.error('[student/attendance]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Materials for student's class, optional course_id filter
router.get('/materials', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const courseId = req.query.course_id ? Number(req.query.course_id) : null;
    const params = [class_id];
    let where = 'm.class_id=$1';
    if(courseId){ params.push(courseId); where += ` AND m.course_id = $${params.length}`; }
    const q = await pool.query(
      `SELECT m.id, m.title, m.link, m.note, m.created_at, cl.name as class_name
       FROM materials m
       JOIN classes cl ON cl.id = m.class_id
       WHERE ${where}
       ORDER BY m.id DESC`, params
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/materials]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Announcements for student's class
router.get('/announcements', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const q = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_at, cl.name as class_name
       FROM announcements a
       LEFT JOIN classes cl ON cl.id = a.class_id
       WHERE a.class_id = $1 OR a.class_id IS NULL
       ORDER BY a.id DESC`, [class_id]
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/announcements]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Performance: list per-assessment marks
router.get('/performance', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const q = await pool.query(
      `WITH cls AS (
         SELECT class_id FROM students WHERE id=$1
       ), perf_ass AS (
         SELECT a.id as item_id, false as is_quiz, a.type, a.total_marks,
                c.code as course_code, c.name as course_name,
                s.marks, s.submitted_at
         FROM assessments a
         JOIN cls ON a.class_id = cls.class_id
         JOIN courses c ON c.id=a.course_id
         LEFT JOIN submissions s ON s.assessment_id=a.id AND s.student_id=$1
       ), perf_quiz AS (
         SELECT q.id as item_id, true as is_quiz, 'Quiz'::text as type, q.total_marks,
                c.code as course_code, c.name as course_name,
                qs.total_obtained as marks, qs.submitted_at
         FROM quizzes q
         JOIN cls ON q.class_id = cls.class_id
         JOIN courses c ON c.id=q.course_id
         LEFT JOIN quiz_submissions qs ON qs.quiz_id=q.id AND qs.student_id=$1
       )
       SELECT * FROM perf_ass
       UNION ALL
       SELECT * FROM perf_quiz
       ORDER BY submitted_at DESC NULLS LAST, course_code, type`, [sid]
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/performance]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Create a submission (basic attempt) for an assessment by this student
router.post('/submit', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const { assessment_id, content } = req.body || {};
    const aid = Number(assessment_id);
    if(!aid) return res.status(400).json({ error: 'assessment_id required' });
    // Verify assessment belongs to student's class
    const srow = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!srow.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = srow.rows[0];
    const arow = await pool.query('SELECT id FROM assessments WHERE id=$1 AND class_id=$2',[aid, class_id]);
    if(!arow.rows.length) return res.status(403).json({ error: 'Not allowed for this assessment' });
    // Prevent duplicate
    const exists = await pool.query('SELECT 1 FROM submissions WHERE assessment_id=$1 AND student_id=$2',[aid, sid]);
    if(exists.rows.length) return res.status(409).json({ error: 'Already submitted' });
    // Insert submission (marks null until evaluated)
    await pool.query(
      `INSERT INTO submissions (assessment_id, student_id, feedback, submitted_at)
       VALUES ($1,$2,$3,NOW())`, [aid, sid, content || null]
    );
    res.status(201).json({ ok: true });
  }catch(e){ console.error('[student/submit]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// List quizzes available to this student (by class)
router.get('/quizzes', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  try{
    const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const q = await pool.query(
      `SELECT q.id, q.title, q.total_marks, q.start_at, q.end_at,
              q.course_id, c.code AS course_code, c.name AS course_name,
              COUNT(qq.id) AS questions_count
       FROM quizzes q
       JOIN courses c ON c.id=q.course_id
       LEFT JOIN quiz_questions qq ON qq.quiz_id=q.id
       WHERE q.class_id=$1
       GROUP BY q.id, c.code, c.name
       ORDER BY q.id DESC`, [class_id]
    );
    res.json({ items: q.rows });
  }catch(e){ console.error('[student/quizzes]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Get a quiz with questions/options (verify student is in the quiz class)
router.get('/quizzes/:id', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  const quizId = Number(req.params.id);
  if(!quizId) return res.status(400).json({ error: 'invalid quiz id' });
  try{
    const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const qz = await pool.query(
      `SELECT q.id, q.title, q.instructions, q.total_marks, q.start_at, q.end_at, q.course_id,
              c.code AS course_code, c.name AS course_name
       FROM quizzes q JOIN courses c ON c.id=q.course_id
       WHERE q.id=$1 AND q.class_id=$2`, [quizId, class_id]
    );
    if(!qz.rows.length) return res.status(403).json({ error: 'Not allowed for this quiz' });
    const quiz = qz.rows[0];
    const sub = await pool.query('SELECT 1 FROM quiz_submissions WHERE quiz_id=$1 AND student_id=$2',[quizId, sid]);
    const qs = await pool.query(
      `SELECT id, q_index, text, type, marks FROM quiz_questions WHERE quiz_id=$1 ORDER BY q_index ASC`, [quizId]
    );
    const qids = qs.rows.map(r=>r.id);
    let opts = [];
    if(qids.length){
      const inIds = qids.join(',');
      const o = await pool.query(`SELECT id, question_id, o_index, text FROM quiz_options WHERE question_id IN (${inIds}) ORDER BY question_id, o_index`);
      opts = o.rows;
    }
    const questions = qs.rows.map(q => ({
      id: q.id, q_index: q.q_index, text: q.text, type: q.type, marks: q.marks,
      options: opts.filter(o=>o.question_id===q.id).map(o=>({ id:o.id, o_index:o.o_index, text:o.text }))
    }));
    res.json({ quiz: { ...quiz, questions, already_submitted: !!sub.rowCount } });
  }catch(e){ console.error('[student/quizzes/:id]', e); res.status(500).json({ error: 'Internal server error' }); }
});

// Submit a quiz attempt with auto-evaluation; one-time attempt only
router.post('/quizzes/:id/submit', async (req, res) => {
  const sid = getStudentId(req);
  if(!sid) return res.status(400).json({ error: 'student_id header missing' });
  const quizId = Number(req.params.id);
  if(!quizId) return res.status(400).json({ error: 'invalid quiz id' });
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if(!answers.length) return res.status(400).json({ error: 'answers required' });
  const client = await pool.connect();
  try{
    // Authorization and window check
    const s = await client.query('SELECT class_id FROM students WHERE id=$1',[sid]);
    if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { class_id } = s.rows[0];
    const qz = await client.query('SELECT id, class_id, start_at, end_at, total_marks FROM quizzes WHERE id=$1',[quizId]);
    if(!qz.rows.length || qz.rows[0].class_id !== class_id) return res.status(403).json({ error: 'Not allowed for this quiz' });
    const { start_at, end_at } = qz.rows[0];
    const now = new Date();
    if(start_at && now < new Date(start_at)) return res.status(400).json({ error: 'Quiz not started yet' });
    if(end_at && now > new Date(end_at)) return res.status(400).json({ error: 'Quiz is closed' });

    // One-time attempt enforcement
    const existed = await client.query('SELECT 1 FROM quiz_submissions WHERE quiz_id=$1 AND student_id=$2',[quizId, sid]);
    if(existed.rowCount) return res.status(409).json({ error: 'Quiz already submitted' });

    await client.query('BEGIN');

    // Evaluate
    // Load correct options for all questions in this quiz
    const correct = await client.query(
      `SELECT qq.id as question_id, qo.id as option_id, qq.marks
       FROM quiz_questions qq JOIN quiz_options qo ON qo.question_id=qq.id AND qo.is_correct=true
       WHERE qq.quiz_id=$1`, [quizId]
    );
    const correctMap = new Map(); // question_id -> {option_id, marks}
    for(const r of correct.rows){ correctMap.set(r.question_id, { option_id: r.option_id, marks: Number(r.marks)||0 }); }
    let total = 0;
    // Insert submission
    const violation_count = Number(req.body?.violation_count||0) || 0;
    const violations = Array.isArray(req.body?.violations) ? req.body.violations : [];
    const auto_submit_reason = req.body?.auto_submit_reason || null;
    const sub = await client.query(`INSERT INTO quiz_submissions (quiz_id, student_id, total_obtained, violation_count, violations, auto_submit_reason) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [quizId, sid, 0, violation_count, JSON.stringify(violations), auto_submit_reason]);
    const submissionId = sub.rows[0].id;
    for(const a of answers){
      const qid = Number(a.question_id); const oid = Number(a.option_id);
      if(!qid || !correctMap.has(qid)) continue;
      const corr = correctMap.get(qid);
      const got = (oid && corr.option_id === oid) ? corr.marks : 0;
      total += got;
      await client.query(`INSERT INTO quiz_answers (submission_id, question_id, selected_option_id, obtained) VALUES ($1,$2,$3,$4)`, [submissionId, qid, oid||null, got]);
    }
    await client.query('UPDATE quiz_submissions SET total_obtained=$1 WHERE id=$2',[total, submissionId]);
    await client.query('COMMIT');
    res.status(201).json({ ok:true, total_obtained: total });
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); console.error('[student/quizzes submit]', e); res.status(500).json({ error: 'Internal server error' }); }
  finally{ client.release(); }
});

// Multipart assignment submission (preferable)
if(multer){
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if(!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${String(file.originalname).replace(/[^a-zA-Z0-9._-]/g,'_')}`)
  });
  const upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });

  router.post('/submit-file-mp', upload.single('file'), async (req, res) => {
    const sid = getStudentId(req);
    if(!sid) return res.status(400).json({ error: 'student_id header missing' });
    try{
      const aid = Number(req.body?.assessment_id);
      if(!aid) return res.status(400).json({ error: 'assessment_id required' });
      const content_text = (req.body?.content_text||'').trim() || null;

      const s = await pool.query('SELECT class_id FROM students WHERE id=$1',[sid]);
      if(!s.rows.length) return res.status(404).json({ error: 'Student not found' });
      const { class_id } = s.rows[0];
      const a = await pool.query('SELECT id, start_at, due_at FROM assessments WHERE id=$1 AND class_id=$2',[aid, class_id]);
      if(!a.rows.length) return res.status(403).json({ error: 'Not allowed for this assessment' });
      const { start_at, due_at } = a.rows[0];
      const now = new Date();
      if(start_at && now < new Date(start_at)) return res.status(400).json({ error: 'Assessment not started' });
      if(due_at && now > new Date(due_at)) return res.status(400).json({ error: 'Assessment is closed' });

      const client = await pool.connect();
      try{
        await client.query('BEGIN');
        const exist = await client.query('SELECT id FROM submissions WHERE assessment_id=$1 AND student_id=$2',[aid, sid]);
        let submissionId;
        if(exist.rows.length){
          submissionId = exist.rows[0].id;
          await client.query('UPDATE submissions SET submitted_at=NOW(), content_text=$1 WHERE id=$2',[content_text, submissionId]);
          await client.query('DELETE FROM uploaded_files WHERE submission_id=$1',[submissionId]);
        } else {
          const ins = await client.query('INSERT INTO submissions (assessment_id, student_id, submitted_at, content_text) VALUES ($1,$2,NOW(),$3) RETURNING id',[aid, sid, content_text]);
          submissionId = ins.rows[0].id;
        }
        if(req.file){
          await client.query('INSERT INTO uploaded_files (submission_id, filename, path, mime, size) VALUES ($1,$2,$3,$4,$5)', [submissionId, req.file.originalname, path.basename(req.file.path), req.file.mimetype||null, req.file.size||0]);
        }
        await client.query('COMMIT');
        res.status(201).json({ ok:true, submission_id: submissionId });
      }catch(e){ await client.query('ROLLBACK'); console.error('[student/submit-file-mp tx]', e); res.status(500).json({ error: 'Internal server error' }); }
      finally{ client.release(); }
    }catch(e){ console.error('[student/submit-file-mp]', e); res.status(500).json({ error: 'Internal server error' }); }
  });
}

module.exports = router;
