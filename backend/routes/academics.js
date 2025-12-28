const express = require('express');
const Joi = require('joi');
const { requireAuth, requireAdminOrSuper } = require('../middleware/auth');
const { createDepartment, listDepartments } = require('../models/departments');
const { createClass, listClasses } = require('../models/classes');
const { createCourse, listCourses } = require('../models/courses');
const { assignCourseToClass, listClassCourses, assignFacultyToCourse, listFacultyAssignments, listAllClassCourses } = require('../models/assignments');
const { pool } = require('../db');

const router = express.Router();

router.use(requireAuth);
router.use(requireAdminOrSuper);

// Schemas
const deptSchema = Joi.object({ name: Joi.string().trim().min(2).max(100).required() });
const classSchema = Joi.object({ department_id: Joi.number().integer().required(), name: Joi.string().trim().min(1).max(100).required() });
const courseSchema = Joi.object({ department_id: Joi.number().integer().required(), code: Joi.string().trim().min(2).max(20).required(), name: Joi.string().trim().min(2).max(200).required() });
const assignClassCourseSchema = Joi.object({ class_id: Joi.number().integer().required(), course_id: Joi.number().integer().required() });
const assignFacultySchema = Joi.object({ faculty_id: Joi.number().integer().required(), course_id: Joi.number().integer().required(), class_id: Joi.number().integer().allow(null) });

// Departments
router.get('/departments', async (_req, res) => {
  try {
    const departments = await listDepartments();
    res.json({ departments });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/departments', async (req, res) => {
  const { error, value } = deptSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const dep = await createDepartment(value.name);
    res.status(201).json({ department: dep });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'Department already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Classes
router.get('/classes', async (req, res) => {
  try {
    const department_id = req.query.department_id ? Number(req.query.department_id) : undefined;
    const classes = await listClasses(department_id);
    res.json({ classes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/classes', async (req, res) => {
  const { error, value } = classSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const cl = await createClass(value.department_id, value.name);
    res.status(201).json({ class: cl });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'Class already exists for this department' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Courses
router.get('/courses', async (req, res) => {
  try {
    const department_id = req.query.department_id ? Number(req.query.department_id) : undefined;
    const courses = await listCourses(department_id);
    res.json({ courses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/courses', async (req, res) => {
  const { error, value } = courseSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const c = await createCourse(value.department_id, value.code, value.name);
    res.status(201).json({ course: c });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'Course code already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign courses to classes
router.get('/class-courses', async (req, res) => {
  try {
    const class_id = Number(req.query.class_id);
    if (!class_id) return res.status(400).json({ error: 'class_id required' });
    const items = await listClassCourses(class_id);
    res.json({ class_courses: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// All class→course mappings (for admin mapping table)
router.get('/class-courses/all', async (_req, res) => {
  try {
    const items = await listAllClassCourses();
    res.json({ class_courses: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/class-courses', async (req, res) => {
  const { error, value } = assignClassCourseSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const item = await assignCourseToClass(value.class_id, value.course_id);
    if(!item || !item.id){
      return res.status(409).json({ error: 'This class is already mapped to this course' });
    }
    try{ await pool.query(`INSERT INTO activity_log(type, details) VALUES ($1, $2)`, ['assign_class_course', { class_id: value.class_id, course_id: value.course_id }]); }catch{}
    res.status(201).json({ class_course: item });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign faculty to courses/classes
router.get('/faculty-assignments', async (req, res) => {
  try {
    const filters = {
      faculty_id: req.query.faculty_id ? Number(req.query.faculty_id) : undefined,
      course_id: req.query.course_id ? Number(req.query.course_id) : undefined,
      class_id: req.query.class_id ? Number(req.query.class_id) : undefined,
    };
    const items = await listFacultyAssignments(filters);
    res.json({ assignments: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/faculty-assignments', async (req, res) => {
  const { error, value } = assignFacultySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const item = await assignFacultyToCourse(value.faculty_id, value.course_id, value.class_id ?? null);
    if(!item || !item.id){
      return res.status(409).json({ error: 'This faculty is already assigned to this course/class' });
    }
    try{ await pool.query(`INSERT INTO activity_log(type, details) VALUES ($1, $2)`, ['assign_faculty_course', { faculty_id: value.faculty_id, course_id: value.course_id, class_id: value.class_id ?? null }]); }catch{}
    res.status(201).json({ assignment: item });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
