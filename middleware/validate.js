// /middleware/validate.js
const Joi = require('joi');

module.exports = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });  // Get all errors at once
  if (error) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: error.details.map(detail => detail.message)
    });
  }
  next();
};
