const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query('BEGIN');

    // Core dictionaries
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        UNIQUE(department_id, name),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // People
    await client.query(`
      CREATE TABLE IF NOT EXISTS faculty (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT UNIQUE,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT UNIQUE,
        department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Add last_login column for students if missing
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);

    // Mappings
    await client.query(`
      CREATE TABLE IF NOT EXISTS class_courses (
        id SERIAL PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        UNIQUE(class_id, course_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS faculty_assignments (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE
      );
    `);

    // Ensure uniqueness via partial unique indexes (handles NULL class_id)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_assignments_course_null_class
      ON faculty_assignments (faculty_id, course_id)
      WHERE class_id IS NULL;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_assignments_course_with_class
      ON faculty_assignments (faculty_id, course_id, class_id)
      WHERE class_id IS NOT NULL;
    `);

    // Activity log (basic)
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        actor_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Faculty feature tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessments (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        total_marks INTEGER NOT NULL,
        due_date DATE NOT NULL,
        instructions TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Scheduling columns for assessments (enable window)
    await client.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        marks INTEGER,
        feedback TEXT,
        submitted_at TIMESTAMPTZ,
        UNIQUE(assessment_id, student_id)
      );
    `);
    // Text content for assignment/exam answers
    await client.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS content_text TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        present BOOLEAN NOT NULL,
        UNIQUE(class_id, date, student_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        link TEXT,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Add course_id to materials for better filtering (optional on existing rows)
    await client.query(`ALTER TABLE materials ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Uploaded files metadata (file-based submissions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS uploaded_files (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        path TEXT NOT NULL,
        mime TEXT,
        size INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Quizzes
    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id SERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        instructions TEXT,
        total_marks INTEGER NOT NULL,
        start_at TIMESTAMPTZ,
        end_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_questions (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        q_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'MCQ',
        marks INTEGER NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_options (
        id SERIAL PRIMARY KEY,
        question_id INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        o_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        is_correct BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_submissions (
        id SERIAL PRIMARY KEY,
        quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        total_obtained INTEGER NOT NULL DEFAULT 0,
        UNIQUE(quiz_id, student_id)
      );
    `);

    // Violation tracking for secure quiz mode
    await client.query(`ALTER TABLE quiz_submissions ADD COLUMN IF NOT EXISTS violation_count INTEGER`);
    await client.query(`ALTER TABLE quiz_submissions ADD COLUMN IF NOT EXISTS violations JSONB`);
    await client.query(`ALTER TABLE quiz_submissions ADD COLUMN IF NOT EXISTS auto_submit_reason TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_answers (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES quiz_submissions(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        selected_option_id INTEGER REFERENCES quiz_options(id) ON DELETE SET NULL,
        obtained INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Trigger to auto-update updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    for (const tbl of ['departments','classes','courses','faculty','students']) {
      await client.query(`DROP TRIGGER IF EXISTS ${tbl}_set_updated_at ON ${tbl};`);
      await client.query(`CREATE TRIGGER ${tbl}_set_updated_at BEFORE UPDATE ON ${tbl} FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`);
    }

    await client.query('COMMIT');
    console.log('Migrations completed.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
