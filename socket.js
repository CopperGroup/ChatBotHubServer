// socket.js
import Chat from "./models/chat.js"
import Website from "./models/website.js"
import User from "./models/user.js"
import { PlanValidator } from "./services/plan-validator.js"
import Staff from "./models/staff.js" // Import the Staff model

const AI_URL = process.env.AI_URL
// Helper function to send Telegram notifications via webhook
async function sendTelegramNotification(payload) {
    const TELEGRAM_BOT_URL = process.env.TELEGRAM_BOT_URL;
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

export function handleSocket(socket, io) {
    const chatbotCode = socket.handshake.query.chatbotCode
    const origin = socket.handshake.headers.origin
    const dashboardUser = socket.handshake.query.dashboardUser
    const staffId = socket.handshake.query.staffId
    const websiteId = socket.handshake.query.websiteId
    const isStaff = socket.handshake.query.isStaff === "true"
    const staffName = socket.handshake.query.staffName || "Unknown Staff";

    console.log(
        `SERVER DEBUG: New connection established. Socket ID: ${socket.id}. Type: ${dashboardUser ? 'Dashboard' : isStaff ? 'Staff' : 'Widget'}. User/Staff ID: ${dashboardUser || staffId || 'N/A'}. Chatbot Code: ${chatbotCode || 'N/A'}.`,
    )
    console.log(`SERVER DEBUG: Socket ${socket.id} joined rooms on connect: ${Array.from(socket.rooms).join(', ')}`);


    socket.on("new_staff_added", async ({ websiteId, newStaff }) => {
        try {
            const website = await Website.findById(websiteId).populate('owner');
            if (!website) return;

            const payload = {
                websiteId,
                message: `A new staff member, ${newStaff.name}, has been added to ${website.name}.`,
                staff: newStaff
            };

            if (website.owner) {
                io.to(`dashboard_${website.owner._id}`).emit("staff_added", payload);
            }
            socket.broadcast.to(`staff_${websiteId}`).emit("staff_added", payload);

            console.log(`SERVER DEBUG: Emitted 'staff_added' for website ${websiteId}.`);
        } catch (error) {
            console.error(`SERVER ERROR: Failed to process new_staff_added event:`, error);
        }
    });

    socket.on("disconnect", (reason) => {
        console.log(`SERVER DEBUG: Socket ID: ${socket.id} disconnected. Reason: ${reason}.`);
    });

    if (dashboardUser || isStaff) {

        if (dashboardUser) {
            socket.join(`dashboard_${dashboardUser}`)
            console.log(`SERVER DEBUG: Dashboard user ${dashboardUser} joined room dashboard_${dashboardUser}.`)
        }
        if (isStaff && websiteId) {
            socket.join(`staff_${websiteId}`)
            console.log(`SERVER DEBUG: Staff user ${staffId} for website ${websiteId} joined room staff_${websiteId}.`)
        }

        socket.on("dashboard_message", async (data) => {
            const { chatId, message, websiteName, chatName } = data
            console.log(`SERVER DEBUG: Received 'dashboard_message' from ${message.sender} (Socket ID: ${socket.id}). Chat ID: ${chatId}.`);

            try {
                const chat = await Chat.findById(chatId)
                if (!chat) {
                    console.error(`SERVER ERROR: Chat ${chatId} not found for dashboard message.`)
                    return
                }

                const messages = JSON.parse(chat.messages || "[]")

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
                if (message.sender && typeof message.sender === 'string') {
                    if (message.sender.startsWith('staff-')) {
                        widgetSender = message.sender;
                        actualSenderName = message.sender.substring(6); // Extract name after 'staff-'
                    } else if (message.sender.startsWith('owner')) { // In case the dashboard sends "owner-Name"
                        widgetSender = `owner`; // Convert to staff- format
                        actualSenderName = 'Owner';
                    }
                }
                
                const outgoingMessage = {
                    sender: widgetSender,
                    text: message.text,
                    timestamp: message.timestamp || new Date().toISOString(),
                };

                messages.push(outgoingMessage)

                const roomSockets = await io.in(`chat_${chatId}`).allSockets();
                console.log(`SERVER DEBUG: Sockets in room chat_${chatId} before emitting 'reply': ${Array.from(roomSockets).join(', ')}`);

                io.to(`chat_${chatId}`).emit("reply", { text: outgoingMessage.text, sender: outgoingMessage.sender, timestamp: outgoingMessage.timestamp, chatId })
                console.log(`SERVER DEBUG: Emitted 'reply' to widget (chat_${chatId}). Sender: ${outgoingMessage.sender}.`);

                const website = await Website.findOne({chats: chatId}).populate('owner');
                if (!website) {
                    console.warn(`SERVER WARN: Website not found for chat ${chatId}. Cannot broadcast to owner/staff.`);
                    return;
                }

                const dashboardBroadcastPayload = {
                    chatId,
                    message: outgoingMessage, // Use the processed outgoingMessage
                    websiteName,
                    chatName,
                    botResponse: null, // This is a human reply, not a bot response from AI
                    websiteCreditCount: website.creditCount, // Ensure this is up to date
                    staffId: chat.leadingStaff.toString()
                };

                console.log("STAFFF", chat.leadingStaff.toString())
                if (website.owner) {
                    if (dashboardUser && dashboardUser.toString() === website.owner._id.toString()) {
                        socket.broadcast.to(`dashboard_${website.owner._id}`).emit("new_message", dashboardBroadcastPayload);
                        console.log(`SERVER DEBUG: Owner broadcasted 'new_message' to other owner instances.`);
                    } else if (isStaff) {
                        io.to(`dashboard_${website.owner._id}`).emit("new_message", dashboardBroadcastPayload);
                        console.log(`SERVER DEBUG: Staff emitted 'new_message' to owner dashboard.`);
                    }
                }

                socket.broadcast.to(`staff_${website._id}`).emit("new_message", dashboardBroadcastPayload);
                console.log(`SERVER DEBUG: Broadcasted 'new_message' to other staff instances in room staff_${website._id}.`);

                // REMOVED: Telegram notification for dashboard_message (staff/owner replies)
                // It should only trigger for user messages from the widget.

                console.log(`SERVER DEBUG: Dashboard/Staff message handled successfully for chat_${chatId}.`);
            } catch (error) {
                console.error(`SERVER ERROR: Error handling dashboard message for chat ${chatId}:`, error);
            }
        })

        socket.on("toggle_ai_responses", async ({ chatId, enable, userId, isStaff }) => {
            console.log(`SERVER DEBUG: Received 'toggle_ai_responses' from ${isStaff ? 'Staff' : 'Dashboard'} (Socket ID: ${socket.id}). Chat ID: ${chatId}. Enable: ${enable}.`);
            try {
                const chat = await Chat.findById(chatId)
                if (!chat) {
                    console.log(`SERVER DEBUG: Chat ${chatId} not found for AI toggle.`)
                    return
                }

                let isAuthorized = false;
                const website = await Website.findOne({chats: chatId}).populate('owner');
                
                if (!website) {
                    console.warn(`SERVER WARN: Website not found for chat ${chatId}. Cannot toggle AI.`);
                    return;
                }

                if (isStaff) {
                    const staffMember = await Staff.findById(userId);
                    if (staffMember && staffMember.website.toString() === website._id.toString()) {
                        isAuthorized = true;
                    }
                } else {
                    console.log("Else")
                    const user = await User.findById(userId);
                    console.log(user, user.websites, website._id)
                    if (user && user.websites.includes(website._id)) {
                        isAuthorized = true;
                    }
                }

                if (!isAuthorized) {
                    console.warn(`SERVER WARN: Unauthorized attempt to toggle AI for chat ${chatId} by user ${userId}.`);
                    return;
                }

                chat.aiResponsesEnabled = enable
                await chat.save()
                console.log(`SERVER DEBUG: AI responses for chat ${chatId} toggled to ${enable}.`)

                const toggleMessage = `AI responses ${enable ? "enabled" : "disabled"} by support.`
                io.to(`chat_${chat._id}`).emit("chat_update", {
                    chatId: chat._id,
                    aiResponsesEnabled: chat.aiResponsesEnabled,
                })

                const togglerName = isStaff ? staffName : 'the owner';

                if (website.owner) {
                    io.to(`dashboard_${website.owner._id}`).emit("chat_update", {
                        chatId: chat._id,
                        aiResponsesEnabled: chat.aiResponsesEnabled,
                        message: `AI responses ${enable ? "enabled" : "disabled"} by ${togglerName}.`,
                    });
                }

                io.to(`staff_${website._id}`).emit("chat_update", {
                    chatId: chat._id,
                    aiResponsesEnabled: chat.aiResponsesEnabled,
                    message: `AI responses ${enable ? "enabled" : "disabled"} by ${togglerName}.`,
                })
            } catch (error) {
                console.error(`SERVER ERROR: Error toggling AI responses via socket for chat ${chatId}:`, error)
            }
        })

        socket.on("close_chat", async ({ chatId, closerId, closerType, closerName, websiteId }) => {
            console.log(`SERVER DEBUG: Received 'close_chat' for chat ${chatId} by ${closerType} (${closerId}).`);
            try {
                const chat = await Chat.findById(chatId);
                if (!chat) {
                    console.error(`SERVER ERROR: Chat ${chatId} not found for closing.`);
                    return;
                }

                let isAuthorized = false;
                const website = await Website.findById(websiteId).populate('owner');

                if (!website) {
                    console.warn(`SERVER WARN: Website ${websiteId} not found for chat ${chatId}. Cannot close chat.`);
                    return;
                }

                if (closerType === 'staff') {
                    const staffMember = await Staff.findById(closerId);
                    if (staffMember && staffMember.website.toString() === website._id.toString()) {
                        isAuthorized = true;
                    }
                } else if (closerType === 'owner') {
                    const owner = await User.findById(closerId);
                    if (owner && owner.websites.includes(website._id)) {
                        isAuthorized = true;
                    }
                }

                if (!isAuthorized) {
                    console.warn(`SERVER WARN: Unauthorized attempt to close chat ${chatId} by ${closerType} ${closerId}.`);
                    return;
                }

                chat.status = 'closed';
                chat.leadingStaff = null;
                await chat.save();
                console.log(`SERVER DEBUG: Chat ${chatId} status updated to 'closed' in DB.`);

                const closureMessage = `Conversation closed by ${closerName}.`;

                const updatePayload = {
                    chatId: chat._id,
                    status: chat.status,
                    message: closureMessage,
                    sender: "system",
                    leadingStaff: null
                };

                io.to(`chat_${chatId}`).emit("chat_update", updatePayload);
                console.log(`SERVER DEBUG: Emitted 'chat_update' to widget for chat ${chatId} (status: closed).`);

                if (website.owner) {
                    io.to(`dashboard_${website.owner._id.toString()}`).emit("chat_update", updatePayload);
                    console.log(`SERVER DEBUG: Emitted 'chat_update' to owner dashboard for chat ${chatId} (status: closed).`);
                } else {
                    console.warn(`SERVER WARN: Website owner not found for website ${website._id}. Cannot notify owner dashboard.`);
                }

                io.to(`staff_${website._id}`).emit("chat_update", updatePayload);
                console.log(`SERVER DEBUG: Emitted 'chat_update' to staff dashboards for chat ${chatId} (status: closed).`);

            } catch (error) {
                console.error(`SERVER ERROR: Error handling close_chat for chat ${chatId}:`, error);
            }
        });

        socket.on("assign_chat_lead", async ({ chatId, assigneeId, assigneeName, assigneeType, websiteId }) => {
            console.log(`SERVER DEBUG: Received 'assign_chat_lead' for chat ${chatId} to ${assigneeType} (${assigneeName}).`);
            try {
                const chat = await Chat.findById(chatId);
                if (!chat) {
                    console.error(`SERVER ERROR: Chat ${chatId} not found for assignment.`);
                    return;
                }

                let isAuthorizedAssignee = false;
                const website = await Website.findById(websiteId).populate('owner');

                if (!website) {
                    console.warn(`SERVER WARN: Website ${websiteId} not found for chat ${chatId}. Cannot assign lead.`);
                    return;
                }

                if (assigneeType === 'staff') {
                    const staffMember = await Staff.findById(assigneeId);
                    if (staffMember && staffMember.website.toString() === website._id.toString()) {
                        isAuthorizedAssignee = true;
                    }
                } else if (assigneeType === 'owner') {
                    const owner = await User.findById(assigneeId);
                    if (owner && owner.websites.includes(website._id)) {
                        isAuthorizedAssignee = true;
                    }
                }

                if (!isAuthorizedAssignee) {
                    console.warn(`SERVER WARN: Unauthorized assignee ${assigneeId} attempting to lead chat ${chatId}.`);
                    return;
                }

                chat.leadingStaff = assigneeId;
                // When staff joins, automatically turn off AI responses for the chat
                chat.aiResponsesEnabled = false;
                await chat.save();
                console.log(`SERVER DEBUG: Chat ${chatId} assigned to ${assigneeName} and AI turned OFF in DB.`);

                const assignmentMessageForWidget = `${assigneeName} has joined the conversation.`;
                const systemMessage = {
                    sender: "bot",
                    text: assignmentMessageForWidget,
                    timestamp: new Date().toISOString(),
                };

                const messages = JSON.parse(chat.messages || "[]");
                messages.push(systemMessage);
                await Chat.findByIdAndUpdate(chatId, { messages: JSON.stringify(messages) });
                console.log(`SERVER DEBUG: System message added to DB for chat ${chatId}: "${assignmentMessageForWidget}".`);

                const dashboardUpdatePayload = {
                    chatId: chat._id,
                    message: assignmentMessageForWidget,
                    sender: "system",
                    leadingStaff: { _id: assigneeId, name: assigneeName },
                    aiResponsesEnabled: chat.aiResponsesEnabled
                };

                io.to(`chat_${chatId}`).emit("reply", {
                    text: assignmentMessageForWidget,
                    sender: "bot",
                    timestamp: systemMessage.timestamp
                });
                io.to(`chat_${chatId}`).emit("chat_update", {
                    chatId: chat._id,
                    aiResponsesEnabled: chat.aiResponsesEnabled,
                });
                console.log(`SERVER DEBUG: Emitted 'reply' and 'chat_update' to widget for chat ${chatId} (assigned, AI off).`);


                if (website.owner) {
                    io.to(`dashboard_${website.owner._id.toString()}`).emit("chat_update", dashboardUpdatePayload);
                    console.log(`SERVER DEBUG: Emitted 'chat_update' to owner dashboard for chat ${chatId} (assigned).`);
                }

                io.to(`staff_${website._id}`).emit("chat_update", dashboardUpdatePayload);
                console.log(`SERVER DEBUG: Emitted 'chat_update' to staff dashboards for chat ${chatId} (assigned).`);

            } catch (error) {
                console.error(`SERVER ERROR: Error assigning chat lead for chat ${chatId}:`, error);
            }
        });

        socket.on("unassign_chat_lead", async ({ chatId, assigneeId, assigneeType, websiteId }) => {
            console.log(`SERVER DEBUG: Received 'unassign_chat_lead' for chat ${chatId} by ${assigneeType} (${assigneeId}).`);
            try {
                const chat = await Chat.findById(chatId);
                if (!chat) {
                    console.error(`SERVER ERROR: Chat ${chatId} not found for unassignment.`);
                    return;
                }

                let isAuthorizedUnassigner = false;
                const website = await Website.findById(websiteId).populate('owner');

                if (!website) {
                    console.warn(`SERVER WARN: Website ${websiteId} not found for chat ${chatId}. Cannot unassign lead.`);
                    return;
                }

                let formerAssigneeName = 'A staff member';
                if (chat.leadingStaff) {
                    const formerStaff = await Staff.findById(chat.leadingStaff);
                    if (formerStaff) {
                        formerAssigneeName = formerStaff.name;
                    }
                }


                if (chat.leadingStaff) {
                    if (chat.leadingStaff.toString() === assigneeId) {
                        isAuthorizedUnassigner = true;
                    } else if (assigneeType === 'owner' && website.owner && website.owner._id.toString() === assigneeId) {
                        isAuthorizedUnassigner = true;
                    }
                } else {
                    if (assigneeType === 'owner' && website.owner && website.owner._id.toString() === assigneeId) {
                        isAuthorizedUnassigner = true;
                    }
                    const staffMember = await Staff.findById(assigneeId);
                    if (staffMember && staffMember.website.toString() === website._id.toString()){
                        isAuthorizedUnassigner = true;
                    }
                }

                if (!isAuthorizedUnassigner) {
                    console.warn(`SERVER WARN: Unauthorized user ${assigneeId} attempting to unassign lead from chat ${chatId}.`);
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
                await Chat.findByIdAndUpdate(chatId, { messages: JSON.stringify(messages) });
                console.log(`SERVER DEBUG: System message added to DB for chat ${chatId}: "${unassignmentMessageForWidget}".`);

                const dashboardUpdatePayload = {
                    chatId: chat._id,
                    message: unassignmentMessageForWidget,
                    sender: "system",
                    leadingStaff: null
                };

                io.to(`chat_${chatId}`).emit("reply", {
                    text: unassignmentMessageForWidget,
                    sender: "bot",
                    timestamp: systemMessage.timestamp
                });
                console.log(`SERVER DEBUG: Emitted 'reply' to widget for chat ${chatId} (unassigned, with bot message).`);

                if (website.owner) {
                    io.to(`dashboard_${website.owner._id.toString()}`).emit("chat_update", dashboardUpdatePayload);
                    console.log(`SERVER DEBUG: Emitted 'chat_update' to owner dashboard for chat ${chatId} (unassigned).`);
                }

                io.to(`staff_${website._id}`).emit("chat_update", dashboardUpdatePayload);
                console.log(`SERVER DEBUG: Emitted 'chat_update' to staff dashboards for chat ${chatId} (unassigned).`);

            } catch (error) {
                console.error(`SERVER ERROR: Error unassigning chat lead for chat ${chatId}:`, error);
            }
        });

        return
    }

    if (!chatbotCode) {
        console.log("SERVER DEBUG: No chatbotCode provided for widget, disconnecting socket.")
        socket.disconnect(true)
        return
    }

    Website.findOne({ chatbotCode })
        .populate("plan")
        .then(async (website) => {
            if (!website) {
                console.log(`SERVER DEBUG: Website with chatbotCode ${chatbotCode} not found, disconnecting socket.`)
                socket.disconnect(true)
                return
            }

            const websiteLink = website.link.endsWith("/") ? website.link.slice(0, -1) : website.link
            const requestOrigin = origin ? (origin.endsWith("/") ? origin.slice(0, -1) : origin) : ""

            if (websiteLink !== requestOrigin) {
                console.log(
                    `SERVER WARN: Socket connection: Origin mismatch for chatbotCode ${chatbotCode}. Expected: ${website.link}, Got: ${origin}. Disconnecting.`,
                )
                socket.disconnect(true)
                return
            }

            console.log(`SERVER DEBUG: Widget connection allowed for chatbotCode: ${chatbotCode} from origin: ${origin}.`)

            const websiteOwner = await User.findOne({ websites: website._id })

            socket.on("create_new_chat", async (data) => {
                const { email } = data
                console.log(`SERVER DEBUG: Received 'create_new_chat' from Widget (Socket ID: ${socket.id}). Email: ${email}.`);

                try {
                    const aiValidation = await PlanValidator.validateAIUsage(website._id)

                    const newChat = new Chat({
                        chatbotCode,
                        email,
                        website: website._id,
                        name: "New Conversation",
                        status: "open",
                        aiResponsesEnabled: aiValidation.planAllowsAI && aiValidation.isValid,
                    })
                    await newChat.save()
                    console.log(`SERVER DEBUG: New chat ${newChat._id} created in DB. AI enabled: ${newChat.aiResponsesEnabled}.`);

                    website.chats.push(newChat._id)
                    await website.save()
                    console.log(`SERVER DEBUG: Chat ${newChat._id} linked to Website ${website._id}.`);

                    const rooms = Array.from(socket.rooms)
                    rooms.forEach((room) => {
                        if (room.startsWith("chat_")) {
                            socket.leave(room)
                        }
                    })
                    socket.join(`chat_${newChat._id}`)
                    console.log(`SERVER DEBUG: Widget client ${socket.id} joined new chat room: chat_${newChat._id}. Current rooms: ${Array.from(socket.rooms).join(', ')}`);


                    socket.emit("new_chat_data", { chat: newChat })
                    console.log(`SERVER DEBUG: Emitted 'new_chat_data' to originating widget for chat: ${newChat._id}.`);

                    let initialBotMessageText
                    if (newChat.aiResponsesEnabled && website.preferences?.allowAIResponses) {
                        initialBotMessageText = `Hi! What is your name?`
                    } else {
                        initialBotMessageText = `Welcome! AI responses are currently disabled for this chat. Please provide your name, and a human agent will assist you shortly.`
                    }

                    // *** TYPING INDICATOR LOGIC FOR INITIAL BOT MESSAGE ***
                    socket.emit("bot_typing_start"); // Bot is preparing response
                    
                    console.log(`SERVER DEBUG: Emitted 'bot_typing_start' for initial bot message.`);
                    // *******************************************************

                    const initialBotMessage = { sender: "bot", text: initialBotMessageText, timestamp: new Date().toISOString() }

                    const messages = JSON.parse(newChat.messages || "[]")
                    messages.push(initialBotMessage)
                    await Chat.findByIdAndUpdate(newChat._id, { messages: JSON.stringify(messages) })
                    console.log(`SERVER DEBUG: Initial bot message saved to DB for chat ${newChat._id}.`);

                    socket.emit("reply", { text: initialBotMessageText, sender: "bot", timestamp: initialBotMessage.timestamp })
                    console.log(`SERVER DEBUG: Emitted initial 'reply' to widget for chat: ${newChat._id}. Sender: bot.`);

                    // *** TYPING INDICATOR LOGIC FOR INITIAL BOT MESSAGE ***
                    socket.emit("bot_typing_stop"); // Bot has sent response
                    console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' after initial bot message.`);
                    // *******************************************************

                    if (websiteOwner) {
                        const newChatPayload = {
                            chat: {
                                _id: newChat._id,
                                name: newChat.name,
                                email: newChat.email,
                                status: newChat.status,
                                createdAt: newChat.createdAt,
                                updatedAt: new Date().toISOString(),
                                messages: JSON.stringify(messages),
                                aiResponsesEnabled: newChat.aiResponsesEnabled,
                            },
                            websiteName: website.name,
                        };
                        io.to(`dashboard_${websiteOwner._id}`).emit("new_chat", newChatPayload)
                        console.log(`SERVER DEBUG: Notified owner dashboard about new chat ${newChat._id}.`);

                        io.to(`dashboard_${websiteOwner._id}`).emit("new_message", {
                            chatId: newChat._id,
                            message: null,
                            websiteName: website.name,
                            chatName: newChat.name,
                            botResponse: initialBotMessage,
                            websiteCreditCount: website.creditCount,
                        });
                    }

                    io.to(`staff_${website._id}`).emit("new_chat", {
                        chat: {
                            _id: newChat._id,
                            name: newChat.name,
                            email: newChat.email,
                            status: newChat.status,
                            createdAt: newChat.createdAt,
                            updatedAt: new Date().toISOString(),
                            messages: JSON.stringify(messages),
                            aiResponsesEnabled: newChat.aiResponsesEnabled,
                        },
                        websiteName: website.name,
                    });
                    console.log(`SERVER DEBUG: Notified staff dashboards about new chat ${newChat._id}.`);

                    io.to(`staff_${website._id}`).emit("new_message", {
                        chatId: newChat._id,
                        message: null,
                        websiteName: website.name,
                        chatName: newChat.name,
                        botResponse: initialBotMessage,
                        websiteCreditCount: website.creditCount,
                    });
                    console.log(`SERVER DEBUG: Notified staff dashboards about initial bot message for new chat ${newChat._id}.`);

                } catch (error) {
                    console.error("SERVER ERROR: Error in create_new_chat handler:", error)
                    socket.emit("reply", { text: "Error starting new conversation.", sender: "bot", timestamp: new Date().toISOString(), chatId: newChat._id})
                    socket.emit("bot_typing_stop")
                }
            })

            socket.on("join_chat", async ({ chatId }) => {
                console.log(`SERVER DEBUG: Received 'join_chat' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}.`);
                const rooms = Array.from(socket.rooms)
                rooms.forEach((room) => {
                    if (room.startsWith("chat_")) {
                        socket.leave(room)
                    }
                })

                socket.join(`chat_${chatId}`)
                console.log(`SERVER DEBUG: Widget client ${socket.id} re-joined existing chat room: chat_${chatId}. Current rooms: ${Array.from(socket.rooms).join(', ')}`);
            })

            socket.on("message", async ({ chatId, email, message, currentWebsiteURL: clientUrlFromMessage }) => {
                console.log(
                    `SERVER DEBUG: Received 'message' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}. Text: "${message}". Email: ${email}. URL: ${clientUrlFromMessage || "N/A"}.`,
                )

                try {
                    const chat = await Chat.findById(chatId)
                    if (!chat) {
                        socket.emit("reply", { text: "Error: Chat not found.", sender: "bot", timestamp: new Date().toISOString() })
                        console.error(`SERVER ERROR: Chat with ID ${chatId} not found.`)
                        return
                    }

                    // Ensure widget is in the correct room, even if it wasn't on initial connect for some reason
                    if (!Array.from(socket.rooms).includes(`chat_${chatId}`)) {
                           socket.join(`chat_${chatId}`);
                           console.log(`SERVER DEBUG: Widget client ${socket.id} forcefully joined chat room: chat_${chatId} on message. Current rooms: ${Array.from(socket.rooms).join(', ')}`);
                    }


                    const messages = JSON.parse(chat.messages || "[]")

                    const userMessage = {
                        sender: "user",
                        text: message,
                        timestamp: new Date().toISOString(),
                        url: clientUrlFromMessage,
                    }
                    messages.push(userMessage)

                    let botResponseText = null
                    let senderTypeForResponse = "bot"
                    let botMessage = null;

                    if (messages.length === 2 && chat.name === "New Conversation") {
                        chat.name = message
                        botResponseText = `Thank you, ${message}! How can I help you today?`
                        senderTypeForResponse = "bot"
                        console.log(`SERVER DEBUG: Chat ${chatId} named: "${chat.name}".`);

                        // *** TYPING INDICATOR LOGIC FOR NAMING RESPONSE ***
                        socket.emit("bot_typing_start"); // Bot is preparing response
                        console.log(`SERVER DEBUG: Emitted 'bot_typing_start' for naming response.`);
                        // ****************************************************

                    }
                    else if (
                        website.plan.allowAI &&
                        website.creditCount > 0 &&
                        chat.aiResponsesEnabled &&
                        website.preferences && website.preferences.allowAIResponses
                    ) {
                        const isChatNamed = chat.name !== "New Conversation"
                        if ((isChatNamed && messages.length >= 1) || messages.length > 2) {
                            try {
                                socket.emit("bot_typing_start") // This is already here for AI call
                                console.log("SERVER DEBUG: Emitted 'bot_typing_start' for AI call.")

                                console.log(`SERVER DEBUG: Calling AI service at ${AI_URL}/chat for chat ${chatId}...`)
                                const aiResponse = await fetch(`${AI_URL}/chat`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        chatbotCode: chatbotCode,
                                        chatId: chatId,
                                        prompt: message,
                                    }),
                                })

                                if (aiResponse.ok) {
                                    const aiData = await aiResponse.json()
                                    console.log("SERVER DEBUG: AI Response Data:", aiData)
                                    botResponseText = aiData.response
                                    senderTypeForResponse = "ai"
                                    website.creditCount -= 1
                                    await website.save()
                                    console.log(`SERVER DEBUG: AI response received. Credits left: ${website.creditCount}.`);
                                } else {
                                    console.error(`SERVER ERROR: AI server responded with status: ${aiResponse.status} - ${aiResponse.statusText}.`)
                                }
                            } catch (aiError) {
                                console.error("SERVER ERROR: Error communicating with AI server:", aiError)
                            } finally {
                                socket.emit("bot_typing_stop") // Stays here for AI responses
                                console.log("SERVER DEBUG: Emitted 'bot_typing_stop' after AI call.")
                            }
                        } else {
                            console.log("SERVER DEBUG: AI not engaged due to message count threshold or name setting phase.")
                        }
                    }
                    else if (website.preferences && website.preferences.allowAIResponses === false) {
                        console.log("SERVER DEBUG: AI not engaged: AI responses explicitly disabled via website preferences.");
                        // ****************************************************************
                    }
                    else if (!website.plan.allowAI) {
                        console.log("SERVER DEBUG: AI not engaged: Plan does not allow AI.")
                        // *******************************************************************
                    } else if (website.creditCount <= 0) {
                        console.log("SERVER DEBUG: AI not engaged: Insufficient credits.")
                        // ******************************************************************
                    } else if (!chat.aiResponsesEnabled) {
                        console.log("SERVER DEBUG: AI not engaged: AI responses explicitly disabled for this chat.")
                        // ********************************************************************
                    } else {
                        console.log("SERVER DEBUG: Default response sent (AI not active).")
                        // **************************************************************
                    }

                    if (botResponseText) {
                        botMessage = { sender: senderTypeForResponse, text: botResponseText, timestamp: new Date().toISOString() }
                        messages.push(botMessage)
                    }

                    await Chat.findByIdAndUpdate(chatId, {
                        messages: JSON.stringify(messages),
                        name: chat.name,
                    })
                    console.log(`SERVER DEBUG: Messages saved to DB for chat ${chatId}.`);

                    if (botMessage) {
                        socket.emit("reply", { text: botMessage.text, sender: botMessage.sender, timestamp: botMessage.timestamp })
                        console.log(`SERVER DEBUG: Emitted 'reply' to widget. Sender: ${botMessage.sender}. Text: "${botMessage.text}".`);
                    }

                    // *** TYPING INDICATOR LOGIC FOR NON-AI BOT MESSAGES ***
                    // Only stop typing if a bot message (AI or otherwise) was sent and it's not handled by AI's finally block
                    if (botMessage && senderTypeForResponse !== "ai") { // If it's a botMessage AND NOT an AI response (AI has its own finally block)
                        socket.emit("bot_typing_stop"); // Stop typing after bot reply
                        console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' after sending non-AI botMessage.`);
                    }
                    // *******************************************************


                    const messagePayload = {
                        chatId,
                        message: userMessage,
                        websiteName: website.name,
                        chatName: chat.name,
                        botResponse: botMessage,
                        websiteCreditCount: website.creditCount,
                        staffId: chat.leadingStaff ? chat.leadingStaff.toString() : ""
                    };

                    if (websiteOwner) {
                        io.to(`dashboard_${websiteOwner._id}`).emit("new_message", messagePayload);
                        console.log(`SERVER DEBUG: Notified owner dashboard about user message and bot response for chat ${chatId}.`);
                    }

                    io.to(`staff_${website._id}`).emit("new_message", messagePayload);
                    console.log(`SERVER DEBUG: Notified staff dashboards about user message and bot response for chat ${chatId}.`);

                    // Send Telegram notification for new widget message to ALL staff
                    // This notification will only be triggered for user messages from the widget
                    if (userMessage) { // Ensure it's a message from the user/widget
                      const shouldNotifyOwnerTelegram = websiteOwner && websiteOwner.preferences && websiteOwner.preferences.telegram;

                      sendTelegramNotification({
                          message: `New message from ${chat.name} on ${website.name}: "${userMessage.text}"`,
                          websiteId: website._id.toString(), // Pass websiteId for context
                          notifyOwner: shouldNotifyOwnerTelegram, // Dynamically set based on owner's preference
                          ownerId: websiteOwner ? websiteOwner._id.toString() : null, // Pass owner's backend ID if available
                          notifyAllStaff: true // Custom flag to notify all staff in the bot
                      });
                    }


                } catch (error) {
                    console.error(`SERVER ERROR: Error handling message for chat ${chatId}:`, error)
                    socket.emit("reply", { text: "Error processing your message.", sender: "bot", timestamp: new Date().toISOString() })
                    socket.emit("bot_typing_stop")
                }
            })
        })
        .catch((err) => {
            console.error(`SERVER ERROR: Error finding website for chatbotCode ${chatbotCode}:`, err)
            socket.disconnect(true)
        })
}