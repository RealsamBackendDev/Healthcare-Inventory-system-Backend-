const { ValidationError } = require('../shared/errors/AppError');

const validate = (schemas) => (req, res, next) => {
  try {
    ['params', 'query', 'body'].forEach((key) => {
      const schema = schemas[key];
      if (!schema) {
        return;
      }
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || key,
          message: issue.message
        }));
        throw new ValidationError('The submitted data is not valid', details);
      }
      if (key === 'query') {
        Object.assign(req.query, result.data);
      } else {
        req[key] = result.data;
      }
    });
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = validate;
