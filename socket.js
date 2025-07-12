import { authenticateWidgetSocket, handleDashboardAndStaffRooms } from "./services/socket-auth.js";

// Import handlers
import {
    handleNewStaffAdded,
    handleDashboardMessage,
    handleToggleAIResponses,
    handleCloseChat,
    handleAssignChatLead,
    handleUnassignChatLead
} from "./handlers/dashboard-handlers.js";

import {
    handleCreateNewChat,
    handleJoinChat,
    handleWidgetMessage
} from "./handlers/widget-handlers.js";


export function handleSocket(socket, io) {
    const chatbotCode = socket.handshake.query.chatbotCode;
    const origin = socket.handshake.headers.origin;
    const dashboardUser = socket.handshake.query.dashboardUser;
    const staffId = socket.handshake.query.staffId;
    const websiteId = socket.handshake.query.websiteId;
    const isStaff = socket.handshake.query.isStaff === "true";
    const staffName = socket.handshake.query.staffName || "Unknown Staff";

    console.log(
        `SERVER DEBUG: New connection established. Socket ID: ${socket.id}. Type: ${dashboardUser ? 'Dashboard' : isStaff ? 'Staff' : 'Widget'}. User/Staff ID: ${dashboardUser || staffId || 'N/A'}. Chatbot Code: ${chatbotCode || 'N/A'}.`,
    );
    console.log(`SERVER DEBUG: Socket ${socket.id} joined rooms on connect: ${Array.from(socket.rooms).join(', ')}`);

    socket.on("new_staff_added", (data) => handleNewStaffAdded(io, data));
    socket.on("disconnect", (reason) => {
        console.log(`SERVER DEBUG: Socket ID: ${socket.id} disconnected. Reason: ${reason}.`);
    });

    if (dashboardUser || isStaff) {
        handleDashboardAndStaffRooms(socket, dashboardUser, isStaff, websiteId);

        socket.on("dashboard_message", (data) => handleDashboardMessage(socket, io, data, dashboardUser, isStaff, staffId));
        socket.on("toggle_ai_responses", (data) => handleToggleAIResponses(io, { ...data, staffName }));
        socket.on("close_chat", (data) => handleCloseChat(io, data));
        socket.on("assign_chat_lead", (data) => handleAssignChatLead(io, data));
        socket.on("unassign_chat_lead", (data) => handleUnassignChatLead(io, data));
        return; // Exit as this connection is for dashboard/staff
    }

    // Widget specific connections below
    authenticateWidgetSocket(socket)
        .then(async (website) => {
            if (!website) {
                return; // Socket already disconnected by authenticateWidgetSocket
            }

            socket.on("create_new_chat", (data) => handleCreateNewChat(socket, io, website, data));
            socket.on("join_chat", (data) => handleJoinChat(socket, data));
            socket.on("message", (data) => handleWidgetMessage(socket, io, website, data));
        })
        .catch((err) => {
            console.error(`SERVER ERROR: Error during widget connection setup for chatbotCode ${chatbotCode}:`, err);
            socket.disconnect(true);
        });
}