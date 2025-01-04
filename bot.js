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
const userGenderPreferences = new Map();
const userLanguagePreferences = new Map();

discordClient.once("ready", () => {
    console.log("I am ready!");

    // Start the web server to keep the bot alive
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
});

const prefix = "!";

const commandsList = {
    ping: "[Test command] Replies with Pong!",
    ai: "Fetches AI response. Usage: !ai <your question>",
    help: "Displays list of available commands.",
    setgender:
        "Set your gender for proper Polish translation. Usage: !setgender <f/m>",
    setlang: "Set preferred language (Polish/English). Usage: !setlang <pl/en>",
};

const commandsListEn = {
    ping: "[Test command] Replies with Pong!",
    ai: "Fetches AI response. Usage: !ai <your question>",
    help: "Displays list of available commands.",
    setgender:
        "Set your gender for proper Polish translation. Usage: !setgender <f/m>",
    setlang: "Set preferred language (Polish/English). Usage: !setlang <pl/en>",
};

// Basic route to keep the bot awake
app.get("/", (req, res) => {
    res.send("Bot is running!");
});

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
            if (lastNewLine !== -1) {
                chunk = chunk.slice(0, lastNewLine);
            }
        }

        chunks.push(chunk);
        content = content.slice(chunk.length);
    }

    for (const chunk of chunks) {
        await message.reply(chunk);
    }
}

discordClient.on("messageCreate", async (message) => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const command = message.content
        .slice(prefix.length)
        .split(/\s+/)[0]
        .toLowerCase();
    const fullContent = message.content.slice(
        prefix.length + command.length + 1,
    );
    const userLang = userLanguagePreferences.get(message.author.id) || "pl";

    switch (command) {
        case "setlang":
            const lang = fullContent.trim().toLowerCase();
            if (lang === "pl" || lang === "en") {
                userLanguagePreferences.set(message.author.id, lang);
                const response =
                    lang === "pl"
                        ? "Ustawiono język polski jako preferowany."
                        : "English language has been set as preferred.";
                message.reply(response);
            } else {
                const response =
                    userLang === "pl"
                        ? 'Proszę określ język jako "pl" dla polskiego lub "en" dla angielskiego. Użycie: !setlang <pl/en>'
                        : 'Please specify language as "pl" for Polish or "en" for English. Usage: !setlang <pl/en>';
                message.reply(response);
            }
            break;

        case "setgender":
            const gender = fullContent.trim().toLowerCase();
            if (gender === "f" || gender === "m") {
                userGenderPreferences.set(message.author.id, gender === "f");
                const response =
                    userLang === "pl"
                        ? `Twoja preferencja płci została ustawiona na ${gender === "f" ? "kobieta" : "mężczyzna"} dla tłumaczeń na język polski.`
                        : `Your gender preference has been set to ${gender === "f" ? "female" : "male"} for Polish translations.`;
                message.reply(response);
            } else {
                const response =
                    userLang === "pl"
                        ? 'Proszę określ swoją płeć jako "f" dla kobiety lub "m" dla mężczyzny. Użycie: !setgender <f/m>'
                        : 'Please specify your gender as "f" for female or "m" for male. Usage: !setgender <f/m>';
                message.reply(response);
            }
            break;

        case "ai":
            try {
                if (!fullContent.trim()) {
                    const response =
                        userLang === "pl"
                            ? "Proszę podaj treść pytania, które chcesz zadać. Użyj komendy !ai <treść pytania> by uzyskać odpowiedź od AI."
                            : "Please provide a query for the AI. Usage: !ai <your prompt>";
                    message.reply(response);
                    return;
                }

                const isFemale = userGenderPreferences.get(message.author.id);
                if (isFemale === undefined) {
                    const response =
                        userLang === "pl"
                            ? "Ustaw swoją płeć używając komendy !setgender <f/m> by uzyskać poprawne tłumaczenia na język polski."
                            : "Please set your gender first using !setgender <f/m> for proper Polish translation.";
                    message.reply(response);
                    return;
                }

                const englishQuery = await translateToEnglish(
                    fullContent.trim(),
                );

                const chatCompletion = await groqClient.chat.completions.create(
                    {
                        messages: [
                            {
                                role: "system",
                                content:
                                    "You are an emotional counselor for people with problems. You need to help them with their problems when they describe them. Be empathetic, supportive, and provide practical advice when appropriate.",
                            },
                            {
                                role: "user",
                                content: englishQuery,
                            },
                        ],
                        model: "llama3-8b-8192",
                    },
                );

                const aiResponse = chatCompletion.choices[0].message.content;
                const polishResponse = await translateToPolish(
                    aiResponse,
                    isFemale,
                );

                // Send response based on user's language preference
                if (userLang === "pl") {
                    await sendLongMessage(message, `${polishResponse}`);
                } else {
                    await sendLongMessage(message, `${aiResponse}`);
                }
            } catch (error) {
                console.error("Error:", error);
                const response =
                    userLang === "pl"
                        ? "Wybacz, napotkałem problem z daniem odpowiedzi!"
                        : "Sorry, there was an error processing your request.";
                message.reply(response);
            }
            break;

        case "help":
            const helpList = userLang === "pl" ? commandsList : commandsListEn;
            const helpMessage = Object.entries(helpList)
                .map(([cmd, desc]) => `**${prefix}${cmd}**: ${desc}`)
                .join("\n");
            const helpTitle =
                userLang === "pl" ? "Dostępne komendy:" : "Available commands:";
            message.reply(`${helpTitle}\n${helpMessage}`);
            break;

        default:
            const response =
                userLang === "pl"
                    ? `Nie znana komenda. Użyj \`${prefix}help\` by zobaczyć dostępne komendy.`
                    : `Unknown command. Use \`${prefix}help\` to see the list of available commands.`;
            message.reply(response);
            break;
    }
});

discordClient.login(process.env.DISCORD_TOKEN);
