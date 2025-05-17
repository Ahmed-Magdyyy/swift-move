// utils/ApiError.js (enhanced)
class ApiError extends Error {
  constructor(message, statusCode, errors = []) {
    super(message);
    
    this.message = message
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.errors = errors;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }

  // static methods for common errors
  // static badRequest(message, errors = []) {
  //   return new ApiError(message, 400, errors);
  // }

  // static unauthorized(message = 'Unauthorized') {
  //   return new ApiError(message, 401);
  // }

  // static forbidden(message = 'Forbidden') {
  //   return new ApiError(message, 403);
  // }

  // static notFound(message = 'Resource not found') {
  //   return new ApiError(message, 404);
  // }

  // static conflict(message = 'Conflict occurred') {
  //   return new ApiError(message, 409);
  // }

  // static internal(message = 'Internal server error') {
  //   return new ApiError(message, 500);
  // }
}

module.exports = ApiError;