const crypto = require('crypto');
const { pool } = require('./db');

const ADMIN_ROLES = new Set(['admin', 'administrator', 'super_admin']);
let warnedDevBypass = false;

/**
 * Extract raw session ID from an Express-style signed cookie (`s:<id>.<sig>`) or plain ID.
 * Mirrors SSOHelper::getTfdUserFromCookie in tfdtaskmanager.
 *
 * @param {string | undefined} rawCookie
 * @returns {string | null}
 */
function parseTfdSessionId(rawCookie) {
  if (!rawCookie || typeof rawCookie !== 'string') return null;
  let decoded = rawCookie;
  try {
    decoded = decodeURIComponent(rawCookie);
  } catch (_) {}

  let sessionId = decoded.trim();
  if (!sessionId) return null;

  if (sessionId.startsWith('s:')) {
    sessionId = sessionId.slice(2);
    const dotIdx = sessionId.indexOf('.');
    if (dotIdx !== -1) {
      sessionId = sessionId.slice(0, dotIdx);
    }
  }
  return sessionId.trim() || null;
}

/**
 * Look up central TFD user via `TFD.sessions` + `TFD.users` if the MySQL user has access.
 *
 * @param {string} sessionId
 * @returns {Promise<{ id: number, username: string, email: string, role: string } | null>}
 */
async function fetchTfdUserBySessionId(sessionId) {
  if (!sessionId) return null;
  const activeType = await pool.getActiveType();
  if (activeType !== 'mysql') return null;

  const tfdDb = (process.env.TFD_AUTH_DB || 'TFD').replace(/[^a-zA-Z0-9_]/g, '');
  if (!tfdDb) return null;

  try {
    const [rows] = await pool.query(
      `SELECT data, expires FROM \`${tfdDb}\`.sessions WHERE session_id = ? AND expires > UNIX_TIMESTAMP() LIMIT 1`,
      [sessionId]
    );
    if (!rows || rows.length === 0 || !rows[0].data) return null;

    const sessData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    const userId = sessData && sessData.passport ? sessData.passport.user : null;
    if (!userId) return null;

    const [uRows] = await pool.query(
      `SELECT id, username, email, role FROM \`${tfdDb}\`.users WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (!uRows || uRows.length === 0) return null;
    return uRows[0];
  } catch (err) {
    // Table may not exist locally or MySQL user may lack cross-DB SELECT grant
    return null;
  }
}

/**
 * Optional HTTP fallback when central TFD auth service exposes a verify endpoint.
 *
 * @param {string | undefined} cookieHeader
 * @returns {Promise<{ role?: string, is_admin?: boolean } | null>}
 */
async function fetchTfdUserViaHttp(cookieHeader) {
  const verifyUrl = process.env.TFD_AUTH_VERIFY_URL;
  if (!verifyUrl || !cookieHeader) return null;
  try {
    const res = await fetch(verifyUrl, {
      method: 'GET',
      headers: { Cookie: cookieHeader }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && (data.user || data)) || null;
  } catch (_) {
    return null;
  }
}

function isRoleAdmin(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.is_admin === true || user.isAdmin === true || user.is_super_admin === true) return true;
  if (typeof user.role === 'string' && ADMIN_ROLES.has(user.role.toLowerCase())) return true;
  if (Array.isArray(user.roles) && user.roles.some((r) => ADMIN_ROLES.has(String(r).toLowerCase()))) return true;
  return false;
}

/**
 * Resolve whether the incoming Koa request belongs to an authenticated TFD administrator.
 *
 * @param {import('koa').Context} ctx
 * @returns {Promise<{ isAdmin: boolean, user: object | null, source: string }>}
 */
async function resolveRequestAdmin(ctx) {
  const rawCookie = ctx.cookies ? ctx.cookies.get('session_id') : undefined;
  const sessionId = parseTfdSessionId(rawCookie);

  if (sessionId) {
    const tfdUser = await fetchTfdUserBySessionId(sessionId);
    if (tfdUser) {
      return {
        isAdmin: isRoleAdmin(tfdUser),
        user: tfdUser,
        source: 'tfd_db_session'
      };
    }

    const httpUser = await fetchTfdUserViaHttp(ctx.headers && ctx.headers.cookie);
    if (httpUser) {
      return {
        isAdmin: isRoleAdmin(httpUser),
        user: httpUser,
        source: 'tfd_http_session'
      };
    }
  }

  const isProd = process.env.NODE_ENV === 'production';
  const enforceStrict = process.env.ENFORCE_ADMIN_SESSION === 'true';
  const queryWantsAdmin =
    ctx.query &&
    (ctx.query.admin === 'true' || ctx.query.admin === '1' || ctx.query.all === 'true' || ctx.query.all === '1');
  const headerWantsAdmin = ctx.headers && ctx.headers['x-tfd-admin'] === '1';

  // Never trust client-asserted query/header admin flags in production.
  if (!isProd && !enforceStrict && (queryWantsAdmin || headerWantsAdmin)) {
    if (!warnedDevBypass) {
      warnedDevBypass = true;
      console.warn('[AUTH] Development fallback: trusting ?admin=true because NODE_ENV !== production and no TFD session DB was resolved.');
    }
    return { isAdmin: true, user: null, source: 'dev_query_fallback' };
  }

  return { isAdmin: false, user: null, source: 'unauthenticated' };
}

/**
 * Constant-time HMAC-SHA256 verification for server-to-server publish calls from tfdtaskmanager.
 *
 * @param {import('koa').Context} ctx
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyPublishSignature(ctx) {
  const secret = process.env.SANDBOX_PUBLISH_SECRET || '';
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProd || process.env.ALLOW_UNSIGNED_LOCAL_PUBLISH !== 'true') {
      const ip = (ctx.ip || '').replace(/^::ffff:/, '');
      const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
      if (isProd || !isLoopback) {
        return { ok: false, reason: 'SANDBOX_PUBLISH_SECRET is not configured on lobby server.' };
      }
      console.warn('[PUBLISH-AUTH] SANDBOX_PUBLISH_SECRET unset; allowing loopback request in non-production.');
      return { ok: true };
    }
    return { ok: true };
  }

  const sig = String((ctx.request.headers && ctx.request.headers['x-tfd-signature']) || '').trim();
  const timestamp = String((ctx.request.headers && ctx.request.headers['x-tfd-timestamp']) || '').trim();

  if (sig && timestamp) {
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) {
      return { ok: false, reason: 'Publish signature timestamp expired.' };
    }
    const rawBody =
      ctx.request.rawBody !== undefined
        ? ctx.request.rawBody
        : typeof ctx.request.body === 'string'
        ? ctx.request.body
        : JSON.stringify(ctx.request.body || {});
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: true };
      }
    } catch (_) {}
    return { ok: false, reason: 'Invalid publish HMAC signature.' };
  }

  return { ok: false, reason: 'Missing X-TFD-Signature or X-TFD-Timestamp headers.' };
}

module.exports = {
  resolveRequestAdmin,
  verifyPublishSignature,
  parseTfdSessionId
};
