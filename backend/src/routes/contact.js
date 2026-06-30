import { Router } from 'express';
import crypto from 'crypto';
import { contactRateLimiter } from '../middleware/rateLimiter.js';
import { validate, contactSchema } from '../middleware/validate.js';
import { supabase } from '../lib/supabase.js';
import { sendContactNotification } from '../lib/email.js';

const router = Router();

/**
 * POST /api/contact
 * Accepts a contact form submission, saves to Supabase, sends notification email.
 */
router.post(
  '/contact',
  contactRateLimiter,
  validate(contactSchema),
  async (req, res) => {
    const { name, email, message } = req.body;

    // Hash the IP for GDPR compliance — we never store raw IPs
    const rawIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex');

    try {
      // 1. Persist to Supabase
      const { error: dbError } = await supabase
        .from('contact_submissions')
        .insert([{ name, email, message, ip_hash: ipHash }]);

      if (dbError) {
        console.error('[contact] DB error:', dbError.message);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }

      // 2. Send email notification
      try {
        await sendContactNotification({ name, email, message });
      } catch (emailErr) {
        console.error('[contact] Email error:', emailErr.message);
      }

      return res.status(200).json({
        success: true,
        message: "Thanks for your message! I'll get back to you soon.",
      });
    } catch (err) {
      console.error('[contact] Unexpected error:', err.message);
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  }
);

export default router;
