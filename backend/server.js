const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const adminAuthRoutes = require('./routes/adminAuth');
const adminsRoutes = require('./routes/admins');
const mfaRoutes = require('./routes/mfa');
const facultyRoutes = require('./routes/faculty');
const studentRoutes = require('./routes/student');
const accountsRoutes = require('./routes/accounts');
const academicsRoutes = require('./routes/academics');
const path = require('path');
const { pool } = require('./db');

dotenv.config();

const app = express();
// CORS: allow GitHub Pages, Render, and localhost during development
const allowedOrigins = [
  /https?:\/\/.*\.github\.io$/,
  'https://college-management-system-s2yf.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4001',
  'http://127.0.0.1:4001'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some(o => (o instanceof RegExp ? o.test(origin) : o === origin));
    cb(null, ok);
  },
  credentials: false
}));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/api/health/db', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 as ok');
    res.json({ db: 'connected', result: rows[0] });
  } catch (err) {
    console.error('DB health error:', err);
    res.status(500).json({ db: 'error', error: err.message });
  }
});

app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admins', adminsRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/mfa', mfaRoutes);
app.use('/api/faculty', facultyRoutes);
app.use('/api/student', studentRoutes);

// Static file serving for uploaded submissions
app.use('/files', express.static(path.join(__dirname, 'uploads')));

const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`Admin backend listening on port ${port}`);
});


