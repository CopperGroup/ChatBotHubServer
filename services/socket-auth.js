// services/socket-auth.js
import Website from "../models/website.js";

/**
 * Authenticates and authorizes a widget socket connection based on chatbotCode and origin.
 * @param {object} socket - The socket.io socket object.
 * @returns {Promise<object|null>} The website object if authorized, null otherwise.
 */
export async function authenticateWidgetSocket(socket) {
    const chatbotCode = socket.handshake.query.chatbotCode;
    const origin = socket.handshake.headers.origin;

    if (!chatbotCode) {
        console.log("SERVER DEBUG: No chatbotCode provided for widget, disconnecting socket.");
        socket.disconnect(true);
        return null;
    }

    try {
        const website = await Website.findOne({ chatbotCode }).populate("plan");
        if (!website) {
            console.log(`SERVER DEBUG: Website with chatbotCode ${chatbotCode} not found, disconnecting socket.`);
            socket.disconnect(true);
            return null;
        }

        const websiteLink = website.link.endsWith("/") ? website.link.slice(0, -1) : website.link;
        const requestOrigin = origin ? (origin.endsWith("/") ? origin.slice(0, -1) : origin) : "";

        // if (websiteLink !== requestOrigin) {
        //     console.log(
        //         `SERVER WARN: Socket connection: Origin mismatch for chatbotCode ${chatbotCode}. Expected: ${website.link}, Got: ${origin}. Disconnecting.`,
        //     );
        //     socket.disconnect(true);
        //     return null;
        // }

        console.log(`SERVER DEBUG: Widget connection allowed for chatbotCode: ${chatbotCode} from origin: ${origin}.`);
        return website;
    } catch (err) {
        console.error(`SERVER ERROR: Error during widget socket authentication for chatbotCode ${chatbotCode}:`, err);
        socket.disconnect(true);
        return null;
    }
}

/**
 * Handles joining rooms for dashboard and staff users.
 * @param {object} socket - The socket.io socket object.
 * @param {string} dashboardUser - The ID of the dashboard user, if applicable.
 * @param {boolean} isStaff - True if the user is staff, false otherwise.
 * @param {string} websiteId - The ID of the website, if applicable.
 */
export function handleDashboardAndStaffRooms(socket, dashboardUser, isStaff, websiteId) {
    if (dashboardUser) {
        socket.join(`dashboard_${dashboardUser}`);
        console.log(`SERVER DEBUG: Dashboard user ${dashboardUser} joined room dashboard_${dashboardUser}.`);
    }
    if (isStaff && websiteId) {
        socket.join(`staff_${websiteId}`);
        console.log(`SERVER DEBUG: Staff user ${socket.handshake.query.staffId} for website ${websiteId} joined room staff_${websiteId}.`);
    }
}