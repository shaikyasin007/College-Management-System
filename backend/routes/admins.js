const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const { createAdmin, listAdmins, updateAdmin, setAdminStatus } = require('../models/admin');

const router = express.Router();

const createSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid('SUPER_ADMIN', 'ADMIN').required(),
});

const updateSchema = Joi.object({
  name: Joi.string().min(2).max(100),
  phone: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
  role: Joi.string().valid('SUPER_ADMIN', 'ADMIN'),
});

router.use(requireAuth);
router.use(requireSuperAdmin);

router.get('/', async (_req, res) => {
  try {
    const admins = await listAdmins();
    res.json({ admins });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  try {
    const password_hash = await bcrypt.hash(value.password, 10);
    const admin = await createAdmin({
      name: value.name,
      email: value.email,
      phone: value.phone,
      address: value.address,
      password_hash,
      role: value.role,
    });
    res.status(201).json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        address: admin.address,
        role: admin.role,
        status: admin.status,
      },
    });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  try {
    const admin = await updateAdmin(id, value);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        address: admin.address,
        role: admin.role,
        status: admin.status,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!id || !['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ error: 'Invalid id or status' });
  }

  try {
    const admin = await setAdminStatus(id, status);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        status: admin.status,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;


