const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
let nodemailer = null; // Loaded lazily/optionally to avoid hard dependency
try { nodemailer = require('nodemailer'); } catch(_) { /* fallback to console */ }

// DB models for real users
const { findStudentByEmail } = require('../models/students');
const { findFacultyByEmail } = require('../models/faculty');
const { pool } = require('../db');

// Helper: resolve user by email across roles. We currently use email as the username for sign-in.
async function findDbUserByLogin(login) {
  const email = String(login).trim();
  // Try student first
  const s = await findStudentByEmail(email);
  if (s) return { role: 'student', id: s.id, name: s.name, email: s.email, password_hash: s.password_hash };
  // Try faculty
  const f = await findFacultyByEmail(email);
  if (f) return { role: 'faculty', id: f.id, name: f.name, email: f.email, password_hash: f.password_hash };
  return null;
}

// Temporary in-memory OTP store (CNS: time-bound, single-use, no permanent storage)
// Map<mfa_token, { username, role, otp_hash, expires_at, attempts, used, created_at }>
const otpStore = new Map();
// Map email -> active mfa_token, to debounce duplicate sends within a short window and reuse valid sessions
const userSessionIndex = new Map();

const router = express.Router();

// Helper: generate 6-digit OTP (CNS: One-Time Password)
function generateOTP() {
  return ('' + Math.floor(100000 + Math.random() * 900000));
}

// Helper: SHA-256 hash (CNS: Hashing)
function sha256(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

// Optional email sender using SMTP via nodemailer. If SMTP is not configured or nodemailer not installed,
// fallback to console log. Configure via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
async function sendOtpEmail(to, otp, username) {
  if (!to) return false;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  // If nodemailer is available but SMTP is not configured, use Ethereal (dev mailbox)
  if (nodemailer && !SMTP_HOST) {
    try {
      const testAcct = await nodemailer.createTestAccount();
      const transporter = nodemailer.createTransport({
        host: testAcct.smtp.host,
        port: testAcct.smtp.port,
        secure: testAcct.smtp.secure,
        auth: { user: testAcct.user, pass: testAcct.pass },
      });
      const info = await transporter.sendMail({
        from: 'HIT MFA <no-reply@example.com>',
        to,
        subject: 'Your One-Time Password (OTP)',
        text: `Your OTP is ${otp}. It expires in 3 minutes. If you did not request this, ignore this email.`,
      });
      console.log('[MFA][ethereal] Preview URL:', nodemailer.getTestMessageUrl(info));
      return true;
    } catch (e) {
      console.log('[MFA][ethereal-fallback] Failed to send via Ethereal, falling back to console:', e.message);
      console.log(`[MFA][mock-email] To: ${to} | User: ${username} | OTP: ${otp}`);
      return true;
    }
  }
  if (!nodemailer) {
    console.log(`[MFA][mock-email] To: ${to} | User: ${username} | OTP: ${otp}`);
    return true;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: false,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to,
      subject: 'Your One-Time Password (OTP)',
      text: `Your OTP is ${otp}. It expires in 3 minutes. If you did not request this, ignore this email.`,
    });
    return true;
  } catch (e) {
    console.log(`[MFA][email-fallback] Failed to send email to ${to}. Falling back to console. Error:`, e.message);
    console.log(`[MFA] OTP for ${username}: ${otp} (valid 3 min)`);
    return false;
  }
}

// POST /api/mfa/initiate
// Body: { username, password }
// Server verifies password, then generates Time-bound Single-use OTP
router.post('/initiate', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  try {
    const dbUser = await findDbUserByLogin(username);
    if (!dbUser) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, dbUser.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // If an active MFA session exists for this email and is still valid and unused,
    // reuse it and DO NOT resend the email if it was created very recently (debounce).
    const now = Date.now();
    const existingToken = userSessionIndex.get(dbUser.email);
    if (existingToken) {
      const existing = otpStore.get(existingToken);
      if (existing && !existing.used && now < existing.expires_at) {
        const justSent = now - (existing.created_at || now) < 12_000; // 12s debounce window
        if (justSent) {
          return res.json({ mfa_required: true, mfa_token: existingToken, expires_in: Math.max(0, Math.floor((existing.expires_at - now)/1000)), user: { username: dbUser.email, role: dbUser.role, name: dbUser.name } });
        }
      }
    }

    const otp = generateOTP();
    const otpHash = sha256(otp);
    const mfaToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = now + 3 * 60 * 1000; // 3 minutes

    otpStore.set(mfaToken, { username: dbUser.email, role: dbUser.role, user_id: dbUser.id, name: dbUser.name, otp_hash: otpHash, expires_at: expiresAt, attempts: 0, used: false, created_at: now });
    userSessionIndex.set(dbUser.email, mfaToken);

    await sendOtpEmail(dbUser.email, otp, dbUser.email);

    return res.json({ mfa_required: true, mfa_token: mfaToken, expires_in: 180, user: { id: dbUser.id, username: dbUser.email, role: dbUser.role, name: dbUser.name } });
  } catch (e) {
    console.error('[MFA/initiate]', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mfa/verify
// Body: { mfa_token, otp }
router.post('/verify', (req, res) => {
  const { mfa_token, otp } = req.body || {};
  if (!mfa_token || !otp) return res.status(400).json({ error: 'mfa_token and otp required' });

  const entry = otpStore.get(mfa_token);
  if (!entry) return res.status(400).json({ error: 'Invalid or expired MFA session' });

  // Rate limit attempts (CNS: brute-force protection)
  if (entry.attempts >= 3) {
    otpStore.delete(mfa_token);
    return res.status(429).json({ error: 'Too many attempts. Session locked.' });
  }

  // Expiry check (CNS: time-based authentication)
  if (Date.now() > entry.expires_at) {
    otpStore.delete(mfa_token);
    return res.status(400).json({ error: 'OTP expired. Please login again.' });
  }

  // Single-use check
  if (entry.used) {
    otpStore.delete(mfa_token);
    return res.status(400).json({ error: 'OTP already used. Please login again.' });
  }

  entry.attempts += 1;
  const ok = (sha256(otp) === entry.otp_hash);
  if (!ok) {
    otpStore.set(mfa_token, entry); // update attempts
    return res.status(401).json({ error: 'Invalid OTP' });
  }

  // Mark used to prevent replay (CNS: replay attack defense)
  entry.used = true;
  otpStore.set(mfa_token, entry);

  // In a real system you would now issue a session/JWT. For demo, we return a mock token.
  const sessionToken = Buffer.from(`${entry.role}:${entry.username}:${Date.now()}`).toString('base64');

  // Update last_login asynchronously; do not block response
  (async ()=>{
    try{
      if(entry.user_id && entry.role === 'student'){
        await pool.query('UPDATE students SET last_login = NOW() WHERE id = $1', [entry.user_id]);
      } else if(entry.user_id && entry.role === 'faculty'){
        await pool.query('UPDATE faculty SET updated_at = NOW() WHERE id = $1', [entry.user_id]);
      }
    }catch(e){ console.warn('[MFA] failed to update last_login:', e.message); }
  })();

  return res.json({ ok: true, token: sessionToken, user: { id: entry.user_id || null, username: entry.username, role: entry.role, name: entry.name || '' } });
});

module.exports = router;
