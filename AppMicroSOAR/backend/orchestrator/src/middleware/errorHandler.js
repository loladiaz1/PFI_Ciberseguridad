module.exports = function errorHandler(err, _req, res, _next) {
  console.error(err);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error',
  });
};
