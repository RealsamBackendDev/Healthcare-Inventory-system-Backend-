const { ZodError } = require('zod');
const { AppError } = require('../shared/errors/AppError');
const environment = require('../config/environment');

const notFoundHandler = (req, res, next) => {
  next(new AppError('The requested resource was not found', 404, 'NOT_FOUND'));
};

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong while processing the request';
  let details = null;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ZodError) {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'The submitted data is not valid';
    details = error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
  } else if (error && error.code === '23505') {
    statusCode = 409;
    code = 'DUPLICATE_RECORD';
    message = 'A record with these details already exists';
  } else if (error && error.code === '23503') {
    statusCode = 409;
    code = 'RELATED_RECORD_CONFLICT';
    message = 'This record is referenced by other records and cannot be changed';
  } else if (error && error.code === '23514') {
    statusCode = 400;
    code = 'CONSTRAINT_VIOLATION';
    message = 'The submitted values violate a database constraint';
  } else if (error && error.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON';
  } else if (error && error.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    code = 'FILE_TOO_LARGE';
    message = 'The uploaded file is too large';
  } else if (error && error.statusCode && error.statusCode < 500) {
    statusCode = error.statusCode;
    code = error.code || 'BAD_REQUEST';
    message = error.message;
  }

  if (statusCode >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} failed`, error);
    if (!environment.isProduction && error && error.stack) {
      details = { stack: error.stack.split('\n').slice(0, 5) };
    }
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details
    }
  });
};

module.exports = {
  notFoundHandler,
  errorHandler
};
