import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { userRoutes } from "./routes/user.js";
import { websiteRoutes } from "./routes/website.js";
import { chatRoutes } from "./routes/chat.js";
import staffRoutes from "./routes/staff.js";
import { planRoutes } from "./routes/plan.js";
import { handleSocket } from "./socket.js";
import Website from "./models/website.js";
import dotenv from "dotenv";
import { transactionRoutes } from "./routes/transaction.js";
import {
  allowedOrigins,
  initAllowedOrigins,
} from "./services/allowedOrigins.js";
import multiLanguage from "./services/multiLanguage.js"; // This contains your translations
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises"; // Import Node.js file system promises API
import { fileRoutes } from "./routes/files.js";
import { widjetRoutes } from "./routes/widget.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log("MongoDB connected"), await initAllowedOrigins();
  })
  .catch((err) => console.error(err));

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
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// No longer serving `public` as a static directory directly at `/widget`
// app.use("/widget", express.static(path.join(__dirname, 'public')));

app.use("/api/users", userRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/websites", websiteRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/files", fileRoutes);
app.use("/widget", widjetRoutes)

// --- New Language Routes ---
/**
 * @route GET /getPossibleLanguages
 * @description Returns a list of all language codes available in multiLanguage.js.
 * This is used by the client-side widget to determine if a browser language is supported.
 * @access Public
 */
app.get("/api/getPossibleLanguages", (req, res) => {
  try {
    const languages = Object.values(multiLanguage)
      .map((translations) => Object.keys(translations))
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
app.get("/api/getInterfaceLanguage/:languageCode", (req, res) => {
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

  if (!foundTranslations && languageCode !== "en") {
    // If no specific translations were found for the requested language, and it's not English,
    // it implies the language isn't fully supported. Return English translations.
    console.warn(
      `No specific translations found for ${languageCode}. Falling back to English.`
    );
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
// --- End New Language Routes ---;

io.on("connection", (socket) => handleSocket(socket, io));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Main service running on http://localhost:${PORT}`);
});
