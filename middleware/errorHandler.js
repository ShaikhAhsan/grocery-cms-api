const { publicApiErrorMessage } = require('../utils/publicApiErrorMessage');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: publicApiErrorMessage(err, 'Server Error'),
  });
};

module.exports = errorHandler;
