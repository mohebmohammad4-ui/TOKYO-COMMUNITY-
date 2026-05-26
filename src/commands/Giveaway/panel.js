import {
    SlashCommandBuilder,
    EmbedBuilder
} from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Tokyo panel'),

    async execute(interaction) {

        const embed = new EmbedBuilder()
            .setColor('#8b0000')
            .setTitle('TOKYO COMMUNITY')
            .setDescription('Panel Works ✅');

        await interaction.reply({
            embeds: [embed]
        });

    },
};
