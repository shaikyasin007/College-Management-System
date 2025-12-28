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

dotenv.config();

const app = express();

// Allow frontend running from file:// or any localhost port during development
app.use(cors({ origin: true, credentials: false }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

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


