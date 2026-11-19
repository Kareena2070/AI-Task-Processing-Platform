"use strict";

const { rateLimit } = require("express-rate-limit");

/**
 * Validates whether an environment variable is a positive integer,
 * returning the fallback default if invalid, zero, or negative.
 *
 * @param {string|undefined} envVal
 * @param {number} defaultVal
 * @returns {number}
 */
function parsePositiveInteger(envVal, defaultVal) {
  if (!envVal || typeof envVal !== "string") {
    return defaultVal;
  }
  const parsed = parseInt(envVal.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultVal;
}

/**
 * Checks whether rate limiting should be bypassed.
 *
 * Bypasses when:
 * 1. Explicitly disabled via DISABLE_RATE_LIMIT === "true"
 * 2. In a test environment (NODE_ENV === "test") UNLESS explicitly testing rate limits (ENABLE_RATE_LIMIT === "true")
 *
 * @returns {boolean}
 */
function shouldSkip() {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return true;
  }
  if (process.env.NODE_ENV === "test" && process.env.ENABLE_RATE_LIMIT !== "true") {
    return true;
  }
  return false;
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// 1. Login Limiter: 5 attempts per 15 min; successful logins do not count
const loginLimit = parsePositiveInteger(process.env.RATE_LIMIT_LOGIN_LIMIT, 5);
const loginLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: loginLimit,
  skipSuccessfulRequests: true,
  skip: shouldSkip,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
  message: "Too many login attempts from this IP, please try again after 15 minutes",
});

// 2. Register Limiter: 5 attempts per 15 min; all attempts count
const registerLimit = parsePositiveInteger(process.env.RATE_LIMIT_REGISTER_LIMIT, 5);
const registerLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: registerLimit,
  skipSuccessfulRequests: false,
  skip: shouldSkip,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
  message: "Too many registration attempts from this IP, please try again after 15 minutes",
});

// 3. API Limiter: 100 requests per 15 min for general operations and collections
const apiLimit = parsePositiveInteger(process.env.RATE_LIMIT_API_LIMIT, 100);
const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: apiLimit,
  skip: shouldSkip,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
  message: "Too many requests from this IP, please try again after 15 minutes",
});

// 4. Polling Limiter: 1,200 requests per 15 min for high-frequency task detail & log polling
const pollingLimit = parsePositiveInteger(process.env.RATE_LIMIT_POLLING_LIMIT, 1200);
const pollingLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: pollingLimit,
  skip: shouldSkip,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      success: false,
      message: options.message,
    });
  },
  message: "Too many polling requests from this IP, please try again after 15 minutes",
});

module.exports = {
  loginLimiter,
  registerLimiter,
  apiLimiter,
  pollingLimiter,
};
