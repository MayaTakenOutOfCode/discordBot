// Import necessary packages
require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require('discord.js');

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Event triggered when the bot is ready
client.once('ready', () => {
    console.log('I am ready!');
});

// Log in to Discord with the token from the .env file
client.login(process.env.DISCORD_TOKEN);
