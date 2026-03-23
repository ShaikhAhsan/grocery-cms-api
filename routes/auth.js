/**
 * Auth routes - login with email/password
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');
const router = express.Router();

router.post('/login', async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const users = await sequelize.query(
      'SELECT * FROM users WHERE email = ?',
      { type: QueryTypes.SELECT, replacements: [email] }
    );
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];
    const passwordCol = user.password_hash || user.password;
    const isPasswordValid = passwordCol && await bcrypt.compare(password, passwordCol);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const accessToken = jwt.sign(
      { userId: user.user_id || user.id },
      process.env.ACCESS_TOKEN_SECRET || 'grocery-secret',
      { expiresIn: '1h' }
    );
    const refreshToken = jwt.sign(
      { userId: user.user_id || user.id },
      process.env.REFRESH_TOKEN_SECRET || 'grocery-refresh',
      { expiresIn: '7d' }
    );

    res.json({ accessToken, refreshToken });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
