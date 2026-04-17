const { publicApiErrorMessage } = require('./publicApiErrorMessage');

module.exports = {
  successResponse: (res, data, message = 'Success', statusCode = 200) => {
    res.status(statusCode).json({
      statusCode,
      success: true,
      message,
      data,
    });
  },
  /** Pass an `Error` instance to return a safe message for DB/network failures; strings pass through unchanged. */
  errorResponse: (res, messageOrErr = 'Something went wrong', statusCode = 500) => {
    const message =
      messageOrErr instanceof Error
        ? publicApiErrorMessage(messageOrErr, 'Something went wrong')
        : String(messageOrErr || 'Something went wrong');
    res.status(statusCode).json({
      statusCode,
      success: false,
      message,
      data: null,
    });
  },
};
