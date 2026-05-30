import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';
import mongoose from 'mongoose'; 

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { logger, startupLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';

// Schema
const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  autoReplies: [{ trigger: String, response: String }],
  levelingSystem: {
    enabled: { type: Boolean, default: true },
    xpRate: { type: Number, default: 1 },
    announcementChannel: { type: String, default: null }
  }
});

const Guild = mongoose.models.GuildConfig || mongoose.model("GuildConfig", GuildConfigSchema);

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent
      ],
    });
    this.config = config;
    this.commands = new Collection();
    this.db = null;
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      if (process.env.MONGO_URI) {
        await mongoose.connect(process.env.MONGO_URI);
        startupLog('⚙️ Database connected!');
      }

      this.startWebServer();
      await loadCommands(this);
      await this.login(this.config.bot.token);
      
      this.once('ready', () => {
        startupLog('BOT READY AND ONLINE ✅');
      });
      
      this.setupCronJobs();
    } catch (error) {
      logger.error('Failed to start:', error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    app.get('/', (req, res) => res.sendStatus(200));
    app.listen(process.env.PORT || 3000, '0.0.0.0');
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    checkGiveaways(this);
  }
}

const bot = new TitanBot();
bot.start();
