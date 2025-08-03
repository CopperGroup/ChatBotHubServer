// handlers/dashboard-handlers.js
import Chat from "../models/chat.js";
import Website from "../models/website.js";
import User from "../models/user.js";
import Staff from "../models/staff.js";
import { sendTelegramNotification } from "../services/telegram-notifier.js"; // Import the notifier

/**
 * Handles the 'new_staff_added' event for dashboard and staff rooms.
 * @param {object} io - The socket.io server instance.
 * @param {object} data - The event data containing websiteId and newStaff.
 */
export async function handleNewStaffAdded(io, { websiteId, newStaff }) {
  console.log(
    `SERVER EVENT: Received 'new_staff_added' for website ${websiteId}.`
  );
  try {
    const website = await Website.findById(websiteId).populate("owner");
    if (!website) return;

    const payload = {
      websiteId,
      message: `A new staff member, ${newStaff.name}, has been added to ${website.name}.`,
      staff: newStaff,
    };

    if (website.owner) {
      io.to(`dashboard_${website.owner._id}`).emit("staff_added", payload);
    }
    io.to(`staff_${websiteId}`).emit("staff_added", payload);

    console.log(
      `SERVER DEBUG: Emitted 'staff_added' for website ${websiteId}.`
    );
  } catch (error) {
    console.error(
      `SERVER ERROR: Failed to process new_staff_added event:`,
      error
    );
  }
}

/**
 * Handles messages sent from the dashboard by owners or staff.
 * @param {object} socket - The socket.io socket object.
 * @param {object} io - The socket.io server instance.
 * @param {object} data - The message data.
 * @param {string} dashboardUser - The ID of the dashboard user, if applicable.
 * @param {boolean} isStaff - True if the sender is staff, false otherwise.
 * @param {string} staffId - The ID of the staff, if applicable.
 */
export async function handleDashboardMessage(
  socket,
  io,
  data,
  dashboardUser,
  isStaff,
  staffId
) {
  const { chatId, message, websiteName, chatName } = data;
  console.log(
    `SERVER DEBUG: Received 'dashboard_message' from ${message.sender} (Socket ID: ${socket.id}). Chat ID: ${chatId}.`
  );

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.error(
        `SERVER ERROR: Chat ${chatId} not found for dashboard message.`
      );
      return;
    }

    const messages = JSON.parse(chat.messages || "[]");

    let widgetSender = "bot"; // Default in case nothing matches
    let actualSenderName = "Support"; // Default name

    // Determine the actual sender name and type for the widget
    if (dashboardUser) {
      const owner = await User.findById(dashboardUser);
      if (owner) {
        actualSenderName = "Owner";
        widgetSender = `owner`; // Treat owner messages as 'staff' from widget's perspective
      }
    } else if (isStaff && staffId) {
      const staffMember = await Staff.findById(staffId);
      if (staffMember) {
        actualSenderName = staffMember.name || "Staff";
        widgetSender = `staff-${actualSenderName}`;
      }
    }

    // If the incoming message already has a specific sender format (e.g., from another dashboard instance)
    if (message.sender && typeof message.sender === "string") {
      if (message.sender.startsWith("staff-")) {
        widgetSender = message.sender;
        actualSenderName = message.sender.substring(6); // Extract name after 'staff-'
      } else if (message.sender.startsWith("owner")) {
        widgetSender = `owner`; // Convert to staff- format
        actualSenderName = "Owner";
      }
    }

    const outgoingMessage = {
      sender: widgetSender,
      text: message.text,
      timestamp: message.timestamp || new Date().toISOString(),
      fileUrl: message.fileUrl,
    };

    messages.push(outgoingMessage);

    const roomSockets = await io.in(`chat_${chatId}`).allSockets();
    console.log(
      `SERVER DEBUG: Sockets in room chat_${chatId} before emitting 'reply': ${Array.from(
        roomSockets
      ).join(", ")}`
    );

    io.to(`chat_${chatId}`).emit("reply", {
      text: outgoingMessage.text,
      sender: outgoingMessage.sender,
      timestamp: outgoingMessage.timestamp,
      chatId,
      fileUrl: message.fileUrl,
    });
    console.log(
      `SERVER DEBUG: Emitted 'reply' to widget (chat_${chatId}). Sender: ${outgoingMessage.sender}.`
    );

    console.log("test fileUrl", data);

    const website = await Website.findOne({ chats: chatId }).populate("owner");
    if (!website) {
      console.warn(
        `SERVER WARN: Website not found for chat ${chatId}. Cannot broadcast to owner/staff.`
      );
      return;
    }

    const dashboardBroadcastPayload = {
      chatId,
      message: outgoingMessage, // Use the processed outgoingMessage
      websiteName,
      chatName,
      botResponse: null, // This is a human reply, not a bot response from AI
      websiteCreditCount: website.creditCount, // Ensure this is up to date
      staffId: chat.leadingStaff ? chat.leadingStaff.toString() : null,
    };

    console.log(
      "STAFFF",
      chat.leadingStaff ? chat.leadingStaff.toString() : "No leading staff"
    );
    if (website.owner) {
      if (
        dashboardUser &&
        dashboardUser.toString() === website.owner._id.toString()
      ) {
        socket.broadcast
          .to(`dashboard_${website.owner._id}`)
          .emit("new_message", dashboardBroadcastPayload);
        console.log(
          `SERVER DEBUG: Owner broadcasted 'new_message' to other owner instances.`
        );
      } else if (isStaff) {
        io.to(`dashboard_${website.owner._id}`).emit(
          "new_message",
          dashboardBroadcastPayload
        );
        console.log(
          `SERVER DEBUG: Staff emitted 'new_message' to owner dashboard.`
        );
      }
    }

    socket.broadcast
      .to(`staff_${website._id}`)
      .emit("new_message", dashboardBroadcastPayload);
    console.log(
      `SERVER DEBUG: Broadcasted 'new_message' to other staff instances in room staff_${website._id}.`
    );
  } catch (error) {
    console.error(
      `SERVER ERROR: Error handling dashboard message for chat ${chatId}:`,
      error
    );
  }
}

/**
 * Handles toggling AI responses for a chat.
 * @param {object} io - The socket.io server instance.
 * @param {object} data - The event data.
 * @param {string} staffName - The name of the staff member (if applicable).
 */
export async function handleToggleAIResponses(
  io,
  { chatId, enable, userId, isStaff, staffName }
) {
  console.log(
    `SERVER DEBUG: Received 'toggle_ai_responses' from ${
      isStaff ? "Staff" : "Dashboard"
    } (Socket ID: N/A - via handler). Chat ID: ${chatId}. Enable: ${enable}.`
  );
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.log(`SERVER DEBUG: Chat ${chatId} not found for AI toggle.`);
      return;
    }

    let isAuthorized = false;
    const website = await Website.findOne({ chats: chatId }).populate("owner");

    if (!website) {
      console.warn(
        `SERVER WARN: Website not found for chat ${chatId}. Cannot toggle AI.`
      );
      return;
    }

    if (isStaff) {
      const staffMember = await Staff.findById(userId);
      if (
        staffMember &&
        staffMember.website.toString() === website._id.toString()
      ) {
        isAuthorized = true;
      }
    } else {
      const user = await User.findById(userId);
      if (user && user.websites.includes(website._id)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      console.warn(
        `SERVER WARN: Unauthorized attempt to toggle AI for chat ${chatId} by user ${userId}.`
      );
      return;
    }

    chat.aiResponsesEnabled = enable;
    await chat.save();
    console.log(
      `SERVER DEBUG: AI responses for chat ${chatId} toggled to ${enable}.`
    );

    const togglerName = isStaff ? staffName : "the owner";

    io.to(`chat_${chat._id}`).emit("chat_update", {
      chatId: chat._id,
      aiResponsesEnabled: chat.aiResponsesEnabled,
    });

    if (website.owner) {
      io.to(`dashboard_${website.owner._id}`).emit("chat_update", {
        chatId: chat._id,
        aiResponsesEnabled: chat.aiResponsesEnabled,
        message: `AI responses ${
          enable ? "enabled" : "disabled"
        } by ${togglerName}.`,
      });
    }

    io.to(`staff_${website._id}`).emit("chat_update", {
      chatId: chat._id,
      aiResponsesEnabled: chat.aiResponsesEnabled,
      message: `AI responses ${
        enable ? "enabled" : "disabled"
      } by ${togglerName}.`,
    });
  } catch (error) {
    console.error(
      `SERVER ERROR: Error toggling AI responses via socket for chat ${chatId}:`,
      error
    );
  }
}

/**
 * Handles closing a chat from the dashboard.
 * @param {object} io - The socket.io server instance.
 * @param {object} data - The event data.
 */
export async function handleCloseChat(
  io,
  { chatId, closerId, closerType, closerName, websiteId }
) {
  console.log(
    `SERVER DEBUG: Received 'close_chat' for chat ${chatId} by ${closerType} (${closerId}).`
  );
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.error(`SERVER ERROR: Chat ${chatId} not found for closing.`);
      return;
    }

    let isAuthorized = false;
    const website = await Website.findById(websiteId).populate("owner");

    if (!website) {
      console.warn(
        `SERVER WARN: Website ${websiteId} not found for chat ${chatId}. Cannot close chat.`
      );
      return;
    }

    if (closerType === "staff") {
      const staffMember = await Staff.findById(closerId);
      if (
        staffMember &&
        staffMember.website.toString() === website._id.toString()
      ) {
        isAuthorized = true;
      }
    } else if (closerType === "owner") {
      const owner = await User.findById(closerId);
      if (owner && owner.websites.includes(website._id)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      console.warn(
        `SERVER WARN: Unauthorized attempt to close chat ${chatId} by ${closerType} ${closerId}.`
      );
      return;
    }

    chat.status = "closed";
    chat.leadingStaff = null;
    await chat.save();
    console.log(
      `SERVER DEBUG: Chat ${chatId} status updated to 'closed' in DB.`
    );

    const closureMessage = `Conversation closed by ${closerName}.`;

    const updatePayload = {
      chatId: chat._id,
      status: chat.status,
      message: closureMessage,
      sender: "system",
      leadingStaff: null,
    };

    io.to(`chat_${chatId}`).emit("chat_update", updatePayload);
    console.log(
      `SERVER DEBUG: Emitted 'chat_update' to widget for chat ${chatId} (status: closed).`
    );

    if (website.owner) {
      io.to(`dashboard_${website.owner._id.toString()}`).emit(
        "chat_update",
        updatePayload
      );
      console.log(
        `SERVER DEBUG: Emitted 'chat_update' to owner dashboard for chat ${chatId} (status: closed).`
      );
    } else {
      console.warn(
        `SERVER WARN: Website owner not found for website ${website._id}. Cannot notify owner dashboard.`
      );
    }

    io.to(`staff_${website._id}`).emit("chat_update", updatePayload);
    console.log(
      `SERVER DEBUG: Emitted 'chat_update' to staff dashboards for chat ${chatId} (status: closed).`
    );
  } catch (error) {
    console.error(
      `SERVER ERROR: Error handling close_chat for chat ${chatId}:`,
      error
    );
  }
}

/**
 * Handles assigning a chat lead from the dashboard.
 * @param {object} io - The socket.io server instance.
 * @param {object} data - The event data.
 */
export async function handleAssignChatLead(
  io,
  { chatId, assigneeId, assigneeName, assigneeType, websiteId }
) {
  console.log(
    `SERVER DEBUG: Received 'assign_chat_lead' for chat ${chatId} to ${assigneeType} (${assigneeName}).`
  );
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.error(`SERVER ERROR: Chat ${chatId} not found for assignment.`);
      return;
    }

    let isAuthorizedAssignee = false;
    const website = await Website.findById(websiteId).populate("owner");

    if (!website) {
      console.warn(
        `SERVER WARN: Website ${websiteId} not found for chat ${chatId}. Cannot assign lead.`
      );
      return;
    }

    if (assigneeType === "staff") {
      const staffMember = await Staff.findById(assigneeId);
      if (
        staffMember &&
        staffMember.website.toString() === website._id.toString()
      ) {
        isAuthorizedAssignee = true;
      }
    } else if (assigneeType === "owner") {
      const owner = await User.findById(assigneeId);
      if (owner && owner.websites.includes(website._id)) {
        isAuthorizedAssignee = true;
      }
    }

    if (!isAuthorizedAssignee) {
      console.warn(
        `SERVER WARN: Unauthorized assignee ${assigneeId} attempting to lead chat ${chatId}.`
      );
      return;
    }

    chat.leadingStaff = assigneeId;
    chat.aiResponsesEnabled = false; // When staff joins, automatically turn off AI responses
    await chat.save();
    console.log(
      `SERVER DEBUG: Chat ${chatId} assigned to ${assigneeName} and AI turned OFF in DB.`
    );

    const assignmentMessageForWidget = `${assigneeName} has joined the conversation.`;
    const systemMessage = {
      sender: "bot",
      text: assignmentMessageForWidget,
      timestamp: new Date().toISOString(),
    };

    const messages = JSON.parse(chat.messages || "[]");
    messages.push(systemMessage);
    await Chat.findByIdAndUpdate(chatId, {
      messages: JSON.stringify(messages),
    });
    console.log(
      `SERVER DEBUG: System message added to DB for chat ${chatId}: "${assignmentMessageForWidget}".`
    );

    const dashboardUpdatePayload = {
      chatId: chat._id,
      message: assignmentMessageForWidget,
      sender: "system",
      leadingStaff: { _id: assigneeId, name: assigneeName },
      aiResponsesEnabled: chat.aiResponsesEnabled,
    };

    io.to(`chat_${chatId}`).emit("reply", {
      text: assignmentMessageForWidget,
      sender: "bot",
      timestamp: systemMessage.timestamp,
    });
    io.to(`chat_${chatId}`).emit("chat_update", {
      chatId: chat._id,
      aiResponsesEnabled: chat.aiResponsesEnabled,
    });
    console.log(
      `SERVER DEBUG: Emitted 'reply' and 'chat_update' to widget for chat ${chatId} (assigned, AI off).`
    );

    if (website.owner) {
      io.to(`dashboard_${website.owner._id.toString()}`).emit(
        "chat_update",
        dashboardUpdatePayload
      );
      console.log(
        `SERVER DEBUG: Emitted 'chat_update' to owner dashboard for chat ${chatId} (assigned).`
      );
    }

    io.to(`staff_${website._id}`).emit("chat_update", dashboardUpdatePayload);
    console.log(
      `SERVER DEBUG: Emitted 'chat_update' to staff dashboards for chat ${chatId} (assigned).`
    );
  } catch (error) {
    console.error(
      `SERVER ERROR: Error assigning chat lead for chat ${chatId}:`,
      error
    );
  }
}

/**
 * Handles unassigning a chat lead from the dashboard.
 * @param {object} io - The socket.io server instance.
 * @param {object} data - The event data.
 */
export async function handleUnassignChatLead(
  io,
  { chatId, assigneeId, assigneeType, websiteId }
) {
  console.log(
    `SERVER DEBUG: Received 'unassign_chat_lead' for chat ${chatId} by ${assigneeType} (${assigneeId}).`
  );
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.error(`SERVER ERROR: Chat ${chatId} not found for unassignment.`);
      return;
    }

    let isAuthorizedUnassigner = false;
    const website = await Website.findById(websiteId).populate("owner");

    if (!website) {
      console.warn(
        `SERVER WARN: Website ${websiteId} not found for chat ${chatId}. Cannot unassign lead.`
      );
      return;
    }

    let formerAssigneeName = "A staff member";
    if (chat.leadingStaff) {
      const formerStaff = await Staff.findById(chat.leadingStaff);
      if (formerStaff) {
        formerAssigneeName = formerStaff.name;
      }
    }

    if (chat.leadingStaff) {
      if (chat.leadingStaff.toString() === assigneeId) {
        isAuthorizedUnassigner = true;
      } else if (
        assigneeType === "owner" &&
        website.owner &&
        website.owner._id.toString() === assigneeId
      ) {
        isAuthorizedUnassigner = true;
      }
    } else {
      if (
        assigneeType === "owner" &&
        website.owner &&
        website.owner._id.toString() === assigneeId
      ) {
        isAuthorizedUnassigner = true;
      }
      const staffMember = await Staff.findById(assigneeId);
      if (
        staffMember &&
        staffMember.website.toString() === website._id.toString()
      ) {
        isAuthorizedUnassigner = true;
      }
    }

    if (!isAuthorizedUnassigner) {
      console.warn(
        `SERVER WARN: Unauthorized user ${assigneeId} attempting to unassign lead from chat ${chatId}.`
      );
      return;
    }

    chat.leadingStaff = null;
    await chat.save();
    console.log(`SERVER DEBUG: Chat ${chatId} lead unassigned in DB.`);

    const unassignmentMessageForWidget = `${formerAssigneeName} has left the conversation.`;
    const systemMessage = {
      sender: "bot",
      text: unassignmentMessageForWidget,
      timestamp: new Date().toISOString(),
    };

    const messages = JSON.parse(chat.messages || "[]");
    messages.push(systemMessage);
    await Chat.findByIdAndUpdate(chatId, {
      messages: JSON.stringify(messages),
    });
    console.log(
      `SERVER DEBUG: System message added to DB for chat ${chatId}: "${unassignmentMessageForWidget}".`
    );

    const dashboardUpdatePayload = {
      chatId: chat._id,
      message: unassignmentMessageForWidget,
      sender: "system",
      leadingStaff: null,
    };

    io.to(`chat_${chatId}`).emit("reply", {
      text: unassignmentMessageForWidget,
      sender: "bot",
      timestamp: systemMessage.timestamp,
    });
    console.log(
      `SERVER DEBUG: Emitted 'reply' to widget for chat ${chatId} (unassigned, with bot message).`
    );

    if (website.owner) {
      io.to(`dashboard_${website.owner._id.toString()}`).emit(
        "chat_update",
        dashboardUpdatePayload
      );
      console.log(
        `SERVER DEBUG: Emitted 'chat_update' to owner dashboard for chat ${chatId} (unassigned).`
      );
    }

    io.to(`staff_${website._id}`).emit("chat_update", dashboardUpdatePayload);
    console.log(
      `SERVER DEBUG: Emitted 'chat_update' to staff dashboards for chat ${chatId} (unassigned).`
    );
  } catch (error) {
    console.error(
      `SERVER ERROR: Error unassigning chat lead for chat ${chatId}:`,
      error
    );
  }
}
