const jwt = require("jsonwebtoken");

// MVP: un solo rol/usuario fijo por env vars (PLAN.md seccion 9 -- claims
// pensados para RBAC a futuro aunque hoy haya un solo rol).
function login(username, password) {
  if (username !== process.env.AUTH_USER || password !== process.env.AUTH_PASSWORD) {
    return null;
  }

  const token = jwt.sign(
    { sub: username, role: "soc-analyst" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  return token;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ detail: "Missing bearer token" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }
}

module.exports = { login, requireAuth };
