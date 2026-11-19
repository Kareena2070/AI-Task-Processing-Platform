"use strict";

const express = require("express");
const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { registerSchema, loginSchema } = require("../validators/authSchemas");
const {
  loginLimiter,
  registerLimiter,
  apiLimiter,
} = require("../middlewares/rateLimiter");

const router = express.Router();

// POST /api/auth/register (rate limiting runs before validation)
router.post(
  "/register",
  registerLimiter,
  validate({ body: registerSchema }),
  authController.register
);

// POST /api/auth/login (rate limiting runs before validation)
router.post(
  "/login",
  loginLimiter,
  validate({ body: loginSchema }),
  authController.login
);

// GET /api/auth/me (apiLimiter applied before authentication middleware)
router.get("/me", apiLimiter, authMiddleware, authController.getCurrentUser);

module.exports = router;
