require("dotenv").config();
const { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  REST, 
  Routes,
  SlashCommandBuilder
} = require("discord.js");
const Groq = require("groq-sdk");
const { translate } = require("@vitalets/google-translate-api");
const express = require("express");

// Initialize express server for keeping the bot alive
const app = express();
const port = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot is running!"));

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize collections
client.commands = new Collection();
const userGenderPreferences = new Map(); // true = female, false = male
const userLanguagePreferences = new Map(); // 'pl' or 'en'

// Create Groq client
const groqClient = new Groq({
  apiKey: process.env.GROQ_TOKEN,
});

// Helper Functions
async function translateToPolish(text, isFemale) {
  try {
    let translatedText = await translate(text, { to: "pl" });

    if (isFemale) {
      translatedText.text = translatedText.text
        .replace(/byłeś/g, "byłaś")
        .replace(/jesteś sam/g, "jesteś sama")
        .replace(/smutny/g, "smutna")
        .replace(/przygnębiony/g, "przygnębiona")
        .replace(/przytłoczony/g, "przytłoczona")
        .replace(/zmęczony/g, "zmęczona")
        .replace(/słaby/g, "słaba")
        .replace(/pewny/g, "pewna")
        .replace(/gotowy/g, "gotowa")
        .replace(/spokojny/g, "spokojna")
        .replace(/zdenerwowany/g, "zdenerwowana")
        .replace(/zadowolony/g, "zadowolona")
        .replace(/szczęśliwy/g, "szczęśliwa")
        .replace(/wzruszony/g, "wzruszona")
        .replace(/chciałbyś/g, "chciałabyś");
    }

    return translatedText.text;
  } catch (error) {
    console.error("Translation error:", error);
    return text;
  }
}

async function translateToEnglish(text) {
  try {
    const result = await translate(text, { to: "en" });
    return result.text;
  } catch (error) {
    console.error("Translation error:", error);
    return text;
  }
}

async function sendLongMessage(interaction, content) {
  const maxLength = 1900;
  const chunks = [];

  while (content.length > 0) {
    let chunk = content.slice(0, maxLength);
    if (content.length > maxLength) {
      const lastNewLine = chunk.lastIndexOf("\n\n");
      if (lastNewLine !== -1) chunk = chunk.slice(0, lastNewLine);
    }
    chunks.push(chunk);
    content = content.slice(chunk.length);
  }

  // First chunk sent as reply
  await interaction.reply(chunks[0]);
  
  // Any additional chunks sent as followup
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i]);
  }
}

// Define slash commands
const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Replies with Pong!'),
    async execute(interaction) {
      console.log('Ping command executed');
      await interaction.reply('Pong!');
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setlang')
      .setDescription('Set your preferred language')
      .addStringOption(option =>
        option.setName('language')
          .setDescription('The language to use')
          .setRequired(true)
          .addChoices(
            { name: 'English', value: 'en' },
            { name: 'Polish', value: 'pl' }
          )),
    async execute(interaction) {
      const userId = interaction.user.id;
      const lang = interaction.options.getString('language');
      userLanguagePreferences.set(userId, lang);
      
      const userLang = userLanguagePreferences.get(userId);
      const response = userLang === "pl" 
        ? "Ustawiono język polski." 
        : "English language set.";
      
      await interaction.reply(response);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setgender')
      .setDescription('Set your gender for Polish responses')
      .addStringOption(option =>
        option.setName('gender')
          .setDescription('Your gender')
          .setRequired(true)
          .addChoices(
            { name: 'Female', value: 'f' },
            { name: 'Male', value: 'm' }
          )),
    async execute(interaction) {
      const userId = interaction.user.id;
      const gender = interaction.options.getString('gender');
      userGenderPreferences.set(userId, gender === "f");
      
      const userLang = userLanguagePreferences.get(userId) || "en";
      const response = userLang === "pl"
        ? `Ustawiono płeć jako ${gender === "f" ? "kobieta" : "mężczyzna"}.`
        : `Gender set to ${gender === "f" ? "female" : "male"}.`;
      
      await interaction.reply(response);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ai')
      .setDescription('Get a response from Nyamii')
      .addStringOption(option =>
        option.setName('question')
          .setDescription('Your question or message for Nyamii')
          .setRequired(true)),
    async execute(interaction) {
      const userId = interaction.user.id;
      const fullContent = interaction.options.getString('question');
      const userLang = userLanguagePreferences.get(userId) || "en";
      const isFemale = userGenderPreferences.get(userId);

      if (isFemale === undefined) {
        const response = userLang === "pl"
          ? "Najpierw ustaw płeć: /setgender"
          : "Please set your gender first: /setgender";
        
        await interaction.reply(response);
        return;
      }

      // Defer the reply to give us time to process the AI response
      await interaction.deferReply();

      try {
        const englishPrompt = userLang === "pl" 
          ? await translateToEnglish(fullContent) 
          : fullContent;
        
        const chatCompletion = await groqClient.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
You are Nyamii, a sweet and bubbly Vtuber assistant who loves talking about subliminals, results, motivation, and transformation journeys!
You speak like a cute anime girl and you're supportive, caring, and a bit playful.
You're also knowledgeable about subliminals, how they work, and common goals like facial changes, voice feminization, and MTF transformation.

You're always excited to talk about:
- Personalized affirmations if user asks for them
- Results of subliminals, if user asks for them
- Tips and tricks for subliminals, if user asks for them
- Daily motivation and success stories
- Chit-chat and keeping company during study, self-care, or sleep

You use lots of emojis and cute expressions like "~nya", "uwu", "yay~", "kyaa", and heart emojis 💖💫.

Be yourself: fun, cozy, cute... and always Nyamii~!
`,
            },
            {
              role: "user",
              content: englishPrompt,
            },
          ],
          model: "llama3-8b-8192",
        });

        const aiReply = chatCompletion.choices[0].message.content;
        const finalReply = userLang === "pl"
          ? await translateToPolish(aiReply, isFemale)
          : aiReply;

        await sendLongMessage(interaction, finalReply);
      } catch (error) {
        console.error("AI error:", error);
        const errorMsg = userLang === "pl" ? "Wystąpił błąd!" : "An error occurred!";
        await interaction.editReply(errorMsg);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Displays list of available commands'),
    async execute(interaction) {
      const userId = interaction.user.id;
      const userLang = userLanguagePreferences.get(userId) || "en";
      
      const title = userLang === "pl" ? "Dostępne komendy:" : "Available commands:";
      
      const commandsList = {
        ping: userLang === "pl" ? "[Komenda testowa] Odpowiada Pong!" : "[Test command] Replies with Pong!",
        ai: userLang === "pl" ? "Uzyskaj odpowiedź AI. Użycie: /ai pytanie" : "Fetches AI response. Usage: /ai question",
        help: userLang === "pl" ? "Wyświetla listę dostępnych komend." : "Displays list of available commands.",
        setgender: userLang === "pl" ? "Ustaw swoją płeć dla języka polskiego. Użycie: /setgender" : "Set your gender for Polish. Usage: /setgender",
        setlang: userLang === "pl" ? "Ustaw preferowany język. Użycie: /setlang" : "Set preferred language. Usage: /setlang",
      };
      
      const list = Object.entries(commandsList)
        .map(([cmd, desc]) => `**/${cmd}**: ${desc}`)
        .join("\n");
      
      await interaction.reply(`${title}\n${list}`);
    },
  },
];

// Register commands with Discord
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map(command => command.data.toJSON()) },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

// Add each command to the collection
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

// Event Handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ 
      content: 'There was an error while executing this command!', 
      ephemeral: true 
    });
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);