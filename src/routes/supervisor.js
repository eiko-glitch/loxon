// routes/supervisor.js
const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { requireRole } = require("../middleware/requireAuth");

router.use(requireRole("supervisor"));

// ─── MEMBERS ─────────────────────────────────────────────────────────────────

router.get("/members", async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const { rows: supRows } = await db.query(
      "SELECT team_id FROM users WHERE id = $1",
      [supervisorId],
    );
    const teamId = supRows[0]?.team_id;

    let result;
    if (teamId) {
      result = await db.query(
        `SELECT u.id, u.name, t.name AS team_name
         FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
         WHERE u.role = 'engineer'
           AND u.status != 'inactive'
           AND u.team_id = $1
         ORDER BY u.name`,
        [teamId],
      );
    } else {
      result = await db.query(
        `SELECT u.id, u.name, COALESCE(t.name, 'No Team') AS team_name
         FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
         WHERE u.role = 'engineer'
           AND u.status != 'inactive'
         ORDER BY u.name`,
      );
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── FORMS ───────────────────────────────────────────────────────────────────

router.get("/forms/pending", async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const { rows } = await db.query(
      `SELECT
         f.id,
         f.title,
         f.client_name,
         f.company_name,
         f.priority_level,
         f.date_from,
         f.date_to,
         f.status,
         u.name AS assigned_to_name
       FROM forms f
       JOIN users u ON u.id = f.assigned_to
       WHERE f.status = 'pending'
         AND f.assigned_to = $1
       ORDER BY
         CASE f.priority_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         f.created_at DESC`,
      [supervisorId],
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/forms/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    const { rows } = await db.query(
      `SELECT
         f.*,
         creator.name   AS created_by_name,
         assignee.name  AS assigned_to_name
       FROM forms f
       JOIN users creator  ON creator.id  = f.created_by
       JOIN users assignee ON assignee.id = f.assigned_to
       WHERE f.id = $1
         AND (f.created_by = $2 OR f.assigned_to = $2)`,
      [id, supervisorId],
    );

    if (!rows.length)
      return res.status(404).json({ message: "Form not found" });

    const form = rows[0];

    const { rows: attachments } = await db.query(
      "SELECT id, type, file_url FROM attachments WHERE form_id = $1",
      [id],
    );
    form.attachments = attachments;

    const { rows: trackingRows } = await db.query(
      "SELECT id AS tracking_id FROM tracking WHERE form_id = $1 LIMIT 1",
      [id],
    );
    form.tracking_id = trackingRows[0]?.tracking_id ?? null;

    res.json(form);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/forms", async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const {
      title,
      description,
      client_name,
      company_name,
      priority_level = "medium",
      date_from,
      date_to,
      duration,
      assigned_to,
      comment,
    } = req.body;

    if (
      !title ||
      !client_name ||
      !company_name ||
      !date_from ||
      !date_to ||
      !assigned_to
    ) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const { rows: memberRows } = await db.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'engineer' AND status != 'inactive'",
      [assigned_to],
    );
    if (!memberRows.length) {
      return res.status(400).json({ message: "Invalid member." });
    }

    const { rows } = await db.query(
      `INSERT INTO forms
         (created_by, assigned_to, title, description, client_name, company_name,
          priority_level, date_from, date_to, duration, status, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
       RETURNING id`,
      [
        supervisorId,
        assigned_to,
        title,
        description ?? null,
        client_name,
        company_name,
        priority_level,
        date_from,
        date_to,
        duration ?? null,
        comment ?? null,
      ],
    );

    res.status(201).json({ id: rows[0].id, message: "Form created." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/forms/:id/accept", async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    const { rowCount, rows } = await db.query(
      `UPDATE forms
       SET status = 'accepted', updated_at = NOW()
       WHERE id = $1
         AND (assigned_to = $2 OR created_by = $2)
         AND status = 'pending'
       RETURNING id, created_by, assigned_to`,
      [id, supervisorId],
    );

    if (!rowCount)
      return res
        .status(404)
        .json({ message: "Form not found or not pending." });

    const workerId =
      rows[0].created_by === supervisorId
        ? rows[0].assigned_to // supervisor made it → engineer is assigned_to
        : rows[0].created_by; // engineer made it → engineer is created_by

    await db.query(
      `INSERT INTO tracking (form_id, worker_id, status, started_at, updated_at)
       VALUES ($1, $2, 'ongoing', NOW(), NOW())`,
      [rows[0].id, workerId],
    );

    res.json({ message: "Form accepted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/forms/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    const { rowCount } = await db.query(
      `UPDATE forms
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1
         AND assigned_to = $2
         AND status = 'pending'`,
      [id, supervisorId],
    );

    if (!rowCount)
      return res
        .status(404)
        .json({ message: "Form not found or not pending." });

    res.json({ message: "Form rejected." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── JOBS (TRACKING) ─────────────────────────────────────────────────────────

router.get("/jobs/awaiting-verification", async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const { rows } = await db.query(
      `SELECT
         t.id          AS tracking_id,
         t.form_id,
         f.title       AS form_title,
         f.client_name,
         f.company_name,
         u.name        AS worker_name,
         t.status      AS tracking_status,
         t.started_at,
         t.ended_at
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       JOIN users u  ON u.id = t.worker_id
       WHERE t.status = 'completed'
         AND (f.created_by = $1 OR f.assigned_to = $1)
       ORDER BY t.ended_at DESC`,
      [supervisorId],
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/jobs", async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const { rows } = await db.query(
      `SELECT
         t.id          AS tracking_id,
         t.form_id,
         t.status      AS tracking_status,
         t.started_at,
         t.latitude,
         t.longitude,
         f.title,
         f.client_name,
         f.company_name,
         f.priority_level,
         u.name        AS worker_name
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       JOIN users u  ON u.id = t.worker_id
       WHERE t.status = 'ongoing'
         AND (f.created_by = $1 OR f.assigned_to = $1)
       ORDER BY t.started_at DESC`,
      [supervisorId],
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
router.get("/jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    const { rows } = await db.query(
      `SELECT
         t.id          AS tracking_id,
         t.form_id,
         f.title       AS form_title,
         f.client_name,
         f.company_name,
         f.status      AS form_status,
         f.priority_level,
         f.date_from,
         f.date_to,
         f.duration,
         f.description,
         f.comment,
         u.name        AS worker_name,
         t.status      AS tracking_status,
         t.latitude,
         t.longitude,
         t.started_at,
         t.ended_at,
         t.updated_at,
         t.signature_url
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       JOIN users u  ON u.id = t.worker_id
       WHERE t.id = $1
         AND (f.created_by = $2 OR f.assigned_to = $2)`,
      [id, supervisorId],
    );
    const { rows: answers } = await db.query(
      `SELECT field_key, field_value FROM tracking_answers WHERE tracking_id = $1`,
      [job.tracking_id], // or req.params.id
    );
    job.survey_answers = answers;

    if (!rows.length) {
      return res.status(404).json({ message: "Job not found" });
    }

    const job = rows[0];

    const { rows: photos } = await db.query(
      `SELECT id, file_url
       FROM attachments
       WHERE form_id = $1 AND type = 'tracking_doc'`,
      [job.form_id],
    );
    job.photos = photos;

    res.json(job);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/jobs/:id/verify", async (req, res) => {
  const client = await db.connect();
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT t.id, t.form_id, t.status
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       WHERE t.id = $1 AND (f.created_by = $2 OR f.assigned_to = $2)`, // ← fix here
      [id, supervisorId],
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Job not found." });
    }

    const job = rows[0];

    if (job.status !== "completed") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Job must be completed before verifying." });
    }

    await client.query(
      "UPDATE tracking SET status = 'verified', updated_at = NOW() WHERE id = $1",
      [id],
    );

    await client.query(
      `UPDATE forms SET status = 'completed', updated_at = NOW()
       WHERE id = $1 AND status != 'completed'`,
      [job.form_id],
    );

    await client.query("COMMIT");

    res.json({ message: "Job verified." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
