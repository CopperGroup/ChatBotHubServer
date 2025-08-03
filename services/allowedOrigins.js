import Website from "../models/website.js"; // adjust path as needed

export const allowedOrigins = new Set();

export function addAllowedOrigin(domain) {
  if (domain) allowedOrigins.add(domain);
}

export function removeAllowedOrigin(domain) {
  allowedOrigins.delete(domain);
}

export function replaceAllowedOrigin(oldDomain, newDomain) {
  allowedOrigins.delete(oldDomain);
  if (newDomain) allowedOrigins.add(newDomain);
}

export async function initAllowedOrigins() {
  try {
    const websiteLinks = await Website.find({}).select("link"); // fetch only domains
    // Correctly iterate over the results and add each link to the Set
    websiteLinks.forEach(site => {
        if (site.link) {
            allowedOrigins.add(site.link);
        }
    });
    allowedOrigins.add("https://chat-bot-hub.vercel.app");
    allowedOrigins.add("https://www.chatboth.com");
    allowedOrigins.add("https://chatboth.com");
    allowedOrigins.add("http://127.0.0.1:5500");
    allowedOrigins.add("https://widjet.chatboth.com");
    console.log("✅ allowedOrigins initialized:", [...allowedOrigins]);
  } catch (error) {
    console.error("❌ Failed to initialize allowedOrigins:", error);
  }
}
