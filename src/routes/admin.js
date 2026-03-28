// routes/admin.js
const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const bcrypt = require("bcryptjs");
const { requireRole } = require("../middleware/requireAuth");

router.use(requireRole("admin"));

// ─── TEAMS ───────────────────────────────────────────────────────────────────

// GET /api/admin/teams
router.get("/teams", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT t.id, t.name, COUNT(u.id)::int AS member_count
      FROM teams t
      LEFT JOIN users u ON u.team_id = t.id
      GROUP BY t.id
      ORDER BY t.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/teams/:id
router.get("/teams/:id", async (req, res) => {
  try {
    const result = await db.query(`SELECT id, name FROM teams WHERE id = $1`, [
      req.params.id,
    ]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Team not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/teams
router.post("/teams", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const result = await db.query(
      `INSERT INTO teams (name) VALUES ($1) RETURNING id, name`,
      [name],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/teams/:id
router.patch("/teams/:id", async (req, res) => {
  try {
    const { name } = req.body;
    const result = await db.query(
      `UPDATE teams SET name = COALESCE($1, name) WHERE id = $2 RETURNING id, name`,
      [name, req.params.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Team not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/teams/:id
router.delete("/teams/:id", async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM teams WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Team not found" });
    res.json({ message: "Team deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── USERS ───────────────────────────────────────────────────────────────────

// GET /api/admin/users?team_id=1&role=supervisor
router.get("/users", async (req, res) => {
  try {
    const { team_id, role } = req.query;
    let query = `
      SELECT u.id, u.name, u.email, u.role, u.status, u.team_id, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (team_id) {
      params.push(team_id);
      query += ` AND u.team_id = $${params.length}`;
    }
    if (role) {
      params.push(role);
      query += ` AND u.role = $${params.length}`;
    }

    query += ` ORDER BY u.created_at DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/admin/users/:id
router.get("/users/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.team_id, t.name AS team_name
       FROM users u
       LEFT JOIN teams t ON u.team_id = t.id
       WHERE u.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/admin/users
router.post("/users", async (req, res) => {
  try {
    const { name, email, password, role, team_id } = req.body;

    if (!["supervisor", "engineer"].includes(role)) {
      return res
        .status(400)
        .json({ error: "Can only create supervisor or engineer" });
    }
    if (!name || !email || !password || !role || !team_id) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (name, email, password, role, team_id, status)
       VALUES ($1, $2, $3, $4, $5, 'offline')
       RETURNING id, name, email, role, status, team_id`,
      [name, email, hashed, role, team_id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "Email already exists" });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PATCH /api/admin/users/:id
router.patch("/users/:id", async (req, res) => {
  try {
    const { name, email, role, status, team_id, password } = req.body;

    if (role && !["supervisor", "engineer"].includes(role)) {
      return res
        .status(400)
        .json({ error: "Can only set supervisor or engineer" });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const result = await db.query(
      `UPDATE users
       SET
         name       = COALESCE($1, name),
         email      = COALESCE($2, email),
         role       = COALESCE($3, role),
         status     = COALESCE($4, status),
         team_id    = COALESCE($5, team_id),
         password   = COALESCE($6, password),
         updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, email, role, status, team_id`,
      [name, email, role, status, team_id, hashedPassword, req.params.id],
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "Email already exists" });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  try {
    const result = await db.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
