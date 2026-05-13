export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const httpError = (status, message, details) => new HttpError(status, message, details);

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorMiddleware(err, _req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[err]', err);
  res.status(status).json({
    error: err.message || 'Erro interno',
    details: err.details,
  });
}
