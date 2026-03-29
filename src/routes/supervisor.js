const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { requireRole } = require("../middleware/requireAuth");

// All routes here already have requireAuth applied at index.js level.
// Additionally gate to supervisor only:
router.use(requireRole("supervisor"));

// ─── MEMBERS ────────────────────────────────────────────────────────────────

/**
 * GET /api/supervisor/members
 * Returns engineers (role=engineer) that belong to the same team as the supervisor,
 * or all engineers if the supervisor has no team.
 */
router.get("/members", async (req, res) => {
  try {
    const supervisorId = req.user.id;

    // Get supervisor's team
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

/**
 * GET /api/supervisor/forms/pending
 * Returns all pending forms that this supervisor created or that belong to their team's members.
 */
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
/**
 * GET /api/supervisor/forms/:id
 * Returns full form detail including attachments and linked tracking_id.
 */
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
/**
 * POST /api/supervisor/forms
 * Create a new form and assign to a member.
 * Body: { title, description, client_name, company_name, priority_level,
 *         date_from, date_to, duration, assigned_to, comment }
 */
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

    // Validate assigned_to is an engineer
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

/**
 * PATCH /api/supervisor/forms/:id/accept
 * Supervisor accepts a pending form → status becomes 'accepted'.
 */
router.patch("/forms/:id/accept", async (req, res) => {
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    const { rowCount } = await db.query(
      `UPDATE forms
       SET status = 'accepted', updated_at = NOW()
       WHERE id = $1 
         AND assigned_to = $2 
         AND status = 'pending'`,
      [id, supervisorId],
    );

    if (!rowCount)
      return res
        .status(404)
        .json({ message: "Form not found or not pending." });

    res.json({ message: "Form accepted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/supervisor/forms/:id/reject
 * Supervisor rejects a pending form → status becomes 'rejected'.
 */
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

/**
 * GET /api/supervisor/jobs/awaiting-verification
 * Returns tracking rows with status='completed' where the form was created by this supervisor.
 */
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
         AND f.created_by = $1
       ORDER BY t.ended_at DESC`,
      [supervisorId],
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/supervisor/jobs/:id
 * Returns full job (tracking) detail including photos and signature.
 */
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
         AND f.created_by = $2`,
      [id, supervisorId],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Job not found" });
    }

    const job = rows[0];

    // Photos (tracking_doc attachments)
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

/**
 * PATCH /api/supervisor/jobs/:id/verify
 * Supervisor verifies a completed job → tracking.status = 'verified'.
 * Also sets form.status = 'completed' if not already.
 */
router.patch("/jobs/:id/verify", async (req, res) => {
  const client = await db.connect();
  try {
    const { id } = req.params;
    const supervisorId = req.user.id;

    await client.query("BEGIN");

    // Check job belongs to a form this supervisor owns
    const { rows } = await client.query(
      `SELECT t.id, t.form_id, t.status
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       WHERE t.id = $1 AND f.created_by = $2`,
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

    // Update tracking to verified
    await client.query(
      "UPDATE tracking SET status = 'verified', updated_at = NOW() WHERE id = $1",
      [id],
    );

    // Update form to completed if not already
    await client.query(
      `UPDATE forms
       SET status = 'completed', updated_at = NOW()
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
