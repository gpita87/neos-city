const axios = require('axios');

// Transactional email via Resend (https://resend.com). REST-only — no SDK.
//
// Dev fallback: when RESEND_API_KEY is unset we DON'T send. Instead we log the
// full message (including any verification/reset link) to the server console, so
// the whole auth flow is testable locally without a provider or a verified domain.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Neos City <onboarding@resend.dev>';

  if (!apiKey) {
    console.log('\n[email:dev-fallback] RESEND_API_KEY unset — not sending. Message follows:');
    console.log(`  to:      ${to}`);
    console.log(`  from:    ${from}`);
    console.log(`  subject: ${subject}`);
    console.log(`  html:    ${html}\n`);
    return { delivered: false, devFallback: true };
  }

  await axios.post(
    RESEND_ENDPOINT,
    { from, to, subject, html },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  );
  return { delivered: true };
}

// Shared shell so the two templates look consistent.
function wrap(title, body) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
      <h2 style="color:#0891b2">${title}</h2>
      ${body}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px">Neos City — Pokkén Tournament community hub</p>
    </div>`;
}

function button(url, label) {
  return `<p><a href="${url}" style="display:inline-block;background:#06b6d4;color:#fff;
    text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${label}</a></p>
    <p style="color:#64748b;font-size:13px">Or paste this link into your browser:<br>${url}</p>`;
}

function sendVerificationEmail(to, url) {
  return sendEmail({
    to,
    subject: 'Verify your Neos City email',
    html: wrap('Confirm your email', `
      <p>Welcome to Neos City! Confirm this address to finish setting up your account
      and claim your player profile.</p>
      ${button(url, 'Verify email')}
      <p style="color:#64748b;font-size:13px">This link expires in 24 hours. If you didn't
      sign up, you can ignore this email.</p>`),
  });
}

function sendPasswordResetEmail(to, url) {
  return sendEmail({
    to,
    subject: 'Reset your Neos City password',
    html: wrap('Reset your password', `
      <p>We received a request to reset your password.</p>
      ${button(url, 'Choose a new password')}
      <p style="color:#64748b;font-size:13px">This link expires in 1 hour. If you didn't
      request this, you can safely ignore it — your password won't change.</p>`),
  });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };
