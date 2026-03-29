const { requireAuth } = require("./middleware/requireAuth");
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { pool } = require("./lib/db");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/engineer", requireAuth, require("./routes/engineer"));
app.use("/api/supervisor", requireAuth, require("./routes/supervisor"));
app.use("/api/admin", requireAuth, require("./routes/admin"));

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Unauthorized"));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  socket.on("join_job", (trackingId) => {
    socket.join(`job_${trackingId}`);
  });

  socket.on("location_update", async ({ trackingId, latitude, longitude }) => {
    if (!trackingId || latitude == null || longitude == null) return;
    try {
      await pool.query(
        `UPDATE tracking SET latitude = $1, longitude = $2, updated_at = NOW()
         WHERE id = $3 AND worker_id = $4 AND status = 'ongoing'`,
        [latitude, longitude, trackingId, socket.user.id],
      );
      io.to(`job_${trackingId}`).emit("location_broadcast", {
        trackingId,
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("location_update error:", err);
    }
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
