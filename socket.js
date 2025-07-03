// socket.js
import Chat from "./models/chat.js"
import Website from "./models/website.js"
import User from "./models/user.js"
import { PlanValidator } from "./services/plan-validator.js"
import Staff from "./models/staff.js" // Import the Staff model
import multiLanguage from "./services/multiLanguage.js"
// Import the new workflow service functions
import { getInitialWorkflowMessage, processWorkflowBlock, advanceWorkflow, getBlockById, getNextBlocks } from "./services/workflow-service.js";


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
        console.log(`SERVER EVENT: Received 'new_staff_added' for website ${websiteId}.`);
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

            // if (websiteLink !== requestOrigin) {
            //     console.log(
            //         `SERVER WARN: Socket connection: Origin mismatch for chatbotCode ${chatbotCode}. Expected: ${website.link}, Got: ${origin}. Disconnecting.`,
            //     )
            //     socket.disconnect(true)
            //     return
            // }

            console.log(`SERVER DEBUG: Widget connection allowed for chatbotCode: ${chatbotCode} from origin: ${origin}.`)

            const websiteOwner = await User.findOne({ websites: website._id })

            socket.on("create_new_chat", async (data) => {
                const { email } = data
                // Declare newChat here with `let` so it's accessible throughout the try/catch
                let newChat; 
                console.log(`SERVER EVENT: Received 'create_new_chat' from Widget (Socket ID: ${socket.id}). Email: ${email}.`);

                try {
                    const aiValidation = await PlanValidator.validateAIUsage(website._id)

                    newChat = new Chat({ // Assign to the `let` declared variable
                        chatbotCode,
                        email,
                        website: website._id,
                        name: "New Conversation",
                        status: "open",
                        aiResponsesEnabled: aiValidation.planAllowsAI && aiValidation.isValid,
                        currentWorkflowBlockId: "start" // Initialize workflow at the start block
                    })
                    await newChat.save()
                    console.log(`SERVER DEBUG: New chat ${newChat._id} created in DB. AI enabled: ${newChat.aiResponsesEnabled}. Initial workflow block ID set to 'start'.`);

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

                    let initialBotMessageText;
                    let initialBotMessageOptions = [];
                    let nextWorkflowPositionAfterStart = "start"; // Default to 'start'

                    // Parse the workflow JSON from website.predefinedAnswers
                    let workflowData = {};
                    try {
                        if (website.predefinedAnswers) {
                            workflowData = JSON.parse(website.predefinedAnswers);
                            console.log("SERVER DEBUG: Parsed workflow data from website.predefinedAnswers.");
                        } else {
                            console.log("SERVER DEBUG: website.predefinedAnswers is empty or null.");
                        }
                    } catch (parseError) {
                        console.error("SERVER ERROR: Failed to parse website.predefinedAnswers JSON for workflow execution:", parseError);
                        workflowData = null; // Set to null to trigger fallback
                    }

                    // --- Initial Bot Message Logic (Only 'start' block message, then set currentWorkflowBlockId to 'userResponse1') ---
                    if (workflowData && Object.keys(workflowData).length > 0) {
                        console.log("SERVER DEBUG: Workflow data available. Preparing initial 'start' message.");
                        const startBlock = getBlockById(workflowData, 'start');
                        if (startBlock) {
                            const startMessageResponse = processWorkflowBlock(startBlock, ""); // Get the start message
                            initialBotMessageText = startMessageResponse.message;

                            // Determine the *next* block to point to after the initial "start" message is sent.
                            // This should be the first block that requires user interaction after the start message.
                            const nextBlocksFromStart = getNextBlocks(workflowData, startBlock.id, startBlock.type); 
                            if (nextBlocksFromStart.length > 0) {
                                nextWorkflowPositionAfterStart = nextBlocksFromStart[0].id; // This should be 'userResponse1'
                                console.log(`SERVER DEBUG: Initial workflow message is from 'start'. Next expected workflow position for user response: ${nextWorkflowPositionAfterStart}`);
                            } else {
                                console.warn("SERVER WARN: 'start' block has no outgoing connections. Workflow will end after initial greeting.");
                                newChat.status = 'open'; // Keep chat open
                                nextWorkflowPositionAfterStart = startBlock.id; // Stay at start (or consider it implicitly ended)
                            }
                        } else {
                            console.warn("SERVER WARN: 'start' block not found in workflow. Falling back to multiLanguage default.");
                            initialBotMessageText = multiLanguage[`Hi! What is your name?`][website.preferences.language || "en"];
                            nextWorkflowPositionAfterStart = null; // No workflow to track
                        }
                    } else {
                        console.log("SERVER DEBUG: No valid workflow data found. Falling back to multiLanguage default for initial message.");
                        initialBotMessageText = multiLanguage[`Hi! What is your name?`][website.preferences.language || "en"];
                        nextWorkflowPositionAfterStart = null; // No workflow to track
                    }

                    // *** TYPING INDICATOR LOGIC FOR INITIAL BOT MESSAGE ***
                    socket.emit("bot_typing_start");
                    console.log(`SERVER DEBUG: Emitted 'bot_typing_start' for initial bot message.`);
                    // *******************************************************

                    const initialBotMessage = {
                        sender: "bot",
                        text: initialBotMessageText,
                        timestamp: new Date().toISOString(),
                        options: initialBotMessageOptions // This will be empty for the first message
                    };

                    const messages = JSON.parse(newChat.messages || "[]")
                    messages.push(initialBotMessage)
                    
                    newChat.currentWorkflowBlockId = nextWorkflowPositionAfterStart; // Update the chat's workflow ID
                    await Chat.findByIdAndUpdate(newChat._id, {
                        messages: JSON.stringify(messages),
                        currentWorkflowBlockId: newChat.currentWorkflowBlockId,
                        status: newChat.status // Ensure status is saved
                    });
                    console.log(`SERVER DEBUG: Initial bot message and workflow state saved to DB for chat ${newChat._id}. Current workflow block ID: ${newChat.currentWorkflowBlockId}. Chat status: ${newChat.status}.`);

                    socket.emit("reply", { text: initialBotMessageText, sender: "bot", timestamp: initialBotMessage.timestamp, options: initialBotMessageOptions})
                    console.log(`SERVER DEBUG: Emitted initial 'reply' to widget for chat: ${newChat._id}. Sender: bot. Options: ${JSON.stringify(initialBotMessageOptions)}.`);

                    // *** TYPING INDICATOR LOGIC FOR INITIAL BOT MESSAGE ***
                    socket.emit("bot_typing_stop");
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
                                currentWorkflowBlockId: newChat.currentWorkflowBlockId
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
                        console.log(`SERVER DEBUG: Notified owner dashboard about initial bot message for new chat ${newChat._id}.`);
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
                            currentWorkflowBlockId: newChat.currentWorkflowBlockId
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
                    socket.emit("reply", { text: "Error starting new conversation.", sender: "bot", timestamp: new Date().toISOString(), chatId: newChat?._id || "unknown"})
                    socket.emit("bot_typing_stop")
                }
            })

            socket.on("join_chat", async ({ chatId }) => {
                console.log(`SERVER EVENT: Received 'join_chat' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}.`);
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
                    `SERVER EVENT: Received 'message' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}. Text: "${message}". Email: ${email}. URL: ${clientUrlFromMessage || "N/A"}.`,
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
                        silent: !chat.currentWorkflowBlockId.includes("end")
                        
                    }
                    messages.push(userMessage)
                    console.log(`SERVER DEBUG: User message added to chat history for chat ${chatId}: "${userMessage.text}".`);

                    let botResponseText = null
                    let senderTypeForResponse = "bot"
                    let botMessage = null;
                    let workflowHandled = false; // Flag to indicate if workflow handled the message
                    let nextWorkflowBlockToSave = chat.currentWorkflowBlockId; // Default to current workflow position
                    let telegramNotificationNeeded = false; // Flag to send telegram notification
                    let workflowPathEnded = false; // Flag to indicate if workflow path reached its end (like 'end' block or no more connections)

                    // Parse the workflow JSON from website.predefinedAnswers
                    let workflowData = {};
                    try {
                        if (website.predefinedAnswers) {
                            workflowData = JSON.parse(website.predefinedAnswers);
                            console.log("SERVER DEBUG: Parsed workflow data from website.predefinedAnswers for message handling.");
                        } else {
                            console.log("SERVER DEBUG: website.predefinedAnswers is empty or null for message handling.");
                        }
                    } catch (parseError) {
                        console.error("SERVER ERROR: Failed to parse website.predefinedAnswers JSON for workflow execution:", parseError);
                        workflowData = null; // Set to null to trigger fallback
                    }

                    // --- Workflow Processing Logic ---
                    if (workflowData && chat.currentWorkflowBlockId) {
                        console.log(`SERVER FLOW: Attempting to advance workflow from block ID: ${chat.currentWorkflowBlockId} with user message: "${message}".`);
                        const workflowAdvanceResult = advanceWorkflow(workflowData, chat.currentWorkflowBlockId, message, message); // Pass user's message as chosen option
                        console.log(`SERVER FLOW: advanceWorkflow returned result:`, JSON.stringify(workflowAdvanceResult));
                        
                        if (workflowAdvanceResult.responses.length > 0) {
                            let concatenatedMessage = "";
                            let finalOptions = [];
                            for (const res of workflowAdvanceResult.responses) {
                                if (res.message !== null) { 
                                    concatenatedMessage += (concatenatedMessage ? "\n" : "") + res.message;
                                }
                                if (res.options && res.options.length > 0) {
                                    finalOptions = res.options; 
                                }
                                if (res.sendTelegramNotification) {
                                    telegramNotificationNeeded = true;
                                }
                                if (res.endWorkflow) { // endWorkflow flag from workflow-service
                                    workflowPathEnded = true; 
                                    console.log(`SERVER FLOW: Workflow path reached 'end' block or final sequential block. WorkflowPathEnded set to true.`);
                                }
                            }

                            if (concatenatedMessage || finalOptions.length > 0) {
                                botResponseText = concatenatedMessage;
                                botMessage = {
                                    sender: "bot",
                                    text: botResponseText,
                                    timestamp: new Date().toISOString(),
                                    options: finalOptions,
                                };
                                messages.push(botMessage);
                                console.log(`SERVER FLOW: Workflow generated bot message: "${botMessage.text}" with options: ${JSON.stringify(botMessage.options)}.`);
                            } else {
                                console.log("SERVER FLOW: Workflow advanced internally but produced no user-facing message this turn.");
                            }
                            
                            nextWorkflowBlockToSave = workflowAdvanceResult.nextWorkflowBlockId;
                            console.log(`SERVER FLOW: Chat workflow position will be updated to: ${nextWorkflowBlockToSave}.`);
                            
                            workflowHandled = true; // Workflow processing occurred
                        } else {
                            console.log(`SERVER FLOW: Workflow did not yield any responses. Current block ID: ${chat.currentWorkflowBlockId}.`);
                            // If workflow returns no responses but has a next block, update position without sending message
                            if (workflowAdvanceResult.nextWorkflowBlockId && workflowAdvanceResult.nextWorkflowBlockId !== chat.currentWorkflowBlockId) {
                                nextWorkflowBlockToSave = workflowAdvanceResult.nextWorkflowBlockId;
                                console.log(`SERVER FLOW: Workflow advanced internally to ${nextWorkflowBlockToSave} but produced no user message this turn. Still considered handled.`);
                                workflowHandled = true; // Still consider it handled by workflow if position updated
                            }
                        }
                    } else {
                        console.log(`SERVER FLOW: No active workflow (${chat.currentWorkflowBlockId}) or workflow data not found. Skipping workflow processing.`);
                    }

                    // --- AI / Default Fallback Logic ---
                    // Engage AI if workflow processing is not enabled, or if it finished its defined path
                    // and either didn't provide a visible message, or explicitly signaled workflow completion (end block).
                    console.log(`SERVER AI FALLBACK DECISION:`);
                    console.log(`  - workflowHandled: ${workflowHandled}`);
                    console.log(`  - botMessage exists: ${botMessage !== null}`);
                    console.log(`  - workflowPathEnded: ${workflowPathEnded}`);

                    const triggerAIFallback = (!workflowHandled || (botMessage === null && workflowHandled)) || workflowPathEnded;

                    if(workflowHandled) {
                        sendTelegramNotification({
                            message: `New message from user ${chat.name} on ${website.name}. \n Message: ${message}`,
                            websiteId: website._id.toString(),
                            notifyOwner: shouldNotifyOwnerTelegram,
                            ownerId: websiteOwner ? websiteOwner._id.toString() : null,
                            notifyAllStaff: true, // Notify all staff as this is a handoff
                            chatId: chat._id
                        });
                    }
                    if (triggerAIFallback) {
                        console.log(`SERVER FALLBACK: Conditions for AI/Default fallback met. Proceeding with fallback logic.`);
                        
                        // Determine AI eligibility
                        const aiAllowedPlan = website.plan.allowAI;
                        const aiAllowedCredits = website.creditCount > 0;
                        const aiAllowedChatEnabled = chat.aiResponsesEnabled;
                        const aiAllowedWebsitePrefs = website.preferences?.allowAIResponses;
                        const aiConditionsMet = aiAllowedPlan && aiAllowedCredits && aiAllowedChatEnabled && aiAllowedWebsitePrefs;

                        console.log(`SERVER FALLBACK: AI eligibility details:`);
                        console.log(`  - Plan allows AI: ${aiAllowedPlan}`);
                        console.log(`  - Remaining Credits: ${website.creditCount} (sufficient: ${aiAllowedCredits})`);
                        console.log(`  - Chat AI enabled: ${aiAllowedChatEnabled}`);
                        console.log(`  - Website preferences allow AI: ${aiAllowedWebsitePrefs}`);
                        console.log(`  - All AI conditions met: ${aiConditionsMet}`);

                        if (messages.length === 2 && chat.name === "New Conversation" && !aiConditionsMet) {
                            // This specifically handles the naming response if AI is NOT allowed
                            // and the chat is still in its initial naming phase.
                            chat.name = message;
                            botResponseText = `Thank you, ${message}! How can I help you today?`;
                            senderTypeForResponse = "bot";
                            console.log(`SERVER DEBUG: Chat ${chatId} named: "${chat.name}" (fallback naming).`);
                        } else if (aiConditionsMet) {
                            console.log("SERVER DEBUG: Engaging AI for response.");
                            try {
                                socket.emit("bot_typing_start");
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
                                });

                                if (aiResponse.ok) {
                                    const aiData = await aiResponse.json();
                                    console.log("SERVER DEBUG: AI Response Data:", aiData);
                                    botResponseText = aiData.response;
                                    senderTypeForResponse = "ai";
                                    website.creditCount -= 1;
                                    await website.save();
                                    console.log(`SERVER DEBUG: AI response received. Credits left: ${website.creditCount}.`);
                                } else {
                                    console.error(`SERVER ERROR: AI server responded with status: ${aiResponse.status} - ${aiResponse.statusText}.`);
                                }
                            } catch (aiError) {
                                console.error("SERVER ERROR: Error communicating with AI server:", aiError);
                            } finally {
                                socket.emit("bot_typing_stop");
                                console.log("SERVER DEBUG: Emitted 'bot_typing_stop' after AI call.");
                            }
                        } else {
                            console.log("SERVER DEBUG: AI not engaged: All specific AI conditions failed. Sending generic fallback.");
                        }

                        // If botResponseText was determined by fallback, and no botMessage object yet, create it.
                        // This handles cases where workflow might not have generated a message but AI fallback does.
                        if (botResponseText && botMessage === null) { 
                            botMessage = { sender: senderTypeForResponse, text: botResponseText, timestamp: new Date().toISOString() };
                            messages.push(botMessage);
                            console.log(`SERVER FALLBACK: Generated bot message: "${botMessage.text}" (sender: ${botMessage.sender}).`);
                        } else if (botMessage !== null) {
                            console.log(`SERVER FALLBACK: Bot message already exists from workflow. Not creating a new one from AI fallback.`);
                        } else {
                            console.log(`SERVER FALLBACK: No bot message generated even from fallback logic. This turn will be silent.`);
                        }
                    }


                    // --- Typing Indicator Handling ---
                    if (botMessage) {
                        socket.emit("bot_typing_start");
                        console.log(`SERVER DEBUG: Emitted 'bot_typing_start' for bot message (type: ${botMessage.sender}).`);
                        setTimeout(() => {
                            socket.emit("bot_typing_stop");
                            console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' after sending botMessage.`);
                        }, botMessage.sender === 'ai' ? 0 : 500);
                    } else {
                        socket.emit("bot_typing_stop");
                        console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' as no botMessage was generated.`);
                    }

                    // --- Save Chat State and Emit Updates ---
                    chat.currentWorkflowBlockId = nextWorkflowBlockToSave; // Update to the new position
                    await Chat.findByIdAndUpdate(chatId, {
                        messages: JSON.stringify(messages),
                        name: chat.name,
                        currentWorkflowBlockId: chat.currentWorkflowBlockId,
                        // DO NOT UPDATE chat.status based on endWorkflow here, as it's human-controlled now.
                    });
                    console.log(`SERVER DEBUG: Messages and workflow state saved to DB for chat ${chatId}. Final workflow position: ${chat.currentWorkflowBlockId}.`);

                    if (botMessage) {
                        socket.emit("reply", {
                            text: botMessage.text,
                            sender: botMessage.sender,
                            timestamp: botMessage.timestamp,
                            options: botMessage.options
                        });
                        console.log(`SERVER DEBUG: Emitted 'reply' to widget. Sender: ${botMessage.sender}. Text: "${botMessage.text}". Options: ${JSON.stringify(botMessage.options || [])}.`);
                    }

                    const messagePayload = {
                        chatId,
                        message: userMessage,
                        websiteName: website.name,
                        chatName: chat.name,
                        botResponse: botMessage,
                        websiteCreditCount: website.creditCount,
                        staffId: chat.leadingStaff ? chat.leadingStaff.toString() : "",
                        currentWorkflowBlockId: chat.currentWorkflowBlockId
                    };

                    if (websiteOwner) {
                        io.to(`dashboard_${websiteOwner._id}`).emit("new_message", messagePayload);
                        console.log(`SERVER DEBUG: Notified owner dashboard about user message and bot response for chat ${chatId}.`);
                    }

                    io.to(`staff_${website._id}`).emit("new_message", messagePayload);
                    console.log(`SERVER DEBUG: Notified staff dashboards about user message and bot response for chat ${chatId}.`);

                    // Trigger Telegram notification if the flag is set during workflow processing
                    if (telegramNotificationNeeded) {
                      const shouldNotifyOwnerTelegram = websiteOwner && websiteOwner.preferences && websiteOwner.preferences.telegram;

                      sendTelegramNotification({
                          message: `Workflow completed for chat from ${chat.name} on ${website.name}. Agent assistance requested.`,
                          websiteId: website._id.toString(),
                          notifyOwner: shouldNotifyOwnerTelegram,
                          ownerId: websiteOwner ? websiteOwner._id.toString() : null,
                          notifyAllStaff: true, // Notify all staff as this is a handoff
                          chatId: chat._id
                      });
                      console.log(`SERVER DEBUG: Telegram notification triggered due to workflow 'end' block.`);
                    }


                } catch (error) {
                    console.error(`SERVER ERROR: Error handling message for chat ${chatId}:`, error)
                    socket.emit("reply", { text: "Error processing your message.", sender: "bot", timestamp: new Date().toISOString(), chatId: newChat?._id || "unknown"})
                    socket.emit("bot_typing_stop")
                }
            })
        })
        .catch((err) => {
            console.error(`SERVER ERROR: Error finding website for chatbotCode ${chatbotCode}:`, err)
            socket.disconnect(true)
        })
}