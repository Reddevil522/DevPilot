const errorHandler = (err, req, res, next) => {
  console.error(err);

  // Default error message
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong.';
  
  // Do not expose stack traces or internal errors in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Something went wrong.';
  }

  // Handle Mongoose Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate field value entered.';
  }

  // Handle Mongoose Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  }

  res.status(statusCode).json({
    success: false,
    message: message,
    errors: err.errors || []
  });
};

module.exports = errorHandler;
