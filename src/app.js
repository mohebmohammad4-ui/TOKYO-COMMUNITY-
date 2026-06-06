import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';
import mongoose from 'mongoose'; 

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';

// ================== DEFINING THE MONGOOSE SCHEMA (تم التحديث الشامل للتحكم الكامل) ==================
const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  autoReplies: [{ trigger: String, response: String }],
  levelingSystem: {
    enabled: { type: Boolean, default: true },
    xpRate: { type: Number, default: 1 },
    announcementChannel: { type: String, default: null },
    levelRoles: [{ level: Number, roleId: String }]
  },
  commandShortcuts: [{ commandName: String, shortcut: String }],
  
  // [ميزات تحكم ديناميكية مضافة حديثاً]:
  disabledCommands: [{ type: String }], // الأوامر المعطلة بالسيرفر
  commandPermissions: [{ commandName: String, allowedRoles: [String] }], // رتب محددة لكل أمر
  
  imageOnlyChannels: {
    enabled: { type: Boolean, default: true },
    channels: { type: [String], default: ['1493324135785562222', '1493324237249970176'] }, // غرف الصور المسموحة
    bannerUrl: { type: String, default: 'https://cdn.discordapp.com/attachments/1486414234349993985/1510019036602433546/8000_x_700.png?ex=6a1b4a51&is=6a19f8d1&hm=f093309a1286bc5c4f4151895c87a246fefdd3ecf27b85b83151d75c8fd6bd23&' }
  },
  
  embedButtonsData: {
    rulesText: { type: String, default: '# قوانين TOKYO COMMUNITY\n* ممنوع السب الا في حالة المزاح\n* يُمنع منعا باتاً التحرش بجميع أنواعه\n* ممنوع ذكر الشواذ\n* ممنوع التحدث في الدين\n* ممنوع الترويج بكل أشكاله\n* ممنوع نشر/ارسال اي شيء إباحي/جنسي\n* ممنوع العنصرية إلا في حالة المزاح\n* ممنوع الاهانة\n* ممنوع السبام\n* ممنوع إزعاج اي شخص بالمنشن أو غيره' },
    aboutText: { type: String, default: '**سيرفر طوكيو !** هو سيرفر عربي مميز يجمع الاولاد و البنات ! 🌸\n\nنوفر لك:\n• بيئة آمنة ومريحة\n• أعضاء رائعين ومحترمين\n• محتوى انمي والعاب\n\nانضم لعائلتنا وكن جزءاً من المجتمع! ✨' },
    boostText: { type: String, default: '• رول خاص ولون مميز\n• 5 لفلات إضافية\n• صلاحيات إضافية\n• وعندما تضع البوست تحصل على رتبة <@&1505179614828302446>' },
    rolesText: { type: String, default: '• رول خاص ولون مميز\n• 5 لفلات إضافية\n• صلاحيات إضافية' }
  }
});

const MemberLevelSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 0 }
});
MemberLevelSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const Guild = mongoose.models.GuildConfig || mongoose.model("GuildConfig", GuildConfigSchema);
const MemberLevel = mongoose.models.MemberLevel || mongoose.model("MemberLevel", MemberLevelSchema);

const xpCooldowns = new Collection();

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
      
      if (process.env.MONGO_URI) {
        startupLog('Connecting to MongoAtlas...');
        await mongoose.connect(process.env.MONGO_URI);
        startupLog('⚙️ Tokyo Bot successfully linked to MongoAtlas Database!');
      } else {
        logger.warn('⚠️ MONGO_URI missing in Bot env! Auto-replies won\'t load.');
      }
      
      const dbStatus = this.db.getStatus();
      if (dbStatus.isDegraded) {
        logger.warn('⚠️ DATABASE RUNNING IN DEGRADED MODE');
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

      this.once('ready', async () => {
        console.log('BOT READY');
        // هنا يمكن لاحقاً استدعاء إرسال رسالة الترحيب عند الحاجة
      });

      await this.login(this.config.bot.token);
      startupLog('Discord login successful');

      startupLog('Registering slash commands...');
      await this.handleRegisterCommands(); 
      startupLog('Slash commands registration complete');
      
      this.setupCronJobs();
    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    const configuredPort = Number(this.config.api?.port || process.env.PORT || 3000);
    const host = process.env.WEB_HOST || '0.0.0.0';
    const corsOrigin = this.config.api?.cors?.origin || '*';
    
    app.use(express.json());
    app.use((req, res, next) => {
      const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
      const origin = req.headers.origin;
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
      }
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    // الـ APIs لنقل البيانات حركياً إلى الداش بورد
    app.get('/api/bot-commands', (req, res) => {
      const commandList = this.commands.map(cmd => ({
        name: cmd.name,
        description: cmd.description || 'لا يوجد وصف متاح'
      }));
      res.json(commandList);
    });

    app.get('/api/server-roles', async (req, res) => {
      try {
        const guildId = this.config.bot?.guildId || process.env.GUILD_ID;
        const guild = this.guilds.cache.first() || this.guilds.cache.get(guildId);
        if (!guild) return res.json([]);
        const roles = guild.roles.cache
          .filter(r => r.name !== '@everyone' && !r.managed)
          .map(r => ({ id: r.id, name: r.name }));
        res.json(roles);
      } catch (err) { res.json([]); }
    });

    app.get('/', (req, res) => { res.status(200).json({ message: 'TitanBot Online' }); });

    app.listen(configuredPort, host, () => {
      startupLog(`✅ Web Server running on ${host}:${configuredPort}`);
    });
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    cron.schedule('* * * * *', () => checkGiveaways(this));
    cron.schedule('*/15 * * * *', () => this.updateAllCounters());
  }

  async updateAllCounters() { /* كود العدادات الأصلي كما هو */ }
  async loadHandlers() { /* كود الهاندلرز الأصلي كما هو */ }
  async handleRegisterCommands() { /* كود السلاش كوماندز الأصلي */ }
  async shutdown() { process.exit(0); }
}

const bot = new TitanBot();

// ================== MESSAGE EVENTS, AUTOREPLY, DYNAMIC LEVELING & CHANNELS ==================
bot.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  if (mongoose.connection.readyState === 1) {
    try {
      // سحب إعدادات السيرفر الحالي من السكيما المطورة
      let data = await Guild.findOne({ guildId: message.guild.id });
      if (!data) {
        data = await Guild.create({ guildId: message.guild.id });
      }

      // 1. نظام غرف الصور التلقائي المتغير من الداش بورد
      if (data.imageOnlyChannels && data.imageOnlyChannels.enabled) {
        if (data.imageOnlyChannels.channels.includes(message.channel.id)) {
          const hasImage = message.attachments.some(attachment =>
            attachment.contentType?.startsWith('image/')
          );

          if (!hasImage) {
            await message.delete().catch(() => {});
            await message.author.send({ content: '❌ لا يمكن سوى ارسال صور فقط في هذا الشات.' }).catch(() => {});
            return; 
          }

          if (data.imageOnlyChannels.bannerUrl) {
            await message.channel.send({ files: [data.imageOnlyChannels.bannerUrl] }).catch(() => {});
          }
        }
      }

      // 2. نظام الـ XP والمستويات الذكي والمكافآت
      if (data.levelingSystem && data.levelingSystem.enabled) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();
        const cooldownTime = 60000;
        
        const userCooldownKey = `${guildId}-${userId}`;
        const lastXpTime = xpCooldowns.get(userCooldownKey) || 0;

        if (now - lastXpTime > cooldownTime) {
          xpCooldowns.set(userCooldownKey, now);

          const minXp = 15; const maxXp = 25;
          const baseRandomXp = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;
          const xpToAdd = Math.floor(baseRandomXp * (data.levelingSystem.xpRate || 1));

          let memberData = await MemberLevel.findOne({ guildId, userId });
          if (!memberData) memberData = new MemberLevel({ guildId, userId, xp: 0, level: 0 });

          memberData.xp += xpToAdd;
          const xpNeededForNextLevel = (memberData.level * 100) + 100;

          if (memberData.xp >= xpNeededForNextLevel) {
            memberData.xp -= xpNeededForNextLevel;
            memberData.level += 1;

            const announceChannelId = data.levelingSystem.announcementChannel || message.channel.id;
            const announceChannel = message.guild.channels.cache.get(announceChannelId);
            if (announceChannel && announceChannel.isTextBased()) {
              announceChannel.send(`✨ مبروك يا <@${userId}>! صعدت إلى المستوى **${memberData.level}** 🎉`).catch(() => {});
            }

            if (data.levelingSystem.levelRoles && data.levelingSystem.levelRoles.length > 0) {
              const matchedReward = data.levelingSystem.levelRoles.find(r => r.level === memberData.level);
              if (matchedReward) {
                const targetRole = message.guild.roles.cache.get(matchedReward.roleId);
                if (targetRole && message.member) {
                  await message.member.roles.add(targetRole).catch(() => {});
                }
              }
            }
          }
          await memberData.save();
        }
      }

      // 3. نظام الردود التلقائية الذكي
      if (data.autoReplies) {
        const reply = data.autoReplies.find(r => r.trigger.trim().toLowerCase() === message.content.trim().toLowerCase());
        if (reply) await message.reply(reply.response);
      }

    } catch (err) { console.error("Error in messageCreate handling:", err); }
  }
});

// ================== EMBED BUTTONS INTERACTION (التحكم بنصوص الأزرار من قاعدة البيانات) ==================


    try {
      const data = await Guild.findOne({ guildId: interaction.guild.id });
      const texts = data?.embedButtonsData || {};

      if (interaction.customId === 'rules') {
          await interaction.reply({
              ephemeral: true,
              embeds: [{
                  color: 0x8B0000,
                  title: '📜 قوانين السيرفر',
                  description: texts.rulesText || '# القوانين الافتراضية'
              }]
          });
      }

      if (interaction.customId === 'about') {
          await interaction.reply({
              ephemeral: true,
              embeds: [{
                  color: 0x8B0000,
                  title: '🌸 من نحن',
                  description: texts.aboutText || 'سيرفر طوكيو الترحيبي.'
              }]
          });
      }

      if (interaction.customId === 'boost') {
          await interaction.reply({
              ephemeral: true,
              embeds: [{
                  color: 0x8B0000,
                  title: '💎 مميزات البوست',
                  description: texts.boostText || 'ميزات الدعم والبوست.'
              }]
          });
      }

      if (interaction.customId === 'roles') {
          await interaction.reply({
              ephemeral: true,
              embeds: [{
                  color: 0x8B0000,
                  title: '🎏 الرتب الخاصة',
                  description: texts.rolesText || 'قائمة الرتب المتاحة.'
              }]
          });
      }
    } catch (err) { console.error(err); }});

bot.start();
export default TitanBot;
