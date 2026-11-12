const express = require('express');
const rateLimit = require('express-rate-limit');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const controller = require('./auth.controller');
const schemas = require('./auth.validation');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many failed login attempts. Please try again later'
    }
  }
});

router.post('/auth/login', loginLimiter, validate({ body: schemas.loginSchema }), controller.login);
router.get('/auth/me', authenticate, controller.me);
router.post('/auth/logout', authenticate, controller.logout);
router.post('/auth/change-password', authenticate, validate({ body: schemas.changePasswordSchema }), controller.changePassword);

module.exports = router;
