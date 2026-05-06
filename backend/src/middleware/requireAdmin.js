const crypto = require('crypto');

// Compare two strings in constant time. timingSafeEqual rejects buffers of
// different lengths, so we pad the shorter one to a fixed compare length and
// then verify the original lengths matched.
function safeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

let warnedMissing = false;

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    if (!warnedMissing) {
      console.warn('[requireAdmin] ADMIN_TOKEN is not set — all admin routes will 503. Set it in backend/.env.');
      warnedMissing = true;
    }
    return res.status(503).json({ error: 'Admin token not configured on server' });
  }
  const provided = req.header('x-admin-token') || '';
  if (!provided || !safeStringEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = requireAdmin;
