// routes/engineer.js
const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { requireRole } = require("../middleware/requireAuth");

router.use(requireRole("engineer"));

// ─── FORMS ───────────────────────────────────────────────────────────────────

/**
 * GET /api/engineer/forms/assigned
 * Section 1: forms assigned to me by supervisor (pending)
 */

router.get("/supervisors", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name FROM users u
       JOIN users me ON me.team_id = u.team_id
       WHERE me.id = $1
         AND u.role = 'supervisor'
         AND u.status != 'inactive'
       ORDER BY u.name`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/forms/assigned", async (req, res) => {
  try {
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
         u.name AS created_by_name
       FROM forms f
       JOIN users u ON u.id = f.created_by
       WHERE f.assigned_to = $1
         AND f.status = 'pending'
         AND f.created_by != $1
       ORDER BY
         CASE f.priority_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         f.created_at DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/engineer/forms/mine
 * Section 2: self-requested forms (created_by = me)
 */
router.get("/forms/mine", async (req, res) => {
  try {
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
       WHERE f.created_by = $1
       ORDER BY f.created_at DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/engineer/forms/:id
 * Full form detail
 */
router.get("/forms/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         f.*,
         creator.name  AS created_by_name,
         assignee.name AS assigned_to_name
       FROM forms f
       JOIN users creator  ON creator.id  = f.created_by
       JOIN users assignee ON assignee.id = f.assigned_to
       WHERE f.id = $1
         AND (f.assigned_to = $2 OR f.created_by = $2)`,
      [req.params.id, req.user.id],
    );

    if (!rows.length)
      return res.status(404).json({ message: "Form not found" });

    const form = rows[0];

    const { rows: attachments } = await db.query(
      "SELECT id, type, file_url FROM attachments WHERE form_id = $1",
      [req.params.id],
    );
    form.attachments = attachments;

    const { rows: trackingRows } = await db.query(
      "SELECT id AS tracking_id FROM tracking WHERE form_id = $1 LIMIT 1",
      [req.params.id],
    );
    form.tracking_id = trackingRows[0]?.tracking_id ?? null;

    res.json(form);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/engineer/forms/:id/accept
 * Engineer accepts a form assigned to them
 */
router.patch("/forms/:id/accept", async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE forms
       SET status = 'accepted', updated_at = NOW()
       WHERE id = $1
         AND assigned_to = $2
         AND status = 'pending'`,
      [req.params.id, req.user.id],
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
 * PATCH /api/engineer/forms/:id/reject
 * Engineer rejects a form assigned to them
 */
router.patch("/forms/:id/reject", async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE forms
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1
         AND assigned_to = $2
         AND status = 'pending'`,
      [req.params.id, req.user.id],
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

/**
 * POST /api/engineer/forms
 * Self-request a form → goes to supervisor for review
 */
router.post("/forms", async (req, res) => {
  try {
    const engineerId = req.user.id;
    const {
      title,
      description,
      client_name,
      company_name,
      priority_level = "medium",
      date_from,
      date_to,
      duration,
      comment,
    } = req.body;

    if (!title || !client_name || !company_name || !date_from || !date_to) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    // Find the engineer's supervisor (same team, role = supervisor)
    const { rows: supRows } = await db.query(
      `SELECT u.id FROM users u
       JOIN users me ON me.team_id = u.team_id
       WHERE me.id = $1
         AND u.role = 'supervisor'
         AND u.status != 'inactive'
       LIMIT 1`,
      [engineerId],
    );

    if (!supRows.length) {
      return res
        .status(400)
        .json({ message: "No supervisor found in your team." });
    }

    const supervisorId = supRows[0].id;

    const { rows } = await db.query(
      `INSERT INTO forms
         (created_by, assigned_to, title, description, client_name, company_name,
          priority_level, date_from, date_to, duration, status, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
       RETURNING id`,
      [
        engineerId,
        supervisorId,
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

    res
      .status(201)
      .json({ id: rows[0].id, message: "Form submitted to supervisor." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/engineer/forms/:id
 * Edit and resubmit a rejected self-requested form
 */
router.patch("/forms/:id", async (req, res) => {
  try {
    const {
      title,
      description,
      client_name,
      company_name,
      priority_level,
      date_from,
      date_to,
      duration,
      comment,
    } = req.body;

    const { rowCount } = await db.query(
      `UPDATE forms
       SET
         title          = COALESCE($1, title),
         description    = COALESCE($2, description),
         client_name    = COALESCE($3, client_name),
         company_name   = COALESCE($4, company_name),
         priority_level = COALESCE($5, priority_level),
         date_from      = COALESCE($6, date_from),
         date_to        = COALESCE($7, date_to),
         duration       = COALESCE($8, duration),
         comment        = COALESCE($9, comment),
         status         = 'pending',
         updated_at     = NOW()
       WHERE id = $10
         AND created_by = $11
         AND status = 'rejected'`,
      [
        title,
        description,
        client_name,
        company_name,
        priority_level,
        date_from,
        date_to,
        duration,
        comment,
        req.params.id,
        req.user.id,
      ],
    );

    if (!rowCount)
      return res
        .status(404)
        .json({ message: "Form not found or not editable." });
    res.json({ message: "Form resubmitted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── JOBS (TRACKING) ─────────────────────────────────────────────────────────

/**
 * GET /api/engineer/jobs
 * My active jobs (tracking rows where I am the worker, status = ongoing)
 */
router.get("/jobs", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         t.id          AS tracking_id,
         t.form_id,
         f.title       AS form_title,
         f.client_name,
         f.company_name,
         t.status      AS tracking_status,
         t.started_at,
         t.latitude,
         t.longitude
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       WHERE t.worker_id = $1
         AND t.status = 'ongoing'
       ORDER BY t.started_at DESC`,
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/engineer/jobs/:id
 * Full job detail
 */
router.get("/jobs/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         t.id          AS tracking_id,
         t.form_id,
         f.title       AS form_title,
         f.client_name,
         f.company_name,
         f.status      AS form_status,
         t.status      AS tracking_status,
         t.latitude,
         t.longitude,
         t.started_at,
         t.ended_at,
         t.updated_at,
         t.signature_url
       FROM tracking t
       JOIN forms f ON f.id = t.form_id
       WHERE t.id = $1
         AND t.worker_id = $2`,
      [req.params.id, req.user.id],
    );

    if (!rows.length) return res.status(404).json({ message: "Job not found" });

    const job = rows[0];

    const { rows: photos } = await db.query(
      `SELECT id, file_url FROM attachments
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
 * PATCH /api/engineer/jobs/:id/done
 * Mark job as completed
 */
router.patch("/jobs/:id/done", async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE tracking
       SET status = 'completed', ended_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND worker_id = $2
         AND status = 'ongoing'`,
      [req.params.id, req.user.id],
    );
    if (!rowCount)
      return res.status(404).json({ message: "Job not found or not ongoing." });
    res.json({ message: "Job marked as done." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/engineer/jobs/:id/location
 * Update live GPS location
 */
router.patch("/jobs/:id/location", async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ message: "latitude and longitude required." });
    }
    const { rowCount } = await db.query(
      `UPDATE tracking
       SET latitude = $1, longitude = $2, updated_at = NOW()
       WHERE id = $3
         AND worker_id = $4
         AND status = 'ongoing'`,
      [latitude, longitude, req.params.id, req.user.id],
    );
    if (!rowCount) return res.status(404).json({ message: "Job not found." });
    res.json({ message: "Location updated." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── RECORDS ─────────────────────────────────────────────────────────────────

/**
 * GET /api/engineer/records
 * All my forms filterable by status
 */
router.get("/records", async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT
        f.id,
        f.title,
        f.client_name,
        f.company_name,
        f.priority_level,
        f.status,
        f.date_from,
        f.date_to,
        f.created_at,
        u.name AS created_by_name
      FROM forms f
      JOIN users u ON u.id = f.created_by
      WHERE (f.assigned_to = $1 OR f.created_by = $1)
    `;
    const params = [req.user.id];

    if (status) {
      params.push(status);
      query += ` AND f.status = $${params.length}`;
    }

    query += ` ORDER BY f.created_at DESC`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
