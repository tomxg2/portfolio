import { z } from 'zod';

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be under 100 characters')
    .regex(/^[\p{L}\p{M}\s'\-,.]+$/u, 'Name contains invalid characters'),
  email: z
    .string()
    .trim()
    .email('Please provide a valid email address')
    .max(254, 'Email address too long'),
  message: z
    .string()
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(2000, 'Message must be under 2000 characters'),
});

/**
 * Middleware factory — validates req.body against a Zod schema.
 * Returns 400 with field errors on failure; calls next() on success.
 * Replaces req.body with the parsed (trimmed/coerced) value.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = result.data;
    next();
  };
}
