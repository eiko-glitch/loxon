const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { requireRole } = require("../middleware/requireAuth");

// GET /api/teams
router.get("/", requireRole("admin"), async (req, res) => {
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

// GET /api/teams/:id
router.get("/:id", requireRole("admin"), async (req, res) => {
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

// POST /api/teams
router.post("/", requireRole("admin"), async (req, res) => {
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

// PATCH /api/teams/:id
router.patch("/:id", requireRole("admin"), async (req, res) => {
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

// DELETE /api/teams/:id
router.delete("/:id", requireRole("admin"), async (req, res) => {
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

module.exports = router;
