// services/telegram-notifier.js
const TELEGRAM_BOT_URL = process.env.TELEGRAM_BOT_URL;

/**
 * Sends a Telegram notification via webhook.
 * @param {object} payload - The payload to send to the Telegram bot.
 */
export async function sendTelegramNotification(payload) {
    if (!TELEGRAM_BOT_URL) {
        console.error("SERVER ERROR: TELEGRAM_BOT_URL environment variable is not set. Cannot send Telegram notification.");
        return;
    }

    try {
        console.log(`SERVER DEBUG: Sending Telegram notification to ${TELEGRAM_BOT_URL} with payload:`, payload);
        const response = await fetch(TELEGRAM_BOT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            console.log("SERVER DEBUG: Telegram notification sent successfully.");
        } else {
            const errorText = await response.text();
            console.error(`SERVER ERROR: Failed to send Telegram notification: ${response.status} - ${response.statusText}. Response:`, errorText);
        }
    } catch (error) {
        console.error("SERVER ERROR: Error sending Telegram notification:", error);
    }
}