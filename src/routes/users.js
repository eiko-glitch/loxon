const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { requireRole } = require("../middleware/requireAuth");

// GET /api/users — get all users (optional ?team_id=1 ?role=supervisor)
router.get("/", requireRole("admin"), async (req, res) => {
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

// GET /api/users/:id — get single user
router.get("/:id", requireRole("admin"), async (req, res) => {
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

// POST /api/users — create user (supervisor or engineer only)
router.post("/", requireRole("admin"), async (req, res) => {
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

    const bcrypt = require("bcryptjs");
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

// PATCH /api/users/:id — update user
router.patch("/:id", requireRole("admin"), async (req, res) => {
  try {
    const { name, email, role, status, team_id } = req.body;

    if (role && !["supervisor", "engineer"].includes(role)) {
      return res
        .status(400)
        .json({ error: "Can only set supervisor or engineer" });
    }

    const result = await db.query(
      `UPDATE users
       SET
         name     = COALESCE($1, name),
         email    = COALESCE($2, email),
         role     = COALESCE($3, role),
         status   = COALESCE($4, status),
         team_id  = COALESCE($5, team_id),
         updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, email, role, status, team_id`,
      [name, email, role, status, team_id, req.params.id],
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

// DELETE /api/users/:id — delete user
router.delete("/:id", requireRole("admin"), async (req, res) => {
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
