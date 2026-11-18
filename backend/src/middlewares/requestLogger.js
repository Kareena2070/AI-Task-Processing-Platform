const logger = require("../config/logger");

function getSanitizedPath(req) {
  const rawUrl = req.originalUrl || req.url || "";
  return rawUrl.split(/[?#]/)[0] || "/";
}

function requestLogger(req, res, next) {
  const startTime = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: getSanitizedPath(req),
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    };

    if (res.statusCode >= 500) {
      logger.error(logData, "HTTP Request Error");
    } else if (res.statusCode >= 400) {
      logger.warn(logData, "HTTP Request Client Warning");
    } else {
      logger.info(logData, "HTTP Request Completed");
    }
  });

  next();
}

module.exports = requestLogger;
