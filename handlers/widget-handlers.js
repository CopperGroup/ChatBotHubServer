// handlers/widget-handlers.js
import Chat from "../models/chat.js";
import User from "../models/user.js";
import { PlanValidator } from "../services/plan-validator.js";
import multiLanguage from "../services/multiLanguage.js";
import {
  getInitialWorkflowMessage,
  processWorkflowBlock,
  advanceWorkflow,
  getBlockById,
  getNextBlocks,
} from "../services/workflow-service.js";
import { sendTelegramNotification } from "../services/telegram-notifier.js";
import chat from "../models/chat.js";
import crypto from "crypto";

const AI_URL = process.env.AI_URL;
const TOKEN_SERVICE_BASE_URL = process.env.TOKEN_SERVICE_BASE_URL;

const getTodayDateString = () => {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = (today.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = today.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export async function handleCreateNewChat(
  socket,
  io,
  website,
  { email, country }
) {
  let newChat;
  console.log(
    `SERVER EVENT: Received 'create_new_chat' from Widget (Socket ID: ${socket.id}). Email: ${email}.`
  );

  try {
    const aiValidation = await PlanValidator.validateAIUsage(website._id);

    newChat = new Chat({
      chatbotCode: website.chatbotCode,
      email,
      website: website._id,
      name: email.split("@")[0],
      status: "open",
      aiResponsesEnabled: aiValidation.planAllowsAI && aiValidation.isValid,
      currentWorkflowBlockId: "start",
      country: country,
    });
    await newChat.save();
    console.log(
      `SERVER DEBUG: New chat ${newChat._id} created in DB. AI enabled: ${newChat.aiResponsesEnabled}. Initial workflow block ID set to 'start'.`
    );

    website.chats.push(newChat._id);
    await website.save();
    console.log(
      `SERVER DEBUG: Chat ${newChat._id} linked to Website ${website._id}.`
    );

    const rooms = Array.from(socket.rooms);
    rooms.forEach((room) => {
      if (room.startsWith("chat_")) {
        socket.leave(room);
      }
    });
    socket.join(`chat_${newChat._id}`);
    console.log(
      `SERVER DEBUG: Widget client ${socket.id} joined new chat room: chat_${
        newChat._id
      }. Current rooms: ${Array.from(socket.rooms).join(", ")}`
    );

    socket.emit("new_chat_data", { chat: newChat });
    console.log(
      `SERVER DEBUG: Emitted 'new_chat_data' to originating widget for chat: ${newChat._id}.`
    );

    let initialBotMessageText;
    let initialBotMessageOptions = [];
    let nextWorkflowPositionAfterStart = "start";

    let workflowData = {};
    try {
      if (website.predefinedAnswers) {
        workflowData = JSON.parse(website.predefinedAnswers);
        console.log(
          "SERVER DEBUG: Parsed workflow data from website.predefinedAnswers."
        );
      } else {
        console.log(
          "SERVER DEBUG: website.predefinedAnswers is empty or null."
        );
      }
    } catch (parseError) {
      console.error(
        "SERVER ERROR: Failed to parse website.predefinedAnswers JSON for workflow execution:",
        parseError
      );
      workflowData = null;
    }

    if (workflowData && Object.keys(workflowData).length > 0) {
      console.log(
        "SERVER DEBUG: Workflow data available. Preparing initial 'start' message."
      );
      const startBlock = getBlockById(workflowData, "start");
      if (startBlock) {
        const startMessageResponse = processWorkflowBlock(startBlock, "");
        initialBotMessageText = startMessageResponse.message;

        const nextBlocksFromStart = getNextBlocks(
          workflowData,
          startBlock.id,
          startBlock.type
        );
        if (nextBlocksFromStart.length > 0) {
          nextWorkflowPositionAfterStart = nextBlocksFromStart[0].id;
          console.log(
            `SERVER DEBUG: Initial workflow message is from 'start'. Next expected workflow position for user response: ${nextWorkflowPositionAfterStart}`
          );
        } else {
          console.warn(
            "SERVER WARN: 'start' block has no outgoing connections. Workflow will end after initial greeting."
          );
          newChat.status = "open";
          nextWorkflowPositionAfterStart = startBlock.id;
        }
      } else {
        console.warn(
          "SERVER WARN: 'start' block not found in workflow. Falling back to multiLanguage default."
        );
        initialBotMessageText =
          multiLanguage[`Hi! What is your name?`][
            website.preferences.language || "en"
          ];
        nextWorkflowPositionAfterStart = null;
      }
    } else {
      console.log(
        "SERVER DEBUG: No valid workflow data found. Falling back to multiLanguage default for initial message."
      );
      initialBotMessageText =
        multiLanguage[`Hi! What is your name?`][
          website.preferences.language || "en"
        ];
      nextWorkflowPositionAfterStart = null;
    }

    socket.emit("bot_typing_start");
    console.log(
      `SERVER DEBUG: Emitted 'bot_typing_start' for initial bot message.`
    );

    const initialBotMessage = {
      sender: "bot",
      text: initialBotMessageText,
      timestamp: new Date().toISOString(),
      options: initialBotMessageOptions,
    };

    const messages = JSON.parse(newChat.messages || "[]");
    messages.push(initialBotMessage);

    newChat.currentWorkflowBlockId = nextWorkflowPositionAfterStart;

    let gravatarUrl = "";
    // if(messages.length === 1) {
    //     console.log("Getting avatar");
    //     const hash = crypto.createHash('sha256').update(newChat.email.trim().toLowerCase()).digest('hex')
    //     gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=identicon`
    //     console.log(gravatarUrl)
    // }

    await Chat.findByIdAndUpdate(newChat._id, {
      messages: JSON.stringify(messages),
      currentWorkflowBlockId: newChat.currentWorkflowBlockId,
      status: newChat.status,
      // avatar: gravatarUrl,
    });

    console.log(
      `SERVER DEBUG: Initial bot message and workflow state saved to DB for chat ${newChat._id}. Current workflow block ID: ${newChat.currentWorkflowBlockId}. Chat status: ${newChat.status}.`
    );

    socket.emit("reply", {
      text: initialBotMessageText,
      sender: "bot",
      timestamp: initialBotMessage.timestamp,
      options: initialBotMessageOptions,
    });
    console.log(
      `SERVER DEBUG: Emitted initial 'reply' to originating widget for chat: ${
        newChat._id
      }. Sender: bot. Options: ${JSON.stringify(initialBotMessageOptions)}.`
    );

    socket.emit("bot_typing_stop");
    console.log(
      `SERVER DEBUG: Emitted 'bot_typing_stop' after initial bot message.`
    );

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
          currentWorkflowBlockId: newChat.currentWorkflowBlockId,
        },
        websiteName: website.name,
      };
      io.to(`dashboard_${websiteOwner._id}`).emit("new_chat", newChatPayload);
      console.log(
        `SERVER DEBUG: Notified owner dashboard about new chat ${newChat._id}.`
      );

      io.to(`dashboard_${websiteOwner._id}`).emit("new_message", {
        chatId: newChat._id,
        message: null,
        websiteName: website.name,
        chatName: newChat.name,
        botResponse: initialBotMessage,
        websiteCreditCount: website.creditCount,
      });
      console.log(
        `SERVER DEBUG: Notified owner dashboard about initial bot message for new chat ${newChat._id}.`
      );
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
        currentWorkflowBlockId: newChat.currentWorkflowBlockId,
      },
      websiteName: website.name,
    });
    console.log(
      `SERVER DEBUG: Notified staff dashboards about new chat ${newChat._id}.`
    );

    io.to(`staff_${website._id}`).emit("new_message", {
      chatId: newChat._id,
      message: null,
      websiteName: website.name,
      chatName: newChat.name,
      botResponse: initialBotMessage,
      websiteCreditCount: website.creditCount,
    });
    console.log(
      `SERVER DEBUG: Notified staff dashboards about initial bot message for new chat ${newChat._id}.`
    );
  } catch (error) {
    console.error("SERVER ERROR: Error in create_new_chat handler:", error);
    socket.emit("reply", {
      text: "Error starting new conversation.",
      sender: "bot",
      timestamp: new Date().toISOString(),
      chatId: newChat?._id || "unknown",
    });
    socket.emit("bot_typing_stop");
  }
}

export async function handleJoinChat(socket, { chatId }) {
  console.log(
    `SERVER EVENT: Received 'join_chat' from Widget (Socket ID: ${socket.id}). Chat ID: ${chatId}.`
  );
  const rooms = Array.from(socket.rooms);
  rooms.forEach((room) => {
    if (room.startsWith("chat_")) {
      socket.leave(room);
    }
  });

  socket.join(`chat_${chatId}`);
  console.log(
    `SERVER DEBUG: Widget client ${
      socket.id
    } re-joined existing chat room: chat_${chatId}. Current rooms: ${Array.from(
      socket.rooms
    ).join(", ")}`
  );
}

export async function handleWidgetMessage(
  socket,
  io,
  website,
  { chatId, email, message, currentWebsiteURL: clientUrlFromMessage, fileUrl }
) {
  console.log(
    `SERVER EVENT: Received 'message' from Widget (Socket ID: ${
      socket.id
    }). Chat ID: ${chatId}. Text: "${message}". Email: ${email}. URL: ${
      clientUrlFromMessage || "N/A"
    }.`
  );

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) {
      socket.emit("reply", {
        text: "Error: Chat not found.",
        sender: "bot",
        timestamp: new Date().toISOString(),
      });
      console.error(`SERVER ERROR: Chat with ID ${chatId} not found.`);
      return;
    }

    if (!Array.from(socket.rooms).includes(`chat_${chatId}`)) {
      socket.join(`chat_${chatId}`);
      console.log(
        `SERVER DEBUG: Widget client ${
          socket.id
        } forcefully joined chat room: chat_${chatId} on message. Current rooms: ${Array.from(
          socket.rooms
        ).join(", ")}`
      );
    }

    let messages = JSON.parse(chat.messages || "[]");

    const userMessage = {
      sender: "user",
      text: message,
      timestamp: new Date().toISOString(),
      url: clientUrlFromMessage,
      fileUrl,
    };
    messages.push(userMessage);
    console.log(
      `SERVER DEBUG: User message added to chat history for chat ${chatId}: "${userMessage.text}".`
    );

    let workflowBotMessage = null;
    let aiBotMessage = null;
    let nextWorkflowBlockToSave = chat.currentWorkflowBlockId;
    let workflowPathEnded = false;
    let aiHandoverTelegramNotificationNeeded = false; // Flag specifically for AI 'code:human007'
    let telegramNotificationForUnhandledMessage = false; // New flag for messages when workflow is inactive

    const websiteOwner = await User.findOne({ websites: website._id });
    const shouldNotifyOwnerTelegram =
      websiteOwner &&
      websiteOwner.preferences &&
      websiteOwner.preferences.telegram;

    let workflowData = {};
    try {
      if (website.predefinedAnswers) {
        workflowData = JSON.parse(website.predefinedAnswers);
        console.log(
          "SERVER DEBUG: Parsed workflow data from website.predefinedAnswers for message handling."
        );
      } else {
        console.log(
          "SERVER DEBUG: website.predefinedAnswers is empty or null for message handling."
        );
      }
    } catch (parseError) {
      console.error(
        "SERVER ERROR: Failed to parse website.predefinedAnswers JSON for workflow execution:",
        parseError
      );
      workflowData = null;
    }

    // --- Workflow Processing ---
    // Only attempt workflow if there's a current workflow block ID and workflow data exists
    if (workflowData && chat.currentWorkflowBlockId) {
      // Check if the current workflow block is an "end" block from the previous turn
      const currentBlock = getBlockById(
        workflowData,
        chat.currentWorkflowBlockId
      );
      if (currentBlock && currentBlock.type === "end") {
        console.log(
          `SERVER FLOW: Current workflow block is an 'end' block (${currentBlock.id}). Quitting workflow processing for new user message.`
        );
        workflowPathEnded = true; // Mark as ended
        nextWorkflowBlockToSave = null; // IMPORTANT: Set to null to signal workflow is fully inactive for future turns
        // Set flag for general unhandled message notification
        telegramNotificationForUnhandledMessage = true;
      } else {
        console.log(
          `SERVER FLOW: Attempting to advance workflow from block ID: ${chat.currentWorkflowBlockId} with user message: "${message}".`
        );
        const workflowAdvanceResult = advanceWorkflow(
          workflowData,
          chat.currentWorkflowBlockId,
          message,
          message
        );
        console.log(
          `SERVER FLOW: advanceWorkflow returned result:`,
          JSON.stringify(workflowAdvanceResult)
        );

        if (workflowAdvanceResult.responses.length > 0) {
          let concatenatedMessage = "";
          let finalOptions = [];
          let latestResponseEndWorkflow = false;

          for (const res of workflowAdvanceResult.responses) {
            if (res.message !== null) {
              concatenatedMessage +=
                (concatenatedMessage ? "\n" : "") + res.message;
            }
            if (res.options && res.options.length > 0) {
              finalOptions = res.options;
            }
            if (res.endWorkflow) {
              latestResponseEndWorkflow = true;
            }
          }

          if (concatenatedMessage || finalOptions.length > 0) {
            workflowBotMessage = {
              sender: "bot",
              text: concatenatedMessage,
              timestamp: new Date().toISOString(),
              options: finalOptions,
            };
            messages.push(workflowBotMessage);
            console.log(
              `SERVER FLOW: Workflow generated bot message: "${
                workflowBotMessage.text
              }" with options: ${JSON.stringify(workflowBotMessage.options)}.`
            );

            socket.emit("bot_typing_start");
            console.log(
              `SERVER DEBUG: Emitted 'bot_typing_start' for workflow bot message.`
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
            socket.emit("reply", {
              text: workflowBotMessage.text,
              sender: workflowBotMessage.sender,
              timestamp: workflowBotMessage.timestamp,
              options: workflowBotMessage.options,
            });
            console.log(
              `SERVER DEBUG: Emitted 'reply' for workflow message. Text: "${workflowBotMessage.text}".`
            );
            socket.emit("bot_typing_stop");
            console.log(
              `SERVER DEBUG: Emitted 'bot_typing_stop' after workflow bot message.`
            );
          } else {
            console.log(
              "SERVER FLOW: Workflow advanced internally but produced no user-facing message this turn."
            );
          }

          nextWorkflowBlockToSave = workflowAdvanceResult.nextWorkflowBlockId;
          workflowPathEnded = latestResponseEndWorkflow;

          if (
            workflowPathEnded &&
            nextWorkflowBlockToSave &&
            nextWorkflowBlockToSave.includes("end")
          ) {
            sendTelegramNotification({
              message: `Client ${chat.name} on ${website.name} has completed a workflow path (chat ${chat._id}). Now transitioning to AI.`,
              websiteId: website._id.toString(),
              notifyOwner: shouldNotifyOwnerTelegram,
              ownerId: websiteOwner ? websiteOwner._id.toString() : null,
              notifyAllStaff: true,
              chatId: chat._id,
            });
            console.log(
              "SERVER DEBUG: Telegram notification sent for workflow path completion."
            );
            nextWorkflowBlockToSave = null;
          }
        } else {
          console.log(
            `SERVER FLOW: Workflow did not yield any responses. Current block ID: ${chat.currentWorkflowBlockId}.`
          );
          if (
            workflowAdvanceResult.nextWorkflowBlockId &&
            workflowAdvanceResult.nextWorkflowBlockId !==
              chat.currentWorkflowBlockId
          ) {
            nextWorkflowBlockToSave = workflowAdvanceResult.nextWorkflowBlockId;
            console.log(
              `SERVER FLOW: Workflow advanced internally to ${nextWorkflowBlockToSave} but produced no user message this turn.`
            );
          }
          workflowPathEnded = true;
          nextWorkflowBlockToSave = null;
          telegramNotificationForUnhandledMessage = true; // No workflow response, so notify
        }
      }
    } else {
      console.log(
        `SERVER FLOW: No active workflow (${chat.currentWorkflowBlockId}) or workflow data not found. Skipping workflow processing, AI will handle.`
      );
      workflowPathEnded = true; // No active workflow means AI takes over
      nextWorkflowBlockToSave = null; // Ensure workflow is considered inactive
      telegramNotificationForUnhandledMessage = true; // No workflow, so notify
    }

    // --- AI Engagement Logic ---
    console.log(`SERVER AI ENGAGEMENT DECISION:`);
    console.log(`    - workflowPathEnded: ${workflowPathEnded}`);
    console.log(
      `    - Workflow produced message (this turn): ${
        workflowBotMessage !== null
      }`
    );

    const shouldEngageAI = workflowPathEnded || workflowBotMessage === null;

    if (shouldEngageAI) {
      console.log(
        `SERVER FALLBACK: Conditions for AI/Default fallback met. Proceeding with fallback logic.`
      );

      let todayTokenUsage = Infinity;
      if (TOKEN_SERVICE_BASE_URL) {
        const todayDate = getTodayDateString();
        try {
          const currentDailyUsageResponse = await fetch(
            `${TOKEN_SERVICE_BASE_URL}/tokens/usage/daily/${website._id}/${todayDate}`
          );
          if (currentDailyUsageResponse.ok) {
            const currentDailyUsage = await currentDailyUsageResponse.json();
            todayTokenUsage = currentDailyUsage;
            console.log(
              `SERVER DEBUG: Current daily token usage for ${website._id} on ${todayDate}: ${todayTokenUsage}`
            );
          } else {
            console.warn(
              `SERVER WARN: Failed to fetch current daily usage: ${currentDailyUsageResponse.status} - ${currentDailyUsageResponse.statusText}`
            );
          }
        } catch (fetchError) {
          console.error(
            `SERVER ERROR: Error fetching current daily token usage:`,
            fetchError.message
          );
        }
      } else {
        console.warn(
          "SERVER WARN: TOKEN_SERVICE_BASE_URL is not set. Cannot fetch daily token usage."
        );
      }

      const aiAllowedPlan = website.plan.allowAI;
      const aiAllowedCredits = website.creditCount > 0;
      const aiAllowedChatEnabled = chat.aiResponsesEnabled;
      const aiAllowedWebsitePrefs = website.preferences?.allowAIResponses;
      const dailyLimit = website.preferences.dailyTokenLimit
        ? todayTokenUsage < website.preferences.dailyTokenLimit
        : true;
      const aiConditionsMet =
        aiAllowedPlan &&
        aiAllowedCredits &&
        aiAllowedChatEnabled &&
        aiAllowedWebsitePrefs &&
        dailyLimit;

      console.log(`SERVER FALLBACK: AI eligibility details:`);
      console.log(`    - Plan allows AI: ${aiAllowedPlan}`);
      console.log(
        `    - Remaining Credits: ${website.creditCount} (sufficient: ${aiAllowedCredits})`
      );
      console.log(`    - Chat AI enabled: ${aiAllowedChatEnabled}`);
      console.log(
        `    - Website preferences allow AI: ${aiAllowedWebsitePrefs}`
      );
      console.log(`    - Daily usage limit met: ${dailyLimit}`);
      console.log(`    - All AI conditions met: ${aiConditionsMet}`);

      if (
        messages.length === 2 &&
        chat.name === chat.email.split("@")[0] &&
        !aiConditionsMet
      ) {
        chat.name = message;
        aiBotMessage = {
          sender: "bot",
          text: `Thank you, ${message}! How can I help you today?`,
          timestamp: new Date().toISOString(),
        };
        messages.push(aiBotMessage);
        console.log(
          `SERVER DEBUG: Chat ${chatId} named: "${chat.name}" (fallback naming).`
        );
      } else if (aiConditionsMet) {
        console.log("SERVER DEBUG: Engaging AI for response.");
        try {
          socket.emit("bot_typing_start");
          console.log("SERVER DEBUG: Emitted 'bot_typing_start' for AI call.");

          console.log(
            `SERVER DEBUG: Calling AI service at ${AI_URL}/chat for chat ${chatId}...`
          );
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
            const receivedAiResponseText = aiData.response;

            if (
              receivedAiResponseText &&
              receivedAiResponseText.toLowerCase().includes("code:human007")
            ) {
              console.log(
                "SERVER INFO: AI requested human assistance (code:human007). Overriding AI message."
              );
              aiHandoverTelegramNotificationNeeded = true;
              chat.aiResponsesEnabled = false;
              await chat.save();
              aiBotMessage = {
                sender: "ai",
                text: multiLanguage[
                  "Ok, I already transferred your message to the staff team, they will join this chat soon."
                ][website.preferences.language || "en"],
                timestamp: new Date().toISOString(),
              };
            } else {
              aiBotMessage = {
                sender: "ai",
                text: receivedAiResponseText,
                timestamp: new Date().toISOString(),
              };
            }
            messages.push(aiBotMessage);

            website.creditCount -= 1;
            await website.save();
            console.log(
              `SERVER DEBUG: AI response processed. Credits left: ${website.creditCount}.`
            );

            if (TOKEN_SERVICE_BASE_URL) {
              try {
                const recordUsageResponse = await fetch(
                  `${TOKEN_SERVICE_BASE_URL}/tokens/usage`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      websiteId: website._id.toString(),
                      tokensUsed: 1,
                      timestamp: new Date().toISOString(),
                    }),
                  }
                );
                if (recordUsageResponse.ok) {
                  console.log(
                    `SERVER DEBUG: Token usage recorded successfully for website ${website._id}.`
                  );
                } else {
                  console.warn(
                    `SERVER WARN: Failed to record token usage: ${recordUsageResponse.status} - ${recordUsageResponse.statusText}`
                  );
                }
              } catch (recordError) {
                console.error(
                  `SERVER ERROR: Error recording token usage after AI response:`,
                  recordError.message
                );
              }
            }
          } else {
            console.error(
              `SERVER ERROR: AI server responded with status: ${aiResponse.status} - ${aiResponse.statusText}.`
            );
            aiBotMessage = {
              sender: "bot",
              text: multiLanguage[
                "Error processing your message with AI. Please try again or wait for staff assistance."
              ][website.preferences.language || "en"],
              timestamp: new Date().toISOString(),
            };
            messages.push(aiBotMessage);
          }
        } catch (aiError) {
          console.error(
            "SERVER ERROR: Error communicating with AI server:",
            aiError
          );
        } finally {
          socket.emit("bot_typing_stop");
          console.log("SERVER DEBUG: Emitted 'bot_typing_stop' after AI call.");
        }

        if (aiBotMessage) {
          socket.emit("bot_typing_start");
          console.log(
            `SERVER DEBUG: Emitted 'bot_typing_start' for AI bot message.`
          );
          socket.emit("reply", {
            text: aiBotMessage.text,
            sender: aiBotMessage.sender,
            timestamp: aiBotMessage.timestamp,
            options: aiBotMessage.options,
          });
          console.log(
            `SERVER DEBUG: Emitted 'reply' for AI message. Text: "${aiBotMessage.text}".`
          );
          socket.emit("bot_typing_stop");
          console.log(
            `SERVER DEBUG: Emitted 'bot_typing_stop' after AI bot message.`
          );
        }
      } else {
        console.log(
          "SERVER DEBUG: AI not engaged: All specific AI conditions failed. Sending generic fallback."
        );
      }
    } else if (workflowBotMessage === null && aiBotMessage === null) {
      // This scenario means workflow didn't produce a message, and AI wasn't engaged (or couldn't produce one)
      // This is the ideal place to trigger the "unhandled message" notification
      console.log(
        "SERVER DEBUG: No bot message generated by workflow, and AI was not engaged. This turn will be silent to the user."
      );
      telegramNotificationForUnhandledMessage = true;
    }

    await Chat.findByIdAndUpdate(chatId, {
      messages: JSON.stringify(messages),
      name: chat.name,
      currentWorkflowBlockId: nextWorkflowBlockToSave,
      status: chat.status,
    });
    console.log(
      `SERVER DEBUG: Messages and workflow state saved to DB for chat ${chatId}. Final workflow position: ${nextWorkflowBlockToSave}. Chat status: ${chat.status}.`
    );

    const finalBotResponseForDashboard = aiBotMessage || workflowBotMessage;

    const messagePayload = {
      chatId,
      message: userMessage,
      websiteName: website.name,
      chatName: chat.name,
      botResponse: finalBotResponseForDashboard,
      websiteCreditCount: website.creditCount,
      staffId: chat.leadingStaff ? chat.leadingStaff.toString() : "",
      currentWorkflowBlockId: nextWorkflowBlockToSave,
    };

    if (websiteOwner) {
      io.to(`dashboard_${websiteOwner._id}`).emit(
        "new_message",
        messagePayload
      );
      console.log(
        `SERVER DEBUG: Notified owner dashboard about user message and bot response for chat ${chatId}.`
      );
    }

    io.to(`staff_${website._id}`).emit("new_message", messagePayload);
    console.log(
      `SERVER DEBUG: Notified staff dashboards about user message and bot response for chat ${chatId}.`
    );

    // Trigger Telegram notification if AI returned "code:human007"
    if (aiHandoverTelegramNotificationNeeded) {
      sendTelegramNotification({
        message: `Client ${chat.name} on ${website.name} (chat ${chat._id}) needs human assistance (AI handover).`,
        websiteId: website._id.toString(),
        notifyOwner: shouldNotifyOwnerTelegram,
        ownerId: websiteOwner ? websiteOwner._id.toString() : null,
        notifyAllStaff: true,
        chatId: chat._id,
      });
      console.log(
        `SERVER DEBUG: Telegram notification sent: AI requested human assistance.`
      );
    }
    // Trigger Telegram notification for messages received after workflow completion or when no workflow/AI response
    else if (telegramNotificationForUnhandledMessage) {
      sendTelegramNotification({
        message: `New message from user ${chat.name} on ${website.name} (chat ${chat._id}): "${userMessage.text}". Workflow has ended.`,
        websiteId: website._id.toString(),
        notifyOwner: shouldNotifyOwnerTelegram,
        ownerId: websiteOwner ? websiteOwner._id.toString() : null,
        notifyAllStaff: true,
        chatId: chat._id,
      });
      console.log(
        `SERVER DEBUG: Telegram notification sent: User message received after workflow concluded or without bot response.`
      );
    }
  } catch (error) {
    console.error(
      `SERVER ERROR: Error handling message for chat ${chatId}:`,
      error
    );
    socket.emit("reply", {
      text: "An unexpected error occurred. Please try again.",
      sender: "bot",
      timestamp: new Date().toISOString(),
    });
    socket.emit("bot_typing_stop");
  }
}
