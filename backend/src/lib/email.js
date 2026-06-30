import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  throw new Error('Missing RESEND_API_KEY environment variable');
}

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send a contact form notification email to Tom.
 * @param {{ name: string, email: string, message: string }} data
 */
export async function sendContactNotification({ name, email, message }) {
  const to = process.env.CONTACT_EMAIL;
  if (!to) throw new Error('Missing CONTACT_EMAIL environment variable');

  const { error } = await resend.emails.send({
    from: 'Portfolio Contact <hello@tomhiestand.dev>',
    to,
    replyTo: email,
    subject: `New portfolio message from ${name}`,
    text: `New contact form submission\nReceived on ${new Date().toLocaleString('en-CH', { timeZone: 'Europe/Zurich' })} (Zurich time)\n\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}\n\nHit reply to respond directly to ${name}.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #0a0a0a; margin-bottom: 8px;">New contact form submission</h2>
        <p style="color: #666; font-size: 14px; margin-bottom: 24px;">
          Received on ${new Date().toLocaleString('en-CH', { timeZone: 'Europe/Zurich' })} (Zurich time)
        </p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #888; font-size: 14px; width: 80px;">Name</td>
            <td style="padding: 8px 0; font-weight: 600;">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #888; font-size: 14px;">Email</td>
            <td style="padding: 8px 0;">
              <a href="mailto:${escapeHtml(email)}" style="color: #60a5fa;">${escapeHtml(email)}</a>
            </td>
          </tr>
        </table>
        <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
        <h3 style="font-size: 14px; color: #888; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">Message</h3>
        <p style="line-height: 1.6; white-space: pre-wrap; background: #f9f9f9; padding: 16px; border-radius: 8px;">
          ${escapeHtml(message)}
        </p>
        <p style="font-size: 12px; color: #bbb; margin-top: 24px;">
          Hit reply to respond directly to ${escapeHtml(name)}.
        </p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
