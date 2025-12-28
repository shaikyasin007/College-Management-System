const { Pool } = require('pg');
require('dotenv').config();

// Use Render/Neon style DATABASE_URL with SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = { pool };


