require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");
const Groq = require("groq-sdk");
const { translate } = require("@vitalets/google-translate-api");

const app = express();
const port = 3000;

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groqClient = new Groq({
  apiKey: process.env.GROQ_TOKEN,
});

// Store user preferences
const userGenderPreferences = new Map(); // true = female, false = male
const userLanguagePreferences = new Map(); // 'pl' or 'en'

discordClient.once("ready", () => {
  console.log("I am ready!");
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
});

app.get("/", (req, res) => res.send("Bot is running!"));

const prefix = "!";
const commandsList = {
  ping: "[Test command] Replies with Pong!",
  ai: "Fetches AI response. Usage: !ai <your question>",
  help: "Displays list of available commands.",
  setgender: "Set your gender for Polish. Usage: !setgender <f/m>",
  setlang: "Set preferred language. Usage: !setlang <pl/en>",
};

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

async function sendLongMessage(message, content) {
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

  for (const chunk of chunks) {
    await message.reply(chunk);
  }
}

discordClient.on("messageCreate", async (message) => {
  if (
    !message.content.startsWith(prefix) ||
    message.author.bot ||
    !message.guild
  )
    return;

  const [cmd, ...args] = message.content.slice(prefix.length).split(/\s+/);
  const command = cmd.toLowerCase();
  const fullContent = args.join(" ");
  const userId = message.author.id;
  const userLang = userLanguagePreferences.get(userId) || "en";

  const isFemale = userGenderPreferences.get(userId);

  const reply = (pl, en) => message.reply(userLang === "pl" ? pl : en);

  switch (command) {
    case "ping":
      reply("Pong!", "Pong!");
      break;

    case "setlang":
      const lang = fullContent.trim().toLowerCase();
      if (["pl", "en"].includes(lang)) {
        userLanguagePreferences.set(userId, lang);
        reply("Ustawiono język polski.", "Polish language set.");
      } else {
        reply("Użycie: !setlang <pl/en>", "Usage: !setlang <pl/en>");
      }
      break;

    case "setgender":
      const gender = fullContent.trim().toLowerCase();
      if (["f", "m"].includes(gender)) {
        userGenderPreferences.set(userId, gender === "f");
        reply(
          `Ustawiono płeć jako ${gender === "f" ? "kobieta" : "mężczyzna"}.`,
          `Gender set to ${gender === "f" ? "female" : "male"}.`
        );
      } else {
        reply("Użycie: !setgender <f/m>", "Usage: !setgender <f/m>");
      }
      break;

    case "ai":
      if (!fullContent.trim()) {
        reply("Użyj: !ai <treść pytania>", "Usage: !ai <your question>");
        return;
      }

      if (isFemale === undefined) {
        reply(
          "Najpierw ustaw płeć: !setgender <f/m>",
          "Please set your gender first: !setgender <f/m>"
        );
        return;
      }

      try {
        const englishPrompt = await translateToEnglish(fullContent);
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
        const finalReply =
          userLang === "pl"
            ? await translateToPolish(aiReply, isFemale)
            : aiReply;

        await sendLongMessage(message, finalReply);
      } catch (error) {
        console.error("AI error:", error);
        reply("Wystąpił błąd!", "An error occurred!");
      }
      break;

    case "help":
      const list = Object.entries(commandsList)
        .map(([cmd, desc]) => `**${prefix}${cmd}**: ${desc}`)
        .join("\n");
      const title =
        userLang === "pl" ? "Dostępne komendy:" : "Available commands:";
      message.reply(`${title}\n${list}`);
      break;

    default:
      reply(
        `Nieznana komenda. Użyj \`${prefix}help\` by zobaczyć listę.`,
        `Unknown command. Use \`${prefix}help\` to see the list.`
      );
      break;
  }
});

discordClient.login(process.env.DISCORD_TOKEN);
