const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdminOrSuper } = require('../middleware/auth');
const { createStudent, listStudents } = require('../models/students');
const { createFaculty, listFaculty } = require('../models/faculty');

const router = express.Router();

const studentSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().allow('', null),
  department_id: Joi.number().integer().allow(null),
  class_id: Joi.number().integer().allow(null),
  password: Joi.string().min(8).required(),
});

const facultySchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().allow('', null),
  department_id: Joi.number().integer().allow(null),
  password: Joi.string().min(8).required(),
});

router.use(requireAuth);
router.use(requireAdminOrSuper);

router.get('/students', async (req, res) => {
  try {
    const { department_id, class_id } = req.query;
    const students = await listStudents({
      department_id: department_id ? Number(department_id) : undefined,
      class_id: class_id ? Number(class_id) : undefined,
    });
    res.json({ students });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/students', async (req, res) => {
  const { error, value } = studentSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const password_hash = await bcrypt.hash(value.password, 10);
    const student = await createStudent({
      name: value.name,
      email: value.email,
      phone: value.phone,
      department_id: value.department_id,
      class_id: value.class_id,
      password_hash,
    });
    res.status(201).json({ student });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email or phone already in use' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/faculty', async (_req, res) => {
  try {
    const faculty = await listFaculty();
    res.json({ faculty });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/faculty', async (req, res) => {
  const { error, value } = facultySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const password_hash = await bcrypt.hash(value.password, 10);
    const faculty = await createFaculty({
      name: value.name,
      email: value.email,
      phone: value.phone,
      department_id: value.department_id,
      password_hash,
    });
    res.status(201).json({ faculty });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email or phone already in use' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
