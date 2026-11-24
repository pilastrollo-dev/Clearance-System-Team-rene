
const mysql = require('mysql2/promise');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'teamrene_clearance',

  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
};

// Enable TLS in production or when explicitly testing TiDB
if (isProduction || process.env.DB_SSL === 'true') {
  dbConfig.ssl = {
    rejectUnauthorized: true,
    ...(process.env.DB_SSL_CA
      ? { ca: process.env.DB_SSL_CA }
      : {}),
  };
}

const db = mysql.createPool(dbConfig);

module.exports = { db };
