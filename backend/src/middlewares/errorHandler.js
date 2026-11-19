const logger = require("../config/logger");

function getSanitizedPath(req) {
  const rawUrl = req.originalUrl || req.url || "";
  return rawUrl.split(/[?#]/)[0] || "/";
}

// Centralized error handling middleware
// Express identifies error middleware by 4 arguments: (err, req, res, next)
function errorHandler(err, req, res, next) {
  // If response headers have already been sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === "production";

  const message =
    isProduction && statusCode >= 500
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

  const errorDetails = {
    statusCode,
    message: err.message,
    method: req.method,
    url: getSanitizedPath(req),
    stack: !isProduction ? err.stack : undefined,
  };

  if (statusCode >= 500) {
    logger.error(errorDetails, "Server error caught by centralized error handler");
  } else {
    logger.warn(errorDetails, "Client error caught by centralized error handler");
  }

  const response = {
    success: false,
    message,
  };

  if (!isProduction && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
