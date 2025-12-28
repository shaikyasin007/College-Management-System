const jwt = require('jsonwebtoken');
require('dotenv').config();

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'SUPER_ADMIN role required' });
  }
  return next();
}

function requireAdminOrSuper(req, res, next) {
  if (!req.user || !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'ADMIN or SUPER_ADMIN role required' });
  }
  return next();
}

module.exports = { requireAuth, requireSuperAdmin, requireAdminOrSuper };


