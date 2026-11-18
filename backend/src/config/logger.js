const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

const sensitiveNormalized = new Set([
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "xapikey",
  "secret",
  "clientsecret",
  "authorization",
  "cookie",
  "signature",
  "mongodburi",
  "redisurl",
]);

function isSensitiveKey(key) {
  if (typeof key !== "string") {
    return false;
  }
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  if (sensitiveNormalized.has(normalized)) {
    return true;
  }
  return (
    normalized.endsWith("password") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("apikey")
  );
}

// Recursive sanitization strategy for arbitrarily nested objects and arrays
function sanitize(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  if (seen.has(obj)) {
    return "[Circular]";
  }
  seen.add(obj);

  if (obj instanceof Error) {
    const errObj = {
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
    };
    for (const [key, value] of Object.entries(obj)) {
      if (isSensitiveKey(key)) {
        errObj[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        errObj[key] = sanitize(value, seen);
      } else {
        errObj[key] = value;
      }
    }
    return errObj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, seen));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitize(value, seen);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      'req.headers["x-api-key"]',
      'headers["x-api-key"]',
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "apiKey",
      "secret",
      "MONGODB_URI",
      "REDIS_URL",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    log(object) {
      return sanitize(object);
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
