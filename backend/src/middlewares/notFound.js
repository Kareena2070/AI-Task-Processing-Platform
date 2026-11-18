const AppError = require("../utils/appError");

function getSanitizedPath(req) {
  const rawUrl = req.originalUrl || req.url || "";
  return rawUrl.split(/[?#]/)[0] || "/";
}

function notFound(req, res, next) {
  const sanitizedPath = getSanitizedPath(req);
  next(new AppError(`Route not found: ${req.method} ${sanitizedPath}`, 404));
}

module.exports = notFound;
