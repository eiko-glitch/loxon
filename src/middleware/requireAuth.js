const jwt = require("jsonwebtoken");
const pool = require("../lib/db");

const JWT_SECRET = process.env.JWT_SECRET;

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer "))
    return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await pool.query(
      "SELECT id, role, status, team_id, name FROM users WHERE id = $1",
      [decoded.id],
    );
    const user = result.rows[0];

    if (!user || user.status === "inactive")
      return res.status(403).json({ message: "Account inactive or not found" });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Token expired" });
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ message: "Not authenticated" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    next();
  };
}

module.exports = { requireAuth, requireRole };
