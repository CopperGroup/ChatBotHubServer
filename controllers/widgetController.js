// controllers/widgetController.js

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Assuming these are in a models and utils directory relative to this file
import Website from '../models/website.js'; 
import multiLanguage from '../services/multiLanguage.js'; 
import plan from '../models/plan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to build deep links for internal/external navigation
function buildDeepLink(action) {
  const DEEPLINK_SEPARATOR = "->*cbhdeeplink^&^cbhdeeplink*->";
  if (action.deepLinkType === "external" && action.externalUrl) {
    return `${action.externalUrl}${DEEPLINK_SEPARATOR}new`;
  } else if (action.deepLinkType === "internal" && action.internalTab) {
    let deepLink = `${action.internalTab}${DEEPLINK_SEPARATOR}`;

    if (action.internalTab === "messages") {
      const view = action.internalView === "chat" ? "chat" : "conversations";
      const itemId = action.internalView === "chat" ? "null" : action.internalItemId || "null";
      deepLink += `${view}${DEEPLINK_SEPARATOR}${itemId}`;
    } else if (action.internalTab === "help") {
      const view = action.internalView || "articles";
      const itemId = action.internalView === "articleContent" && action.internalItemId ? action.internalItemId : "null";
      deepLink += `${view}${DEEPLINK_SEPARATOR}${itemId}`;
    } else {
      deepLink += `null${DEEPLINK_SEPARATOR}null`;
    }
    return deepLink;
  }
  return `null${DEEPLINK_SEPARATOR}null${DEEPLINK_SEPARATOR}null`;
}

// Function to construct the config object based on the website data
function createChatbotConfig(website) {
  const preferences = website.preferences || {};
  const colors = preferences.colors || {};
  const heading = preferences.heading || {};
  const homeTab = {};

  if (preferences.showQuickActions) {
    homeTab.qickActionsButtons = (preferences.quickActions || []).map(action => ({
      text: action.text,
      deepLink: buildDeepLink(action),
      icon: action.icon || ""
    }));
  }

  if (preferences.showHomeTabHelpSection) {
    homeTab.helpSection = (preferences.selectedHomeTabHelpArticles || []).map(article => ({
      title: article.title,
      deepLink: `help->*cbhdeeplink^&^cbhdeeplink*->articleContent->*cbhdeeplink^&^cbhdeeplink*->${article.id}`
    }));
  }

  const config = {
    headerText: preferences.header || "Chat Support",
    heading: {
      text: heading.text || "Hi there 👋 <br/> How can we help you today?",
      color: heading.color || "#1f2937",
      shadow: heading.shadow ?? false,
      shadowColor: heading.shadowColor || "#000000",
      fontSize: heading.fontSize || "24px",
    },
    gradient1: colors.gradient1 || "#10b981",
    gradient2: colors.gradient2 || "#059669",
    allowAIResponses: preferences.allowAIResponses ?? false,
    language: preferences.language || "en",
    dynamiclyAdaptToLanguage: preferences.dynamiclyAdaptToLanguage ?? false,
    chatbotCode: website.chatbotCode,
    theme: preferences.theme || "light",
    branding: preferences.branding ?? true,
    tabsMode: preferences.tabsMode ?? true,
    allowedPaths: preferences.allowedPaths,
    disallowedPaths: preferences.disallowedPaths,
    autoOpen: false, 
    logoUrl: preferences.logoUrl || "./logo.png",
    homeTab: homeTab,
    translatedPhrases: {}, 
    allowFileSharing: ["Pro", "Enterprise"].includes(website.plan.name),
    socketIoUrl: process.env.SOCKET_URL,
    backendUrl: process.env.BACKEND_URL,
  };

  if (preferences.backgroundType === "solid" && preferences.bgColor) {
    config.bgColor = preferences.bgColor;
  } else if (preferences.backgroundType === "image" && preferences.bgImageUrl) {
    config.bgImageUrl = preferences.bgImageUrl;
  } else if(!preferences.backgroundType) {
    console.log("Trigered")
    config.bgImageUrl = "./bg-image.png";
  }

  if (preferences.showStaffInitials && preferences.selectedStaffInitials) {
    config.staffInitials = preferences.selectedStaffInitials;
  }
  
  return config;
}

export const getChatbotWidget = async (req, res) => {
  const chatbotCode = req.query.chatbotCode;
  let requestOrigin = req.headers.pageUrl;

  console.log(requestOrigin)
  if (!chatbotCode) {
    console.log("Chatbot widget request: chatbotCode is missing.");
    return res.status(400).send("// chatbotCode is missing");
  }

  try {
    const website = await Website.findOne({ chatbotCode }).populate(
        {
            path: "plan",
            model: plan,
            select: "name"
        }
    );

    if (!website) {
      console.log(`Chatbot widget request: Website with chatbotCode ${chatbotCode} not found.`);
      return res.status(404).send("// Website not found for this chatbotCode");
    }

    const isProOrEnterprise = ["Pro", "Enterprise"].includes(website.plan.name);
    let brandingConfig = website.preferences.branding ?? true;
    if (!isProOrEnterprise) {
      brandingConfig = true; 
    }

    let shouldDisplayWidget = true;
    let reasonForNotDisplaying = "";

    if (website.freeTrialEnded && !website.stripeSubscriptionId && !website.exlusiveCustomer) {
      shouldDisplayWidget = false;
      reasonForNotDisplaying = `Free trial ended and no active subscription.`;
    }

    if (!shouldDisplayWidget) {
      console.log(`[Chatbot Widget] Not sending widget script for chatbotCode ${chatbotCode}. Reason: ${reasonForNotDisplaying}`);
      return res
        .status(403)
        .type("application/javascript")
        .send(`// Chatbot widget not loaded. Reason: ${reasonForNotDisplaying}`);
    }

    const config = createChatbotConfig(website);
    
    if (!config.dynamiclyAdaptToLanguage) {
      const selectedLanguage = config.language;
      const translatedPhrases = {};

        for (const key in multiLanguage) {
        if (multiLanguage.hasOwnProperty(key)) {
          translatedPhrases[key] = multiLanguage[key][selectedLanguage] || key;
        }
      }

      config.translatedPhrases = translatedPhrases;
    }

    const clientScriptPath = path.join(__dirname, "../public/chatbot-widget-client.js");
    let clientScriptContent = await fs.readFile(clientScriptPath, "utf8");

    const fullScript = `window.chatbotConfig = ${JSON.stringify(config, null, 2)};\n${clientScriptContent}`;

    res.type("application/javascript").send(fullScript);
  } catch (err) {
    console.error("Error during widget loading:", err);
    res.status(500).send("// Internal server error during widget loading.");
  }
};

export const validateOrigin = async (req, res) => {
    const { chatbotCode, requestOrigin } = req.body;
  
    if (!chatbotCode || !requestOrigin) {
      return res.status(403).json({ allowed: false, reason: "Missing chatbot code or request origin" });
    }
  
    const website = await Website.findOne({ chatbotCode });
  
    if (!website) {
      return res.status(404).json({ allowed: false, reason: "Chatbot not found" });
    }
  
    let shouldDisplayWidget = true;
    let reasonForNotDisplaying = "";
  
    if (process.env.ENVIRONMENT === "dev" && !requestOrigin) {
      console.warn(`Chatbot widget request: Origin header is missing for chatbotCode ${chatbotCode}. Defaulting to a local development origin.`);
      requestOrigin = "http://localhost:3000";
    } else if (!requestOrigin) {
      shouldDisplayWidget = false;
      reasonForNotDisplaying = "Missing origin header";
    }
  
    if (!requestOrigin.includes(website.link)) {
      shouldDisplayWidget = false;
      reasonForNotDisplaying = "Disallowed origin";
    }
  
    res.status(200).json({
      allowed: shouldDisplayWidget,
      reason: reasonForNotDisplaying
    });
};
  