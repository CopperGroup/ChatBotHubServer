// handlers/widget-handlers.js
import Chat from "../models/chat.js";
import User from "../models/user.js";
import { PlanValidator } from "../services/plan-validator.js";
import multiLanguage from "../services/multiLanguage.js";
import { getInitialWorkflowMessage, processWorkflowBlock, advanceWorkflow, getBlockById, getNextBlocks } from "../services/workflow-service.js";
import { sendTelegramNotification } from "../services/telegram-notifier.js"; // Import the notifier

const AI_URL = process.env.AI_URL;
const TOKEN_SERVICE_BASE_URL = process.env.TOKEN_SERVICE_BASE_URL; // <--- ADD THIS LINE: Base URL for your token service

// Helper function to get the current date in YYYY-MM-DD format (UTC)
const getTodayDateString = () => {
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = (today.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = today.getUTCDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Handles the creation of a new chat from the widget.
 * @param {object} socket - The socket.io socket object.
 * @param {object} io - The socket.io server instance.
 * @param {object} website - The website object associated with the chatbotCode.
 * @param {object} data - The event data containing email.
 */
export async function handleCreateNewChat(socket, io, website, { email }) {
    let newChat;
    console.log(`SERVER EVENT: Received 'create_new_chat' from Widget (Socket ID: ${socket.id}). Email: ${email}.`);

    try {
        const aiValidation = await PlanValidator.validateAIUsage(website._id);

        newChat = new Chat({
            chatbotCode: website.chatbotCode,
            email,
            website: website._id,
            name: "New Conversation",
            status: "open",
            aiResponsesEnabled: aiValidation.planAllowsAI && aiValidation.isValid,
            currentWorkflowBlockId: "start" // Initialize workflow at the start block
        });
        await newChat.save();
        console.log(`SERVER DEBUG: New chat ${newChat._id} created in DB. AI enabled: ${newChat.aiResponsesEnabled}. Initial workflow block ID set to 'start'.`);

        website.chats.push(newChat._id);
        await website.save();
        console.log(`SERVER DEBUG: Chat ${newChat._id} linked to Website ${website._id}.`);

        const rooms = Array.from(socket.rooms);
        rooms.forEach((room) => {
            if (room.startsWith("chat_")) {
                socket.leave(room);
            }
        });
        socket.join(`chat_${newChat._id}`);
        console.log(`SERVER DEBUG: Widget client ${socket.id} joined new chat room: chat_${newChat._id}. Current rooms: ${Array.from(socket.rooms).join(', ')}`);

        socket.emit("new_chat_data", { chat: newChat });
        console.log(`SERVER DEBUG: Emitted 'new_chat_data' to originating widget for chat: ${newChat._id}.`);

        let initialBotMessageText;
        let initialBotMessageOptions = [];
        let nextWorkflowPositionAfterStart = "start"; // Default to 'start'

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
            workflowData = null;
        }

        if (workflowData && Object.keys(workflowData).length > 0) {
            console.log("SERVER DEBUG: Workflow data available. Preparing initial 'start' message.");
            const startBlock = getBlockById(workflowData, 'start');
            if (startBlock) {
                const startMessageResponse = processWorkflowBlock(startBlock, "");
                initialBotMessageText = startMessageResponse.message;

                const nextBlocksFromStart = getNextBlocks(workflowData, startBlock.id, startBlock.type);
                if (nextBlocksFromStart.length > 0) {
                    nextWorkflowPositionAfterStart = nextBlocksFromStart[0].id;
                    console.log(`SERVER DEBUG: Initial workflow message is from 'start'. Next expected workflow position for user response: ${nextWorkflowPositionAfterStart}`);
                } else {
                    console.warn("SERVER WARN: 'start' block has no outgoing connections. Workflow will end after initial greeting.");
                    newChat.status = 'open'; // Keep chat open
                    nextWorkflowPositionAfterStart = startBlock.id;
                }
            } else {
                console.warn("SERVER WARN: 'start' block not found in workflow. Falling back to multiLanguage default.");
                initialBotMessageText = multiLanguage[`Hi! What is your name?`][website.preferences.language || "en"];
                nextWorkflowPositionAfterStart = null;
            }
        } else {
            console.log("SERVER DEBUG: No valid workflow data found. Falling back to multiLanguage default for initial message.");
            initialBotMessageText = multiLanguage[`Hi! What is your name?`][website.preferences.language || "en"];
            nextWorkflowPositionAfterStart = null;
        }

        socket.emit("bot_typing_start");
        console.log(`SERVER DEBUG: Emitted 'bot_typing_start' for initial bot message.`);

        const initialBotMessage = {
            sender: "bot",
            text: initialBotMessageText,
            timestamp: new Date().toISOString(),
            options: initialBotMessageOptions
        };

        const messages = JSON.parse(newChat.messages || "[]");
        messages.push(initialBotMessage);

        newChat.currentWorkflowBlockId = nextWorkflowPositionAfterStart;
        await Chat.findByIdAndUpdate(newChat._id, {
            messages: JSON.stringify(messages),
            currentWorkflowBlockId: newChat.currentWorkflowBlockId,
            status: newChat.status
        });
        console.log(`SERVER DEBUG: Initial bot message and workflow state saved to DB for chat ${newChat._id}. Current workflow block ID: ${newChat.currentWorkflowBlockId}. Chat status: ${newChat.status}.`);

        socket.emit("reply", { text: initialBotMessageText, sender: "bot", timestamp: initialBotMessage.timestamp, options: initialBotMessageOptions });
        console.log(`SERVER DEBUG: Emitted initial 'reply' to originating widget for chat: ${newChat._id}. Sender: bot. Options: ${JSON.stringify(initialBotMessageOptions)}.`);

        socket.emit("bot_typing_stop");
        console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' after initial bot message.`);

        const websiteOwner = await User.findOne({ websites: website._id });
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
            io.to(`dashboard_${websiteOwner._id}`).emit("new_chat", newChatPayload);
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
        console.error("SERVER ERROR: Error in create_new_chat handler:", error);
        socket.emit("reply", { text: "Error starting new conversation.", sender: "bot", timestamp: new Date().toISOString(), chatId: newChat?._id || "unknown" });
        socket.emit("bot_typing_stop");
    }
}

/**
 * Handles a widget client joining an existing chat.
 * @param {object} socket - The socket.io socket object.
 * @param {object} data - The event data containing chatId.
 */
export async function handleJoinChat(socket, { chatId }) {
    console.log(`SERVER EVENT: Received 'join_chat' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}.`);
    const rooms = Array.from(socket.rooms);
    rooms.forEach((room) => {
        if (room.startsWith("chat_")) {
            socket.leave(room);
        }
    });

    socket.join(`chat_${chatId}`);
    console.log(`SERVER DEBUG: Widget client ${socket.id} re-joined existing chat room: chat_${chatId}. Current rooms: ${Array.from(socket.rooms).join(', ')}`);
}

/**
 * Handles messages received from the widget.
 * @param {object} socket - The socket.io socket object.
 * @param {object} io - The socket.io server instance.
 * @param {object} website - The website object.
 * @param {object} data - The message data.
 */
export async function handleWidgetMessage(socket, io, website, { chatId, email, message, currentWebsiteURL: clientUrlFromMessage }) {
    console.log(
        `SERVER EVENT: Received 'message' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}. Text: "${message}". Email: ${email}. URL: ${clientUrlFromMessage || "N/A"}.`,
    );

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
            socket.emit("reply", { text: "Error: Chat not found.", sender: "bot", timestamp: new Date().toISOString() });
            console.error(`SERVER ERROR: Chat with ID ${chatId} not found.`);
            return;
        }

        if (!Array.from(socket.rooms).includes(`chat_${chatId}`)) {
            socket.join(`chat_${chatId}`);
            console.log(`SERVER DEBUG: Widget client ${socket.id} forcefully joined chat room: chat_${chatId} on message. Current rooms: ${Array.from(socket.rooms).join(', ')}`);
        }

        const messages = JSON.parse(chat.messages || "[]");

        const userMessage = {
            sender: "user",
            text: message,
            timestamp: new Date().toISOString(),
            url: clientUrlFromMessage,
            silent: !chat.currentWorkflowBlockId.includes("end") // Silences notifications if still in workflow
        };
        messages.push(userMessage);
        console.log(`SERVER DEBUG: User message added to chat history for chat ${chatId}: "${userMessage.text}".`);

        let botResponseText = null;
        let senderTypeForResponse = "bot";
        let botMessage = null;
        let workflowHandled = false;
        let nextWorkflowBlockToSave = chat.currentWorkflowBlockId;
        let telegramNotificationNeeded = false;
        let workflowPathEnded = false;
        const websiteOwner = await User.findOne({ websites: website._id });
        const shouldNotifyOwnerTelegram = websiteOwner && websiteOwner.preferences && websiteOwner.preferences.telegram;

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
            workflowData = null;
        }

        if (workflowData && chat.currentWorkflowBlockId) {
            console.log(`SERVER FLOW: Attempting to advance workflow from block ID: ${chat.currentWorkflowBlockId} with user message: "${message}".`);
            const workflowAdvanceResult = advanceWorkflow(workflowData, chat.currentWorkflowBlockId, message, message);
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
                    if (res.endWorkflow) {
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

                workflowHandled = true;
            } else {
                console.log(`SERVER FLOW: Workflow did not yield any responses. Current block ID: ${chat.currentWorkflowBlockId}.`);
                if (workflowAdvanceResult.nextWorkflowBlockId && workflowAdvanceResult.nextWorkflowBlockId !== chat.currentWorkflowBlockId) {
                    nextWorkflowBlockToSave = workflowAdvanceResult.nextWorkflowBlockId;
                    console.log(`SERVER FLOW: Workflow advanced internally to ${nextWorkflowBlockToSave} but produced no user message this turn. Still considered handled.`);
                    workflowHandled = true;
                }
            }
        } else {
            console.log(`SERVER FLOW: No active workflow (${chat.currentWorkflowBlockId}) or workflow data not found. Skipping workflow processing.`);
        }

        console.log(`SERVER AI FALLBACK DECISION:`);
        console.log(`   - workflowHandled: ${workflowHandled}`);
        console.log(`   - botMessage exists: ${botMessage !== null}`);
        console.log(`   - workflowPathEnded: ${workflowPathEnded}`);

        const triggerAIFallback = (!workflowHandled || (botMessage === null && workflowHandled)) || workflowPathEnded;

        if(!workflowHandled) {
            sendTelegramNotification({
                message: `New message from user ${chat.name} on ${website.name}. \n Message: ${message}`,
                websiteId: website._id.toString(),
                notifyOwner: shouldNotifyOwnerTelegram,
                ownerId: websiteOwner ? websiteOwner._id.toString() : null,
                notifyAllStaff: true,
                chatId: chat._id
            });
        }
        if (triggerAIFallback) {
            console.log(`SERVER FALLBACK: Conditions for AI/Default fallback met. Proceeding with fallback logic.`);

            let todayTokenUsage = Infinity;

            if (TOKEN_SERVICE_BASE_URL) {
                const todayDate = getTodayDateString();
                try {
                    const currentDailyUsageResponse = await fetch(`${TOKEN_SERVICE_BASE_URL}/tokens/usage/daily/${website._id}/${todayDate}`);
                    if (currentDailyUsageResponse.ok) {
                        const currentDailyUsage = await currentDailyUsageResponse.json();
                        console.log(`SERVER DEBUG: Current daily token usage for ${website._id} on ${todayDate}: ${currentDailyUsage}`);

                        todayTokenUsage = currentDailyUsage;
                    } else {
                        console.warn(`SERVER WARN: Failed to fetch current daily usage: ${currentDailyUsageResponse.status} - ${currentDailyUsageResponse.statusText}`);
                    }
                } catch (fetchError) {
                    console.error(`SERVER ERROR: Error fetching current daily token usage:`, fetchError.message);
                }
            } else {
                console.warn("SERVER WARN: TOKEN_SERVICE_BASE_URL is not set. Cannot fetch daily token usage.");
            }

            const aiAllowedPlan = website.plan.allowAI;
            const aiAllowedCredits = website.creditCount > 0;
            const aiAllowedChatEnabled = chat.aiResponsesEnabled;
            const aiAllowedWebsitePrefs = website.preferences?.allowAIResponses;
            const dailyLimit = website.preferences.dailyTokenLimit ? todayTokenUsage < website.preferences.dailyTokenLimit : true;
            const aiConditionsMet = aiAllowedPlan && aiAllowedCredits && aiAllowedChatEnabled && aiAllowedWebsitePrefs && dailyLimit;

            console.log(dailyLimit, website.preferences.dailyTokenLimit, todayTokenUsage)
            console.log(`SERVER FALLBACK: AI eligibility details:`);
            console.log(`   - Plan allows AI: ${aiAllowedPlan}`);
            console.log(`   - Remaining Credits: ${website.creditCount} (sufficient: ${aiAllowedCredits})`);
            console.log(`   - Chat AI enabled: ${aiAllowedChatEnabled}`);
            console.log(`   - Website preferences allow AI: ${aiAllowedWebsitePrefs}`);
            console.log(`   - Daily usage limit met: ${dailyLimit}`);
            console.log(`   - All AI conditions met: ${aiConditionsMet}`);


            if (messages.length === 2 && chat.name === "New Conversation" && !aiConditionsMet) {
                chat.name = message;
                botResponseText = `Thank you, ${message}! How can I help you today?`;
                senderTypeForResponse = "bot";
                console.log(`SERVER DEBUG: Chat ${chatId} named: "${chat.name}" (fallback naming).`);
            } else if (aiConditionsMet) {
                console.log("SERVER DEBUG: Engaging AI for response.");
                try {
                    socket.emit("bot_typing_start");
                    console.log("SERVER DEBUG: Emitted 'bot_typing_start' for AI call.");

                    console.log(`SERVER DEBUG: Calling AI service at ${AI_URL}/chat for chat ${chatId}...`);
                    const aiResponse = await fetch(`${AI_URL}/chat`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chatbotCode: website.chatbotCode,
                            chatId: chatId,
                            prompt: message,
                        }),
                    });

                    if (aiResponse.ok) {
                        const aiData = await aiResponse.json();
                        console.log("SERVER DEBUG: AI Response Data:", aiData);
                        let receivedAiResponseText = aiData.response; // Store the original AI response

                        // --- NEW LOGIC START ---
                        if (receivedAiResponseText && receivedAiResponseText.toLowerCase().includes("code:human007")) {
                            console.log("SERVER INFO: AI requested human assistance.");
                            botResponseText = multiLanguage["Ok, I already transferred your message to the staff team, they will join this chat soon."][website.preferences.language || "en"];
                            senderTypeForResponse = "ai"; // This is a system-generated message, not directly from AI
                            telegramNotificationNeeded = true; // Trigger Telegram notification
                            chat.aiResponsesEnabled = false
                            await chat.save()
                        } else {
                            botResponseText = receivedAiResponseText;
                            senderTypeForResponse = "ai";
                        }
                        // --- NEW LOGIC END ---

                        website.creditCount -= 1;
                        await website.save();
                        console.log(`SERVER DEBUG: AI response processed. Credits left: ${website.creditCount}.`);

                        // --- NEW: Log token usage after successful AI response ---
                        if (TOKEN_SERVICE_BASE_URL) {
                            try {
                                const recordUsageResponse = await fetch(`${TOKEN_SERVICE_BASE_URL}/tokens/usage`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        websiteId: website._id.toString(), // Ensure websiteId is a string
                                        tokensUsed: 1, // Assuming 1 token per AI response as per creditCount logic
                                        timestamp: new Date().toISOString(),
                                    }),
                                });
                                if (recordUsageResponse.ok) {
                                    console.log(`SERVER DEBUG: Token usage recorded successfully for website ${website._id}.`);
                                } else {
                                    console.warn(`SERVER WARN: Failed to record token usage: ${recordUsageResponse.status} - ${recordUsageResponse.statusText}`);
                                }
                            } catch (recordError) {
                                console.error(`SERVER ERROR: Error recording token usage after AI response:`, recordError.message);
                            }
                        }
                        // --- END NEW ---

                    } else {
                        console.error(`SERVER ERROR: AI server responded with status: ${aiResponse.status} - ${aiResponse.statusText}.`);
                        botResponseText = multiLanguage["Error processing your message."][website.preferences.language || "en"]; // Fallback for AI errors
                        senderTypeForResponse = "bot";
                    }
                } catch (aiError) {
                    console.error("SERVER ERROR: Error communicating with AI server:", aiError);
                    botResponseText = multiLanguage["Error processing your message."][website.preferences.language || "en"]; // Fallback for AI communication errors
                    senderTypeForResponse = "bot";
                } finally {
                    socket.emit("bot_typing_stop");
                    console.log("SERVER DEBUG: Emitted 'bot_typing_stop' after AI call.");
                }
            } else {
                console.log("SERVER DEBUG: AI not engaged: All specific AI conditions failed. Sending generic fallback.");
                // Ensure a response even if AI isn't used and no workflow message was generated
                // if (!botResponseText) { // If botResponseText is still null from workflow or AI
                //     botResponseText = multiLanguage["Please choose an option to continue."][website.preferences.language || "en"]; // Generic fallback
                //     senderTypeForResponse = "bot";
                // }
            }

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


        if (botMessage) {
            socket.emit("bot_typing_start");
            console.log(`SERVER DEBUG: Emitted 'bot_typing_start' for bot message (type: ${botMessage.sender}).`);
            setTimeout(() => {
                socket.emit("bot_typing_stop");
                console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' after sending botMessage.`);
            }, botMessage.sender === 'ai' ? 0 : 500); // Small delay for non-AI messages to feel more natural
        } else {
            socket.emit("bot_typing_stop");
            console.log(`SERVER DEBUG: Emitted 'bot_typing_stop' as no botMessage was generated.`);
        }

        // Update chat status and save
        await Chat.findByIdAndUpdate(chatId, {
            messages: JSON.stringify(messages),
            name: chat.name,
            currentWorkflowBlockId: nextWorkflowBlockToSave,
            status: chat.status // Make sure to save the potentially updated status
        });
        console.log(`SERVER DEBUG: Messages and workflow state saved to DB for chat ${chatId}. Final workflow position: ${chat.currentWorkflowBlockId}. Chat status: ${chat.status}.`);


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

        // Trigger Telegram notification if needed (either from workflow or AI "code:human007")
        if (telegramNotificationNeeded) {
            sendTelegramNotification({
                message: `Client ${chat.name} on ${website.name} requested human assistance in chat ${chat._id}.`,
                websiteId: website._id.toString(),
                notifyOwner: shouldNotifyOwnerTelegram,
                ownerId: websiteOwner ? websiteOwner._id.toString() : null,
                notifyAllStaff: true,
                chatId: chat._id
            });
            console.log(`SERVER DEBUG: Telegram notification sent: Client asked for human assistance.`);
        }

    } catch (error) {
        console.error(`SERVER ERROR: Error handling message for chat ${chatId}:`, error);
        socket.emit("reply", { text: "Error processing your message.", sender: "bot", timestamp: new Date().toISOString(), chatId: chatId || "unknown" });
        socket.emit("bot_typing_stop");
    }
}