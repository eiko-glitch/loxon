const { betterAuth } = require("better-auth");
const { pool } = require("./db");

const auth = betterAuth({
  database: {
    db: pool,
    type: "pg",
  },
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "member",
      },
      status: {
        type: "string",
        required: true,
        defaultValue: "active",
      },
      team_id: {
        type: "string",
        required: false,
      },
    },
  },
});

module.exports = { auth };
