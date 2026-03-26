const { requireAuth } = require("./middleware/requireAuth");
const express = require("express");
const cors = require("cors");
const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", requireAuth, require("./routes/users"));
app.use("/api/teams", requireAuth, require("./routes/teams"));
app.use("/api/supervisor", requireAuth, require("./routes/supervisor"));
// add more routes here as you build
// app.use("/api/forms", requireAuth, require("./routes/forms"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
