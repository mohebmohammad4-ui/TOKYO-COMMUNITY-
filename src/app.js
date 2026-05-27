import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,                        
        GatewayIntentBits.GuildMembers,                 
        GatewayIntentBits.GuildMessages,                
        GatewayIntentBits.GuildMessageReactions,        
        GatewayIntentBits.MessageContent,               
        GatewayIntentBits.GuildVoiceStates,             
        GatewayIntentBits.GuildBans,                    
      ],
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;
    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      startupLog('Initializing database...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;
      
      const dbStatus = this.db.getStatus();
      if (dbStatus.isDegraded) {
        logger.warn('');
        logger.warn('╔═══════════════════════════════════════════════════════╗');
        logger.warn('║ ⚠️  DATABASE RUNNING IN DEGRADED MODE                 ║');
        logger.warn('║                                                       ║');
        logger.warn('║ Connection: In-Memory Storage (PostgreSQL unavailable)║');
        logger.warn('║ Data Persistence: DISABLED - data lost on restart    ║');
        logger.warn('║ Action Required: Fix PostgreSQL and restart bot      ║');
        logger.warn('╚═══════════════════════════════════════════════════════╝');
        logger.warn('');
      } else {
        startupLog(`✅ Database Status: ${dbStatus.connectionType} (fully operational)`);
      }
      
      startupLog('Starting web server...');
      this.startWebServer();
      
      startupLog('Loading commands...');
      await loadCommands(this);
      startupLog(`Commands loaded: ${this.commands.size}`);
      
      startupLog('Loading handlers...');
      await this.loadHandlers();
      startupLog('Handlers loaded');
      
      startupLog('Logging into Discord...');

      // حدث تشغيل البوت وإرسال الـ Embed مع الأزرار الجديدة
      this.once('ready', async () => {
        console.log('BOT READY');

        const channel = this.channels.cache.get('1493323975068090561');

        if (!channel) return console.log('❌ Channel not found');

        try {
          await channel.send({
            embeds: [
                {
                    color: 0x8B0000,
                    title: '『 TOKYO COMMUNITY 』',
                    description: `# اهلاً بك في Tokyo Community 🌸\n\nاضغط على الأزرار بالأسفل لمعرفة معلومات السيرفر.`,
                    image: {
                        url: 'https://cdn.discordapp.com/attachments/1493320568660033590/1507819135646830672/tokyo.png?ex=6a173dff&is=6a15ec7f&hm=65322f65e3392fbd444f62bc2a5597ff9025a9e039af366cd2570de54609892f&'
                    },
                    footer: {
                        text: 'Tokyo Community'
                    },
                    timestamp: new Date()
                }
            ],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            label: 'القوانين',
                            style: 2,
                            custom_id: 'rules',
                            emoji: { name: '📜' }
                        },
                        {
                            type: 2,
                            label: 'من نحن',
                            style: 2,
                            custom_id: 'about',
                            emoji: { name: '🌸' }
                        }
                    ]
                },
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            label: 'البوست',
                            style: 4,
                            custom_id: 'boost',
                            emoji: { name: '💎' }
                        },
                        {
                            type: 2,
                            label: 'الرتب',
                            style: 1,
                            custom_id: 'roles',
                            emoji: { name: '🎴' }
                        }
                    ]
                }
            ]
          });
          
          console.log('✅ Embed and Buttons Sent Successfully!');
        } catch (err) {
          console.error('❌ Error sending Embed with Buttons:', err);
        }
      });

      // تسجيل الدخول
      await this.login(this.config.bot.token);
      startupLog('Discord login successful');

      startupLog('Registering slash commands...');
      await this.registerCommands();
      startupLog('Slash commands registration complete');
      
      const databaseMode = dbStatus.isDegraded
        ? 'Optional in-memory mode (data resets after restart)'
        : 'Connected (persistent data enabled)';
      const handlerSummary = `${this.buttons.size} buttons, ${this.selectMenus.size} menus, ${this.modals.size} modals`;
      startupLog(
        `ONLINE ✅ | ${this.commands.size} commands loaded | ${handlerSummary} | Database: ${databaseMode}`
      );
      
      this.setupCronJobs();
    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    const configuredPort = Number(this.config.api?.port || process.env.PORT || 3000);
    const maxPortRetryAttempts = Number(process.env.PORT_RETRY_ATTEMPTS || 5);
    const host = process.env.WEB_HOST || '0.0.0.0';
    const corsOrigin = this.config.api?.cors?.origin || '*';
    
    app.use((req, res, next) => {
      const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
      const origin = req.headers.origin;
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
      }
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    const requestCounts = new Map();
    const windowMs = 60000; 
    const maxRequests = this.config.api?.rateLimit?.max || 100;
    
    app.use((req, res, next) => {
      const ip = req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;
      
      if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
      }
      
      const times = requestCounts.get(ip).filter(t => t > windowStart);
      
      if (times.length >= maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      
      times.push(now);
      requestCounts.set(ip, times);
      next();
    });

    app.get('/health', (req, res) => {
      const dbStatus = this.db?.getStatus?.() || { isDegraded: 'unknown' };
      const status = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: {
          connected: dbStatus.connectionType !== 'none',
          degraded: dbStatus.isDegraded,
          type: dbStatus.connectionType
        }
      };
      res.status(200).json(status);
    });

    app.get('/ready', (req, res) => {
      const dbStatus = this.db?.getStatus?.() || { isDegraded: true };
      const isReady = this.isReady() && !dbStatus.isDegraded;

      if (isReady) {
        return res.status(200).json({
          ready: true,
          message: 'Bot is ready'
        });
      }

      res.status(503).json({
        ready: false,
        reason: !this.isReady() ? 'Bot not Ready' : 'Database degraded'
      });
    });

    app.get('/', (req, res) => {
      res.status(200).json({ 
        message: 'TitanBot System Online',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      });
    });

    const startServer = (port, attempt = 0) => {
      let hasStartedListening = false;
      const server = app.listen(port, host, () => {
        hasStartedListening = true;
        this.webServer = server;
        startupLog(`✅ Web Server running on ${host}:${port}`);
      });

      server.on('error', (error) => {
        const errorCode = error?.code || 'UNKNOWN_ERROR';
        const errorMessage = error?.message || 'Unknown server error';

        if (!hasStartedListening && errorCode === 'EADDRINUSE' && attempt < maxPortRetryAttempts) {
          const nextPort = port + 1;
          startupLog(`Port ${port} is already in use. Trying port ${nextPort}...`);
          setTimeout(() => startServer(nextPort, attempt + 1), 250);
          return;
        }

        if (hasStartedListening && errorCode === 'EADDRINUSE') {
          logger.warn(`Web server reported a duplicate bind warning on ${host}:${port}, but the bot remains online.`);
          return;
        }

        logger.error(`❌ Web server error on port ${port} (${errorCode}): ${errorMessage}`);

        if (!hasStartedListening) {
          process.exit(1);
        }
      });
    };

    startServer(configuredPort, 0);
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    cron.schedule('* * * * *', () => checkGiveaways(this));
    cron.schedule('*/15 * * * *', () => this.updateAllCounters());
  }

  async updateAllCounters() {
    if (!this.db) return;
    for (const [guildId, guild] of this.guilds.cache) {
      try {
        const counters = await getServerCounters(this, guildId);
        const validCounters = [];
        for (const counter of counters) {
          if (counter && counter.type && counter.channelId && counter.enabled !== false) {
            const channel = guild.channels.cache.get(counter.channelId);
            if (channel) {
              validCounters.push(counter);
              await updateCounter(this, guild, counter);
            }
          }
        }
        await saveServerCounters(this, guildId, validCounters);
      } catch (error) {
        logger.error(`Error updating counters:`, error);
      }
    }
  }

  async loadHandlers() {
    const handlers = [
      { path: 'events', type: 'default', required: true },
      { path: 'interactions', type: 'default', required: true }
    ];

    for (const handler of handlers) {
      try {
        const module = await import(`./handlers/${handler.path}.js`);
        const loaderFn = module.default;
        if (typeof loaderFn === 'function') {
          await loaderFn(this);
          logger.info(`✅ Loaded ${handler.path}`);
        }
      } catch (error) {
        if (handler.required) throw error;
      }
    }
  }

  async registerCommands() {
    try {
      await registerSlashCommands(this, this.config.bot.guildId);
    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  }

  async shutdown(reason = 'UNKNOWN') {
    try {
      cron.getTasks().forEach(task => task.stop());
      if (this.db && this.db.db && this.db.db.pool) {
        await this.db.db.pool.end();
      }
      if (this.isReady()) this.destroy();
      process.exit(0);
    } catch (error) {
      process.exit(1);
    }
  }
}

// تشغيل البوت وتفعيل استقبال ضغطات الأزرار
const bot = new TitanBot();

const setupShutdown = () => {
  process.on('SIGTERM', () => bot.shutdown('SIGTERM'));
  process.on('SIGINT', () => bot.shutdown('SIGINT'));
  process.on('uncaughtException', (error) => bot.shutdown('UNCAUGHT_EXCEPTION'));
  process.on('unhandledRejection', () => bot.shutdown('UNHANDLED_REJECTION'));
};

setupShutdown();

// استقبال التفاعل مع الأزرار وإرسال القوانين وباقي الرسايل مخفية (ephemeral)
bot.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'rules') {
        await interaction.reply({
            ephemeral: true,
            embeds: [{
                color: 0x8B0000,
                title: '📜 قوانين السيرفر',
                description: `# قوانين TOKYO COMMUNITY\n* ممنوع السب الا في حالة المزاح\n* يُمنع منعا باتاً التحرش بجميع أنواعه\n* ممنوع ذكر الشواذ\n* ممنوع التحدث في الدين\n* ممنوع الترويج بكل أشكاله\n* ممنوع نشر/ارسال اي شيء إباحي/جنسي\n* ممنوع العنصرية إلا في حالة المزاح\n* ممنوع الاهانة\n* ممنوع السبام\n* ممنوع إزعاج اي شخص بالمنشن أو غيره`
            }]
        });
    }

    if (interaction.customId === 'about') {
        await interaction.reply({
            ephemeral: true,
            embeds: [{
                color: 0x8B0000,
                title: '🌸 من نحن',
                description: `Tokyo Community مجتمع للأنمي والجيمنج والتفاعل ✨`
            }]
        });
    }

    if (interaction.customId === 'boost') {
        await interaction.reply({
            ephemeral: true,
            embeds: [{
                color: 0x8B0000,
                title: '💎 مميزات البوست',
                description: `• رول خاص\n• لون مميز\n• صلاحيات إضافية`
            }]
        });
    }

    if (interaction.customId === 'roles') {
        await interaction.reply({
            ephemeral: true,
            embeds: [{
                color: 0x8B0000,
                title: '🎏 الرتب الخاصة',
                description: `يمكنك الحصول على رتب مميزة داخل السيرفر`
            }]
        });
    }
});

bot.start();

export default TitanBot;
