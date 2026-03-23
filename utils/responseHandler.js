module.exports = {
  successResponse: (res, data, message = 'Success', statusCode = 200) => {
    res.status(statusCode).json({
      statusCode,
      success: true,
      message,
      data,
    });
  },
  errorResponse: (res, message = 'Something went wrong', statusCode = 500) => {
    res.status(statusCode).json({
      statusCode,
      success: false,
      message,
      data: null,
    });
  },
};
