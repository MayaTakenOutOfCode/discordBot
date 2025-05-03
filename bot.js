require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  REST, // Already imported
  Routes,
  SlashCommandBuilder,
  InteractionType // Added for clarity in interactionCreate if needed later
} = require("discord.js");
const Groq = require("groq-sdk");
const { translate } = require("@vitalets/google-translate-api");
const express = require("express");

// --- Environment Variable Check (Good Practice) ---
if (!process.env.DISCORD_TOKEN || !process.env.GROQ_TOKEN || !process.env.CLIENT_ID) {
    console.error("ERROR: Missing required environment variables (DISCORD_TOKEN, GROQ_TOKEN, CLIENT_ID).");
    process.exit(1); // Exit if essential variables are missing
}

// --- Initialize express server for keeping the bot alive ---
const app = express();
const port = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot is running!"));
// Start express server early, independent of bot login
app.listen(port, () => {
    console.log(`Keep-alive server is running on port ${port}`);
});

// --- Create Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // Needed for message-related events if used elsewhere
    GatewayIntentBits.MessageContent, // Privileged Intent - Ensure it's enabled in Dev Portal if needed
  ],
});

// --- Initialize collections ---
client.commands = new Collection();
const userGenderPreferences = new Map(); // true = female, false = male
const userLanguagePreferences = new Map(); // 'pl' or 'en'

// --- Create Groq client ---
const groqClient = new Groq({
  apiKey: process.env.GROQ_TOKEN,
});

// --- Helper Functions (translateToPolish, translateToEnglish, sendLongMessage) ---
// (Your helper functions remain unchanged here)
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
    return text; // Return original text on error
  }
}

async function translateToEnglish(text) {
  try {
    const result = await translate(text, { to: "en" });
    return result.text;
  } catch (error) {
    console.error("Translation error:", error);
    return text; // Return original text on error
  }
}

async function sendLongMessage(interaction, content) {
  const maxLength = 1900; // Reduced slightly for safety margin
  const chunks = [];

  // Ensure content is a string
  let remainingContent = String(content);

  if (!remainingContent) {
      console.warn("sendLongMessage called with empty content.");
      // Send a placeholder if deferred, otherwise try to send a default message
      if (interaction.deferred || interaction.replied) {
           await interaction.editReply({ content: "...", ephemeral: true }).catch(console.error);
      } else {
           await interaction.reply({ content: "...", ephemeral: true }).catch(console.error);
      }
      return;
  }


  while (remainingContent.length > 0) {
    if (remainingContent.length <= maxLength) {
      chunks.push(remainingContent);
      remainingContent = "";
    } else {
      let chunkEnd = maxLength;
      // Try to split at the last double newline within the limit
      let lastDoubleNewline = remainingContent.substring(0, maxLength).lastIndexOf("\n\n");
      // Try to split at the last single newline within the limit
      let lastNewline = remainingContent.substring(0, maxLength).lastIndexOf("\n");
      // Try to split at the last space within the limit
      let lastSpace = remainingContent.substring(0, maxLength).lastIndexOf(" ");

      // Prefer splitting at double newline, then single newline, then space
      if (lastDoubleNewline > maxLength / 2) { // Avoid tiny first chunks if newline is very early
        chunkEnd = lastDoubleNewline;
      } else if (lastNewline > maxLength / 2) {
        chunkEnd = lastNewline;
      } else if (lastSpace > maxLength / 2) {
        chunkEnd = lastSpace;
      }
      // If no good split point found, just cut at maxLength

      chunks.push(remainingContent.substring(0, chunkEnd));
      remainingContent = remainingContent.substring(chunkEnd).trimStart(); // trimStart to remove leading whitespace on next chunk
    }
  }

  try {
      // Use editReply if deferred, otherwise reply for the first chunk
      if (interaction.deferred || interaction.replied) {
          await interaction.editReply(chunks[0]);
      } else {
          await interaction.reply(chunks[0]);
      }

      // Send subsequent chunks as follow-ups
      for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
      }
  } catch (error) {
      console.error("Error sending long message:", error);
      // Attempt to inform the user about the error
       try {
           if (interaction.deferred || interaction.replied) {
               await interaction.followUp({ content: "There was an error sending the full response.", ephemeral: true });
           } else {
                await interaction.reply({ content: "There was an error sending the response.", ephemeral: true });
           }
       } catch (followUpError) {
           console.error("Error sending follow-up error message:", followUpError);
       }
  }
}


// --- Define slash commands ---
const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Replies with Pong!'),
    async execute(interaction) {
      console.log(`Ping command executed by ${interaction.user.tag}`);
      await interaction.reply({ content: 'Pong!', ephemeral: true }); // Make ping ephemeral maybe?
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

      const response = lang === "pl"
        ? "Ustawiono język polski."
        : "English language set.";

      await interaction.reply({ content: response, ephemeral: true }); // Ephemeral confirmation
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

      const userLang = userLanguagePreferences.get(userId) || "en"; // Default to EN if not set
      const response = userLang === "pl"
        ? `Ustawiono płeć jako ${gender === "f" ? "kobieta" : "mężczyzna"}.`
        : `Gender set to ${gender === "f" ? "female" : "male"}.`;

      await interaction.reply({ content: response, ephemeral: true }); // Ephemeral confirmation
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
      const isFemale = userGenderPreferences.get(userId); // Can be true, false, or undefined

      // Check gender preference ONLY if the target language is Polish
      if (userLang === "pl" && isFemale === undefined) {
        const response = "Najpierw ustaw płeć używając komendy: `/setgender`";
        await interaction.reply({ content: response, ephemeral: true }); // Make ephemeral
        return;
      }
      // If language is English, gender doesn't matter for the response generation
      // If language is Polish and gender is set, proceed.

      // Defer the reply to give us time to process the AI response
      await interaction.deferReply(); // Removed ephemeral: false, deferral is public by default

      try {
        const englishPrompt = userLang === "pl"
          ? await translateToEnglish(fullContent)
          : fullContent;

        console.log(`User ${interaction.user.tag} (Lang: ${userLang}, Gender Set: ${isFemale !== undefined}) asked AI: ${fullContent}`); // Log request
        const chatPersona = `
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
`
        const chatCompletion = await groqClient.chat.completions.create({
          messages: [
            {
              role: "system",
              content: chatPersona,
            },
            {
              role: "user",
              content: englishPrompt,
            },
          ],
          model: "mixtral-8x7b-32768",
          // Optional: Add temperature, max_tokens etc. if needed
          // temperature: 0.7,
          // max_tokens: 1024,
        });

        const aiReply = chatCompletion.choices[0]?.message?.content; // Safer access

        if (!aiReply) {
             console.error("AI Error: No content received from Groq.");
             throw new Error("AI did not provide a response."); // Throw error to be caught below
        }


        // Translate *only if needed* and *pass gender preference only if needed*
        const finalReply = userLang === "pl"
          ? await translateToPolish(aiReply, isFemale) // isFemale will be true/false here
          : aiReply; // No translation needed for English

        // Use the enhanced sendLongMessage function
        await sendLongMessage(interaction, finalReply);

      } catch (error) {
        console.error("AI Command Error:", error);
        const errorMsg = userLang === "pl" ? "Wystąpił błąd podczas przetwarzania zapytania do AI! Przepraszam ~ nya!" : "An error occurred while processing the AI request! Sorry ~ nya!";
        // Use editReply since we deferred
        await interaction.editReply({ content: errorMsg }); // Don't make error ephemeral here, so user sees it
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

      // Dynamically generate the list from the client.commands collection
      const commandsList = client.commands.map(cmd => {
        // Attempt to get localized description if available, otherwise use default
        // This requires more complex localization setup, so we'll stick to the simple way for now
        const baseDescription = {
            ping: userLang === "pl" ? "Odpowiada 'Pong!'" : "Replies with 'Pong!'",
            setlang: userLang === "pl" ? "Ustawia preferowany język (pl/en)." : "Sets your preferred language (pl/en).",
            setgender: userLang === "pl" ? "Ustawia twoją płeć dla polskich odpowiedzi (m/f)." : "Sets your gender for Polish responses (m/f).",
            ai: userLang === "pl" ? "Zadaj pytanie Nyamii AI." : "Ask Nyamii AI a question.",
            help: userLang === "pl" ? "Wyświetla tę listę komend." : "Displays this list of commands.",
        };
        return `**/${cmd.data.name}**: ${baseDescription[cmd.data.name] || cmd.data.description}`; // Fallback to default description
      }).join("\n");


      await interaction.reply({ content: `${title}\n${commandsList}`, ephemeral: true }); // Keep help ephemeral
    },
  },
];

// --- Prepare command data for registration ---
const commandData = commands.map(command => command.data.toJSON());

// --- Initialize REST client for command registration ---
// !! THIS IS THE KEY FIX !!
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// --- Register Commands Function ---
// Moved registration logic into an async function for clarity
const registerCommands = async () => {
    try {
        console.log(`Started refreshing ${commandData.length} application (/) commands.`);

        let registrationRoute;
        let logMessage;

        // Use guild commands for faster development if GUILD_ID is provided
        if (process.env.GUILD_ID) {
            registrationRoute = Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);
            logMessage = `Successfully registered commands to guild ${process.env.GUILD_ID}`;
        } else {
            // Global command registration (can take up to an hour to update)
            registrationRoute = Routes.applicationCommands(process.env.CLIENT_ID);
            logMessage = 'Successfully registered global commands';
        }

        const data = await rest.put(
            registrationRoute,
            { body: commandData },
        );

        console.log(logMessage);
        // console.log(`Registered ${data.length} commands.`); // Optional: Log how many were registered by the API call

    } catch (error) {
        console.error('Error registering commands:', error);
    }
};


// --- Load commands into client ---
for (const command of commands) {
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
         // console.log(`Command loaded: ${command.data.name}`); // Optional logging
    } else {
        console.warn(`[WARNING] The command is missing a required "data" or "execute" property.`);
    }
}

// --- Event Handlers ---

// Client Ready Event
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await registerCommands(); // Call the registration function once ready
});

// Interaction Create Event (for slash commands)
client.on('interactionCreate', async interaction => {
    // Only handle Chat Input Commands (slash commands)
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
         try {
             await interaction.reply({ content: 'Sorry, I could not find that command!', ephemeral: true });
         } catch (e) {
              console.error("Error replying about unknown command:", e);
         }
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        // Try to reply or follow up depending on interaction state
        const errorMessage = { content: 'There was an error while executing this command!', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage).catch(console.error); // Use followUp if already replied/deferred
        } else {
            await interaction.reply(errorMessage).catch(console.error); // Otherwise, use reply
        }
    }
});


// --- Login to Discord ---
client.login(process.env.DISCORD_TOKEN)
    .catch(error => {
        console.error("Failed to login:", error);
        process.exit(1); // Exit if login fails
    });



const lastAiMessages = new Map(); // Store last conversation context per user

// Handle slash commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);

    // Store last interaction if it's /ai
    if (interaction.commandName === 'ai') {
      const userId = interaction.user.id;
      const fullContent = interaction.options.getString('question');
      lastAiMessages.set(userId, [
        { role: 'user', content: fullContent }
      ]);
    }

  } catch (error) {
    console.error(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'There was an error while executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error while executing this command.', ephemeral: true });
    }
  }
});

// Listen for follow-up messages after /ai
client.on('messageCreate', async message => {
  if (message.author.bot || message.content.startsWith("/")) return;

  const userId = message.author.id;
  const previousMessages = lastAiMessages.get(userId);
  if (!previousMessages) return;

  const userLang = userLanguagePreferences.get(userId) || "en";
  const isFemale = userGenderPreferences.get(userId);

  if (userLang === "pl" && isFemale === undefined) {
    await message.reply("Najpierw ustaw płeć używając komendy: `/setgender`");
    return;
  }

  let userMessage = message.content;
  let englishPrompt = userLang === "pl" ? await translateToEnglish(userMessage) : userMessage;

  previousMessages.push({ role: 'user', content: englishPrompt });

  try {
    const chatCompletion = await groqClient.chat.completions.create({
      messages: [
        { role: "system", content: chatPersona },
        ...previousMessages
      ],
      model: "mixtral-8x7b-32768", // or your preferred model
    });

    let replyContent = chatCompletion.choices[0].message.content;
    if (userLang === "pl") {
      replyContent = await translateToPolish(replyContent, isFemale);
    }

    await message.reply(replyContent);

    // Save assistant reply to context
    previousMessages.push({ role: 'assistant', content: chatCompletion.choices[0].message.content });

    // Keep only last 6 messages to prevent token overflow
    if (previousMessages.length > 6) {
      lastAiMessages.set(userId, previousMessages.slice(-6));
    }
  } catch (error) {
    console.error("Follow-up error:", error);
    await message.reply("Oops! Something went wrong.");
  }
});
