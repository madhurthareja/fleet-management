const jwt = require('jsonwebtoken');
const config = require('../config');

function sign(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Verifies the Bearer JWT and attaches req.user. 401 when missing/invalid. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Role-based access control. 403 when the authenticated role is not allowed. */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires role ${roles.join(' or ')}` });
    }
    next();
  };
}

/** Service-to-service calls carry x-internal-token instead of a user JWT. */
function internalOrRoles(...roles) {
  return (req, res, next) => {
    if (req.headers['x-internal-token'] === config.internalToken) {
      req.user = { role: 'service', username: 'internal' };
      return next();
    }
    return authenticate(req, res, () => authorize(...roles)(req, res, next));
  };
}

module.exports = { sign, authenticate, authorize, internalOrRoles };
