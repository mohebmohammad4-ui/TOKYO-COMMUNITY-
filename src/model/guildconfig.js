import mongoose from "mongoose";

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

// ✅ التصدير الافتراضي الحديث المتوافق مع ES Modules
const Guild = mongoose.model("Guild", guildSchema);
export default Guild;
