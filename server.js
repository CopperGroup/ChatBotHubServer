import express from "express"
import http from "http"
import cors from "cors"
import mongoose from "mongoose"
import { Server } from "socket.io"
import { userRoutes } from "./routes/user.js"
import { websiteRoutes } from "./routes/website.js"
import { chatRoutes } from "./routes/chat.js"
import staffRoutes from "./routes/staff.js"
import { planRoutes } from "./routes/plan.js"
import { handleSocket } from "./socket.js"
import Website from "./models/website.js"
import dotenv from "dotenv"
import { transactionRoutes } from "./routes/transaction.js"
import { allowedOrigins, initAllowedOrigins } from "./services/allowedOrigins.js"
import multiLanguage from "./services/multiLanguage.js" // This contains your translations
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises'; // Import Node.js file system promises API

dotenv.config()

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express()
const server = http.createServer(app)

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => { console.log("MongoDB connected"), await initAllowedOrigins(); })
  .catch((err) => console.error(err))

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        console.warn(`🚫 Blocked origin: ${origin}`);
        callback(new Error("Origin not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"]
  },
})

// Middleware
app.use(cors())
app.use(express.json())

// No longer serving `public` as a static directory directly at `/widget`
// app.use("/widget", express.static(path.join(__dirname, 'public')));

app.use("/api/users", userRoutes)
app.use("/api/transactions", transactionRoutes)
app.use("/api/websites", websiteRoutes)
app.use("/api/chats", chatRoutes)
app.use("/api/staff", staffRoutes)
app.use("/api/plans", planRoutes)

// --- New Language Routes ---
/**
 * @route GET /getPossibleLanguages
 * @description Returns a list of all language codes available in multiLanguage.js.
 * This is used by the client-side widget to determine if a browser language is supported.
 * @access Public
 */
app.get("/getPossibleLanguages", (req, res) => {
  try {
    const languages = Object.values(multiLanguage)
      .map(translations => Object.keys(translations))
      .reduce((acc, current) => acc.concat(current), [])
      .filter((value, index, self) => self.indexOf(value) === index); // Get unique language codes

    res.json(languages);
  } catch (error) {
    console.error("Error getting possible languages:", error);
    res.status(500).json({ message: "Error retrieving possible languages." });
  }
});

/**
 * @route GET /getInterfaceLanguage/:languageCode
 * @description Returns the translation object for a specific language code.
 * This is used by the client-side widget to load dynamic translations.
 * @param {string} languageCode - The language code (e.g., 'en', 'es').
 * @access Public
 */
app.get("/getInterfaceLanguage/:languageCode", (req, res) => {
  const { languageCode } = req.params;

  // Assume multiLanguage is structured as { "phraseKey": { "en": "English phrase", "es": "Spanish phrase" } }
  // We need to transform it to { "phraseKey": "Translated phrase" } for the client.
  const translationsForLang = {};
  let foundTranslations = false;

  for (const key in multiLanguage) {
    if (multiLanguage.hasOwnProperty(key)) {
      if (multiLanguage[key][languageCode]) {
        translationsForLang[key] = multiLanguage[key][languageCode];
        foundTranslations = true;
      } else {
        // Fallback to English if a specific translation is missing for the requested language
        translationsForLang[key] = multiLanguage[key]["en"] || key; // Use the key itself if English is also missing
      }
    }
  }

  if (!foundTranslations && languageCode !== 'en') {
    // If no specific translations were found for the requested language, and it's not English,
    // it implies the language isn't fully supported. Return English translations.
    console.warn(`No specific translations found for ${languageCode}. Falling back to English.`);
    const englishTranslations = {};
    for (const key in multiLanguage) {
      if (multiLanguage.hasOwnProperty(key)) {
        englishTranslations[key] = multiLanguage[key]["en"] || key;
      }
    }
    return res.json(englishTranslations);
  }
  
  res.json(translationsForLang);
});
// --- End New Language Routes ---

app.get("/widget/chatbot-widget.js", async (req, res) => {
  const chatbotCode = req.query.chatbotCode
  let requestOrigin = req.headers.origin

  if (!requestOrigin) {
    console.warn(
      `Chatbot widget request: Origin header is missing for chatbotCode ${chatbotCode}. Defaulting to http://localhost:3000 for local development.`,
    )
    requestOrigin = "http://localhost:3000"
  }

  if (!chatbotCode) {
    console.log("Chatbot widget request: chatbotCode is missing.")
    return res.status(400).send("// chatbotCode is missing")
  }

  try {
    const website = await Website.findOne({ chatbotCode })

    if (!website) {
      console.log(`Chatbot widget request: Website with chatbotCode ${chatbotCode} not found.`)
      return res.status(404).send("// Website not found for this chatbotCode")
    }

    // --- INTEGRATED PAYMENT/TRIAL CHECK ---
    let shouldDisplayWidget = true;
    let reasonForNotDisplaying = '';

    if (website.freeTrialPlanId) {
      if (website.freeTrialEnded && !website.stripeSubscriptionId) {
        shouldDisplayWidget = false;
        reasonForNotDisplaying = `Free trial ended for website ${website._id} and no active subscription.`;
      }
    } else {
      if (!website.stripeSubscriptionId && !website.exlusiveCustomer) {
        shouldDisplayWidget = false;
        reasonForNotDisplaying = `Website ${website._id} has no free trial and no active subscription or exclusive customer status.`;
      }
    }

    if (!shouldDisplayWidget) {
      console.log(`[Chatbot Widget] Not sending widget script for chatbotCode ${chatbotCode}. Reason: ${reasonForNotDisplaying}`);
      // Send a 403 Forbidden status with a comment in the JS file
      return res.status(403).type("application/javascript").send(`// Chatbot widget not loaded. Reason: ${reasonForNotDisplaying}`);
    }
    // --- END INTEGRATED PAYMENT/TRIAL CHECK ---


    const preferences = website.preferences || {}
    const gradient1 = preferences.colors?.gradient1 || "#667eea"
    const gradient2 = preferences.colors?.gradient2 || "#764ba2"
    const headerText = preferences.header || "Chat Support"
    const allowAIResponses = preferences.allowAIResponses || false
    const allowedPaths = preferences.allowedPaths || []
    const disallowedPaths = preferences.disallowedPaths || []
    const allowDynaminLanguage = preferences.dynamiclyAdaptToLanguage || false

    // No longer pre-fetching all translated phrases here if dynamicLanguage is true
    const selectedLanguage = website.preferences.language || "en";
    let translatedPhrases = {}; // Initialize as empty, client will fetch if dynamic

    // If dynamic language is allowed, the client will fetch its own translations.
    // Otherwise, we inject the server's configured language directly.
    if (!allowDynaminLanguage) {
      for (const key in multiLanguage) {
        if (multiLanguage.hasOwnProperty(key)) {
          translatedPhrases[key] = multiLanguage[key][selectedLanguage] || key;
        }
      }
    }


    // Parameters to be injected into the client-side script
    const injectedConfig = {
      gradient1,
      gradient2,
      headerText,
      allowAIResponses,
      allowedPaths,
      disallowedPaths,
      translatedPhrases, // This will be empty if allowDynaminLanguage is true
      chatbotCode,
      language: selectedLanguage, // Still pass the server's configured language
      allowDynamicLanguage: allowDynaminLanguage, // Corrected variable name
      socketIoUrl: process.env.SOCKET_URL,
      backendUrl: process.env.BACKEND_URL
    };

    console.log(injectedConfig)

    // Read the client-side JavaScript file
    const clientScriptPath = path.join(__dirname, 'public', 'chatbot-widget-client.js');
    let clientScriptContent = await fs.readFile(clientScriptPath, 'utf8');

    // Prepend the injected config to the client script content
    // Note: The client-side script already has a checkAndToggleWidget() function
    // that uses injectedAllowedPaths and injectedDisallowedPaths.
    // The server-side check here is a primary gate.
    const fullScript = `window.chatbotConfig = ${JSON.stringify(injectedConfig)};\n${clientScriptContent}`;

    // Send the combined script as the response
    res.type("application/javascript").send(fullScript);

  } catch (err) {
    console.error("Error during widget loading:", err)
    res.status(500).send("// Internal server error during widget loading.")
  }
})

io.on("connection", (socket) => handleSocket(socket, io))

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Main service running on http://localhost:${PORT}`)
})