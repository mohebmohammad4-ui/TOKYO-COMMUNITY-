const mongoose = require("mongoose");

const guildSchema = new mongoose.Schema({
  guildId: String,

  autoReplies: [
    {
      trigger: String,
      response: String
    }
  ],

  levels: {
    roles: [
      {
        level: Number,
        roleId: String
      }
    ]
  }
});

module.exports = mongoose.model("Guild", guildSchema);
