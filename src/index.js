const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { toNodeHandler } = require("better-auth/node");
const { auth } = require("./lib/auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Better Auth handles all /api/auth/* routes
app.all("/api/auth/{*path}", toNodeHandler(auth));

app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
