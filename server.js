// server.js
import express from "express"
import http from "http"
import cors from "cors"
import mongoose from "mongoose"
import { Server } from "socket.io"
import { userRoutes } from "./routes/user.js"
import { websiteRoutes } from "./routes/website.js"
import { chatRoutes } from "./routes/chat.js"
import staffRoutes from "./routes/staff.js" // Ensure this is imported
import { planRoutes } from "./routes/plan.js" // Ensure this is imported
import { handleSocket } from "./socket.js"
import Website from "./models/website.js"
import dotenv from "dotenv"
import { transactionRoutes } from "./routes/transaction.js"
dotenv.config()

const app = express()
const server = http.createServer(app)

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {console.log("MongoDB connected"), await initAllowedOrigins();})
  .catch((err) => console.error(err))

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
        } else {
          console.warn(`🚫 Blocked origin: ${origin}`);
          callback(new Error("Origin not allowed by CORS"));
        }
    },      
    methods: ["GET", "POST"]
  },
})

// Middleware
app.use(cors())
app.use(express.json())

// MongoDB connection

app.use("/api/users", userRoutes)
app.use("/api/transactions", transactionRoutes) // Mount new transaction routes
app.use("/api/websites", websiteRoutes)
app.use("/api/chats", chatRoutes)
app.use("/api/staff", staffRoutes)
app.use("/api/plans", planRoutes)
app.use("/widget", express.static("public"))

app.get("/widget/chatbot-widget.js", async (req, res) => {
  const chatbotCode = req.query.chatbotCode
  let requestOrigin = req.headers.origin

  if (!requestOrigin) {
    console.warn(
      `Chatbot widget request: Origin header is missing for chatbotCode ${chatbotCode}. Defaulting to http://localhost:3000 for local development.`,
    )
    requestOrigin = "http://localhost:3000"
  }

  if (!chatbotCode) {
    console.log("Chatbot widget request: chatbotCode is missing.")
    return res.status(400).send("// chatbotCode is missing")
  }

  try {
    const website = await Website.findOne({ chatbotCode })

    if (!website) {
      console.log(`Chatbot widget request: Website with chatbotCode ${chatbotCode} not found.`)
      return res.status(404).send("// Website not found for this chatbotCode")
    }

    const websiteLink = website.link.endsWith("/") ? website.link.slice(0, -1) : website.link
    const normalizedRequestOrigin = requestOrigin.endsWith("/") ? requestOrigin.slice(0, -1) : requestOrigin

    if (websiteLink !== normalizedRequestOrigin) {
      console.log(
        `Chatbot widget request: Origin mismatch for chatbotCode ${chatbotCode}. Expected: ${website.link}, Got: ${requestOrigin}. Blocking widget.`,
      )
      return res.status(403).send("// Access Denied: Origin mismatch. Widget will not load.")
    }

    const preferences = website.preferences || {}
    const gradient1 = preferences.colors?.gradient1 || "#667eea"
    const gradient2 = preferences.colors?.gradient2 || "#764ba2"
    const headerText = preferences.header || "Chat Support"
    const allowAIResponses = preferences.allowAIResponses || false
    const creditCount = website.creditCount
    const allowedPaths = preferences.allowedPaths || []
    const disallowedPaths = preferences.disallowedPaths || []
    console.log(headerText)

    console.log(`Website ${website.name} has ${creditCount} credits remaining.`)

    // Part 1: Initial Setup and Validation
    const widgetScriptPart1 = `(function () {
        const gradientColor1 = "${gradient1}";
        const gradientColor2 = "${gradient2}";
        const headerTitle = "${headerText}";
        const allowAIResponsesFromBackend = ${allowAIResponses};
        const injectedAllowedPaths = ${JSON.stringify(allowedPaths)};
        const injectedDisallowedPaths = ${JSON.stringify(disallowedPaths)};
      
        // Core function to check path and toggle widget display
        function checkAndToggleWidget() {
          const currentPathname = window.location.pathname;
          let shouldDisplayWidget = true;
      
          console.log("[Chatbot] Checking path:", currentPathname);
      
          if (injectedDisallowedPaths.some(path => currentPathname.startsWith(path))) {
            shouldDisplayWidget = false;
            console.warn("[Chatbot] Widget not loaded: path is disallowed.", currentPathname);
          } else if (injectedAllowedPaths.length > 0 && !injectedAllowedPaths.some(path => currentPathname.startsWith(path))) {
            shouldDisplayWidget = false;
            console.warn("[Chatbot] Widget not loaded: path not in allowed list.", currentPathname);
          }
      
          const widget = document.getElementById("chatbot-widget");
          if (!widget) {
            console.log("[Chatbot] Widget element not found yet.");
            return;
          }
      
          if (shouldDisplayWidget) {
            if (widget.style.display === "none") {
              widget.style.display = "";
              console.log("[Chatbot] Widget display:none removed, widget now visible.");
            } else {
              console.log("[Chatbot] Widget already visible.");
            }
          } else {
            if (widget.style.display !== "none") {
              widget.style.display = "none";
              console.log("[Chatbot] Widget hidden (display:none set).");
            } else {
              console.log("[Chatbot] Widget already hidden.");
            }
          }
        }
      
        // Run on initial load (wait for widget if needed)
        function waitForWidgetAndCheck() {
          const widget = document.getElementById("chatbot-widget");
          if (widget) {
            checkAndToggleWidget();
          } else {
            setTimeout(waitForWidgetAndCheck, 300);
          }
        }
        waitForWidgetAndCheck();
      
        // Listen for back/forward navigation
        window.addEventListener('popstate', () => {
          console.log("[Chatbot] popstate detected");
          checkAndToggleWidget();
        });
      
        // Monkey-patch pushState and replaceState to detect SPA navigation
        const originalPushState = history.pushState;
        history.pushState = function () {
          originalPushState.apply(this, arguments);
          console.log("[Chatbot] pushState detected");
          checkAndToggleWidget();
        };
      
        const originalReplaceState = history.replaceState;
        history.replaceState = function () {
          originalReplaceState.apply(this, arguments);
          console.log("[Chatbot] replaceState detected");
          checkAndToggleWidget();
        };
      
        console.log("[Chatbot] Widget will be displayed.");
      
        const socketScript = document.createElement('script');
        socketScript.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        document.head.appendChild(socketScript);
      
        socketScript.onload = () => {
          const chatbotCode = "${chatbotCode}";
          const currentWebsiteURL = window.location.href;
      
          let userEmail = localStorage.getItem('chatbotEmail');
          let currentChatId = localStorage.getItem('currentChatId');
          let isAskingForName = false;
          let isExpanded = false;
          let isTyping = false;
          let currentView = 'email'; // 'email', 'conversations', 'chat'
      `;
      


    // Part 2: CSS Styles and Animations
    const widgetScriptPart2 = `
                const style = document.createElement('style');
                style.textContent = \`
                    /* Widget Animations */
                    @keyframes slideUp {
                        from {
                            opacity: 0;
                            transform: translateY(30px) scale(0.9);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    @keyframes slideDown {
                        from {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                        to {
                            opacity: 0;
                            transform: translateY(30px) scale(0.9);
                        }
                    }
                    @keyframes slideInFromRight {
                        from {
                            opacity: 0;
                            transform: translateX(20px);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(0);
                        }
                    }
                    @keyframes slideInFromLeft {
                        from {
                            opacity: 0;
                            transform: translateX(-20px);
                        }
                        to {
                            opacity: 1;
                            transform: translateX(0);
                        }
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes messageSlideIn {
                        from {
                            opacity: 0;
                            transform: translateY(15px) scale(0.95);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    @keyframes pulse {
                        0% { opacity: 0.4; transform: scale(1); }
                        50% { opacity: 1; transform: scale(1.1); }
                        100% { opacity: 0.4; transform: scale(1); }
                    }
                    
                    /* Enhanced closing animations */
                    @keyframes smoothSlideDown {
                        0% {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                            visibility: visible;
                        }
                        50% {
                            opacity: 0.7;
                            transform: translateY(15px) scale(0.98);
                        }
                        100% {
                            opacity: 0;
                            transform: translateY(30px) scale(0.95);
                            visibility: hidden;
                        }
                    }

                    @keyframes buttonFadeIn {
                        from {
                            opacity: 0;
                            transform: scale(0.8) translateY(10px);
                        }
                        to {
                            opacity: 1;
                            transform: scale(1) translateY(0);
                        }
                    }

                    .smooth-slide-down {
                        animation: smoothSlideDown 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                    }

                    .button-fade-in {
                        animation: buttonFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both;
                    }
                    
                    /* View Transitions */
                    .view-transition-enter {
                        animation: slideInFromRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    }
                    .view-transition-exit {
                        animation: slideInFromLeft 0.4s cubic-bezier(0.4, 0, 0.2, 1) reverse;
                    }
                    .slide-down {
                        animation: slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                    }
                    
                    /* Message Components */
                    .message-bubble {
                        animation: messageSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    }
                    .typing-indicator-bubble {
                        display: flex;
                        justify-content: flex-start;
                        margin-bottom: 20px;
                        animation: fadeIn 0.3s ease-out;
                    }
                    .typing-indicator-bubble .message-content {
                        max-width: 80%;
                        padding: 16px 20px;
                        border-radius: 20px 20px 20px 6px;
                        font-size: 14px;
                        line-height: 1.5;
                        background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
                        color: #374151;
                        border: 1px solid #e5e7eb;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
                        backdrop-filter: blur(10px);
                    }
                    .typing-indicator-bubble .typing-dots {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        margin-top: 8px;
                    }
                    .typing-indicator-bubble .typing-dots span {
                        display: inline-block;
                        width: 10px;
                        height: 10px;
                        background: linear-gradient(135deg, #6b7280, #9ca3af);
                        border-radius: 50%;
                        animation: pulse 1.6s infinite ease-in-out both;
                        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    }
                    .typing-indicator-bubble .typing-dots span:nth-child(1) { animation-delay: 0.2s; }
                    .typing-indicator-bubble .typing-dots span:nth-child(2) { animation-delay: 0.4s; }
                    .typing-indicator-bubble .typing-dots span:nth-child(3) { animation-delay: 0.6s; }
                    
                    /* Scrollbar Styles */
                    .chatbot-scrollbar::-webkit-scrollbar {
                        width: 8px;
                    }
                    .chatbot-scrollbar::-webkit-scrollbar-track {
                        background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
                        border-radius: 4px;
                    }
                    .chatbot-scrollbar::-webkit-scrollbar-thumb {
                        background: linear-gradient(to bottom, #cbd5e1, #94a3b8);
                        border-radius: 4px;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                    }
                    .chatbot-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: linear-gradient(to bottom, #94a3b8, #64748b);
                    }
                \`;
                document.head.appendChild(style);`

    // Part 3: Widget Container and Chat Button
    const widgetScriptPart3 = `
                const widget = document.createElement('div');
                widget.id = 'chatbot-widget';
                widget.style.cssText = \`
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 10000;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    display: none;
                \`;

                const chatButton = document.createElement('div');
                chatButton.id = 'chat-button';
                chatButton.style.cssText = \`
                    width: 64px;
                    height: 64px;
                    background: linear-gradient(135deg, \${gradientColor1} 0%, \${gradientColor2} 100%);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    box-shadow: 0 12px 40px \${gradientColor1}30, 0 4px 16px rgba(0, 0, 0, 0.1);
                    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    position: relative;
                    overflow: hidden;
                    backdrop-filter: blur(10px);
                \`;

                chatButton.innerHTML = \`
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                \`;

                chatButton.addEventListener('mouseenter', () => {
                    chatButton.style.transform = 'scale(1.1) translateY(-2px)';
                    chatButton.style.boxShadow = \`0 16px 50px \${gradientColor1}40, 0 8px 24px rgba(0, 0, 0, 0.15)\`;
                });

                chatButton.addEventListener('mouseleave', () => {
                    chatButton.style.transform = 'scale(1) translateY(0)';
                    chatButton.style.boxShadow = \`0 12px 40px \${gradientColor1}30, 0 4px 16px rgba(0, 0, 0, 0.1)\`;
                });`

    // Part 4: Chat Window Container
    const widgetScriptPart4 = `
                const chatWindow = document.createElement('div');
                chatWindow.id = 'chat-window';
                chatWindow.style.cssText = \`
                    width: 400px;
                    height: 520px;
                    background: white;
                    border-radius: 20px;
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.15), 0 10px 40px rgba(0, 0, 0, 0.1);
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    position: absolute;
                    bottom: 0;
                    right: 0;
                    transform-origin: bottom right;
                    animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    backdrop-filter: blur(20px);
                \`;`

    // Part 5: Header Component
    const widgetScriptPart5 = `
                const createHeader = () => {
                    const header = document.createElement('div');
                    header.id = 'chat-header';
                    header.style.cssText = \`
                        background: linear-gradient(135deg, \${gradientColor1} 0%, \${gradientColor2} 100%);
                        color: white;
                        padding: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        flex-shrink: 0;
                        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                        position: relative;
                        overflow: hidden;
                    \`;

                    const backBtn = document.createElement('button');
                    backBtn.id = 'back-to-chats';
                    backBtn.style.cssText = \`
                        background: rgba(255, 255, 255, 0.15);
                        border: none;
                        color: white;
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        cursor: pointer;
                        display: none;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        margin-right: 12px;
                        backdrop-filter: blur(10px);
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                    \`;
                    backBtn.innerHTML = \`
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    \`;

                    const headerContent = document.createElement('div');
                    headerContent.style.cssText = 'flex: 1; text-align: center;';
                    headerContent.innerHTML = \`
                        <h3 id="header-title" style="margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; transition: all 0.3s ease;">\${headerTitle}</h3>
                        <p id="header-subtitle" style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9; font-weight: 400; transition: all 0.3s ease;">We're here to help!</p>
                    \`;

                    const closeBtn = document.createElement('button');
                    closeBtn.id = 'close-chat';
                    closeBtn.style.cssText = \`
                        background: rgba(255, 255, 255, 0.15);
                        border: none;
                        color: white;
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        backdrop-filter: blur(10px);
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                    \`;
                    closeBtn.innerHTML = \`
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    \`;

                    // Hover effects
                    [backBtn, closeBtn].forEach(btn => {
                        btn.addEventListener('mouseenter', () => {
                            btn.style.background = 'rgba(255, 255, 255, 0.25)';
                            btn.style.transform = 'scale(1.05)';
                        });
                        btn.addEventListener('mouseleave', () => {
                            btn.style.background = 'rgba(255, 255, 255, 0.15)';
                            btn.style.transform = 'scale(1)';
                        });
                    });

                    header.appendChild(backBtn);
                    header.appendChild(headerContent);
                    header.appendChild(closeBtn);
                    return header;
                };`

    // Part 6: Content Container
    const widgetScriptPart6 = `
                const createContentContainer = () => {
                    const chatContent = document.createElement('div');
                    chatContent.id = 'chatbot-content';
                    chatContent.style.cssText = \`
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
                        min-height: 0;
                        overflow: hidden;
                        position: relative;
                    \`;
                    return chatContent;
                };`

    // Part 7: Email Input Component
    const widgetScriptPart7 = `
                const createEmailInputArea = () => {
                    const emailInputArea = document.createElement('div');
                    emailInputArea.id = 'email-input-area';
                    emailInputArea.style.cssText = \`
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        padding: 40px 24px;
                        text-align: center;
                        min-height: 0;
                        overflow-y: auto;
                        opacity: 0;
                        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    \`;
                    emailInputArea.className = 'chatbot-scrollbar';

                    emailInputArea.innerHTML = \`
                        <div style="
                            width: 88px;
                            height: 88px;
                            background: linear-gradient(135deg, \${gradientColor1} 0%, \${gradientColor2} 100%);
                            border-radius: 50%;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            box-shadow: 0 8px 32px \${gradientColor1}30, 0 4px 16px rgba(0, 0, 0, 0.1);
                        ">
                            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="white" stroke-width="2"/>
                                <polyline points="22,6 12,13 2,6" stroke="white" stroke-width="2"/>
                            </svg>
                        </div>
                        <h3 style="margin: 0 0 12px 0; color: #1f2937; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">Welcome!</h3>
                        <p style="margin: 0 0 28px 0; color: #6b7280; font-size: 15px; line-height: 1.6; font-weight: 400;">
                            Please enter your email address to start a conversation with our support team.
                        </p>
                        <input id="emailInput" type="email" placeholder="Enter your email address" style="
                            width: 100%;
                            padding: 14px 18px;
                            border: 2px solid #e5e7eb;
                            border-radius: 12px;
                            font-size: 15px;
                            margin-bottom: 18px;
                            outline: none;
                            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                            box-sizing: border-box;
                            background: rgba(255, 255, 255, 0.8);
                            backdrop-filter: blur(10px);
                            font-weight: 400;
                        " />
                        <button id="emailSubmitBtn" style="
                            width: 100%;
                            padding: 14px 18px;
                            background: linear-gradient(135deg, \${gradientColor1} 0%, \${gradientColor2} 100%);
                            color: white;
                            border: none;
                            border-radius: 12px;
                            font-size: 15px;
                            font-weight: 600;
                            cursor: pointer;
                            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                            box-shadow: 0 4px 16px \${gradientColor1}30;
                            letter-spacing: 0.02em;
                        ">Start Conversation</button>
                    \`;
                    return emailInputArea;
                };`

    // Part 8: Conversations List Component
    const widgetScriptPart8 = `
                const createConversationsList = () => {
                    const chatListDiv = document.createElement('div');
                    chatListDiv.id = 'chat-list';
                    chatListDiv.style.cssText = \`
                        flex: 1;
                        overflow-y: auto;
                        padding: 24px;
                        display: none;
                        min-height: 0;
                        opacity: 0;
                        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    \`;
                    chatListDiv.className = 'chatbot-scrollbar';
                    return chatListDiv;
                };

                const createNewChatButton = () => {
                    const newChatBtnContainer = document.createElement('div');
                    newChatBtnContainer.id = 'new-chat-button-container';
                    newChatBtnContainer.style.cssText = \`
                        padding: 24px;
                        background: rgba(255, 255, 255, 0.95);
                        border-top: 1px solid #e5e7eb;
                        display: none;
                        flex-shrink: 0;
                        backdrop-filter: blur(20px);
                        opacity: 0;
                        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    \`;
                    newChatBtnContainer.innerHTML = \`
                        <button id="newChatBtn" style="
                            width: 100%;
                            padding: 12px 18px;
                            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
                            color: #374151;
                            border: 2px solid #e5e7eb;
                            border-radius: 12px;
                            cursor: pointer;
                            font-size: 14px;
                            font-weight: 600;
                            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                            letter-spacing: 0.02em;
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                        ">✨ Start New Conversation</button>
                    \`;
                    return newChatBtnContainer;
                };`

    // Part 9: Messages Container Component
    const widgetScriptPart9 = `
                const createMessagesContainer = () => {
                    const messagesContainer = document.createElement('div');
                    messagesContainer.id = 'messages-container';
                    messagesContainer.style.cssText = \`
                        flex: 1;
                        overflow-y: auto;
                        padding: 24px;
                        display: none;
                        min-height: 0;
                        opacity: 0;
                        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    \`;
                    messagesContainer.className = 'chatbot-scrollbar';
                    return messagesContainer;
                };

                const createTypingIndicator = () => {
                    const typingIndicatorBubble = document.createElement('div');
                    typingIndicatorBubble.className = 'typing-indicator-bubble';
                    typingIndicatorBubble.id = 'typing-indicator-bubble';
                    typingIndicatorBubble.style.display = 'none';

                    typingIndicatorBubble.innerHTML = \`
                        <div class="message-content">
                            <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; opacity: 0.8; letter-spacing: 0.02em;">Support Team</div>
                            <div class="typing-dots">
                                <span></span><span></span><span></span>
                            </div>
                        </div>
                    \`;
                    return typingIndicatorBubble;
                };`

    // Part 10: Input Area Component
    const widgetScriptPart10 = `
                const createInputArea = () => {
                    const inputArea = document.createElement('div');
                    inputArea.id = 'chatbot-input-area';
                    inputArea.style.cssText = \`
                        padding: 24px;
                        border-top: 1px solid #e5e7eb;
                        background: rgba(255, 255, 255, 0.95);
                        display: none;
                        flex-shrink: 0;
                        backdrop-filter: blur(20px);
                        opacity: 0;
                        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    \`;

                    inputArea.innerHTML = \`
                        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
                            <input id="msg" placeholder="Type your message..." style="
                                flex: 1;
                                padding: 14px 18px;
                                border: 2px solid #e5e7eb;
                                border-radius: 12px;
                                font-size: 15px;
                                outline: none;
                                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                                background: rgba(255, 255, 255, 0.9);
                                backdrop-filter: blur(10px);
                                font-weight: 400;
                            " />
                            <button id="sendBtn" style="
                                padding: 14px 20px;
                                background: linear-gradient(135deg, \${gradientColor1} 0%, \${gradientColor2} 100%);
                                color: white;
                                border: none;
                                border-radius: 12px;
                                font-size: 15px;
                                font-weight: 600;
                                cursor: pointer;
                                min-width: 70px;
                                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                                box-shadow: 0 4px 16px \${gradientColor1}30;
                                letter-spacing: 0.02em;
                            ">Send</button>
                        </div>
                    \`;
                    return inputArea;
                };`

    // Part 11: Message Rendering Component
    const widgetScriptPart11 = `
                const createMessageBubble = (sender, text, timestamp) => {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message-bubble';
                    messageDiv.style.cssText = \`
                        margin-bottom: 20px;
                        display: flex;
                        \${sender === 'user' ? 'justify-content: flex-end;' : 'justify-content: flex-start;'}
                    \`;

                    let bubbleBg = '';
                    let bubbleTextColor = '';
                    let senderLabel = '';
                    let borderRadius = '20px';
                    let avatarHtml = '';
                    let iconSvg = '';

                    if (sender === 'user') {
                        bubbleBg = \`linear-gradient(135deg, \${gradientColor1} 0%, \${gradientColor2} 100%)\`;
                        bubbleTextColor = 'white';
                        senderLabel = 'You';
                        borderRadius = '20px 20px 6px 20px';
                    } else if (sender === 'bot') {
                        bubbleBg = 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)';
                        bubbleTextColor = '#374151';
                        senderLabel = 'Bot';
                        borderRadius = '20px 20px 20px 6px';
                        iconSvg = \`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="4" r="1" fill="currentColor"/><rect x="11.5" y="5" width="1" height="1.5" fill="currentColor"/><path d="M12 6.5c-4.5 0-6 2-6 5.5v3c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-3c0-3.5-1.5-5.5-6-5.5z" fill="currentColor"/><circle cx="12" cy="12" r="4.5" fill="white"/><ellipse cx="10" cy="11.5" rx="1" ry="1.2" fill="currentColor"/><ellipse cx="14" cy="11.5" rx="1" ry="1.2" fill="currentColor"/></svg>\`;
                        avatarHtml = \`
                            <div style="
                                width: 32px; height: 32px; border-radius: 50%;
                                background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);
                                display: flex; align-items: center; justify-content: center;
                                position: absolute; right: -16px; top: -16px;
                                box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3), 0 2px 4px rgba(0,0,0,0.1);
                                border: 2px solid white;
                                color: white;
                            ">\${iconSvg}</div>
                        \`;
                    } else if (sender === 'ai') {
                        bubbleBg = 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)';
                        bubbleTextColor = '#374151';
                        senderLabel = 'AI Assistant';
                        borderRadius = '20px 20px 20px 6px';
                        iconSvg = \`
                        <svg 
                            width="18" height="18" viewBox="0 0 24 24" 
                            fill="none" xmlns="http://www.w3.org/2000/svg" 
                            style="padding-left: 4px;">
                            <path 
                                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" 
                                stroke="currentColor" stroke-width="1.5" fill="none"
                            />
                        </svg>
                        \`;

                        avatarHtml = \`
                            <div style="
                                width: 32px; height: 32px; border-radius: 50%;
                                background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
                                display: flex; align-items: center; justify-content: center;
                                position: absolute; right: -16px; top: -16px;
                                box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3), 0 2px 4px rgba(0,0,0,0.1);
                                border: 2px solid white;
                                color: white;
                            ">
                            \${iconSvg}
                            </div>
                        \`;

                    } else if (sender.startsWith('staff-')) { // This covers staff and owners (formatted as staff-<Name>)
                        const staffName = sender.split('-')[1];
                        bubbleBg = 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)';
                        bubbleTextColor = '#374151';
                        senderLabel = staffName;
                        borderRadius = '20px 20px 20px 6px';
                        iconSvg = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" fill="currentColor"/></svg>\`;
                        avatarHtml = \`
                            <div style="
                                width: 32px; height: 32px; border-radius: 50%;
                                background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
                                display: flex; align-items: center; justify-content: center;
                                position: absolute; right: -16px; top: -16px;
                                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3), 0 2px 4px rgba(0,0,0,0.1);
                                border: 2px solid white;
                                color: white;
                            ">\${iconSvg}</div>
                        \`;
                    } else if (sender === 'owner') {
                      bubbleBg = 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)';
                      bubbleTextColor = '#374151';
                      senderLabel = 'Owner';
                      borderRadius = '20px 20px 20px 6px';
                      iconSvg = \`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>\`;
                      avatarHtml = \`
                          <div style="
                              width: 32px; height: 32px; border-radius: 50%;
                              background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
                              display: flex; align-items: center; justify-content: center;
                              position: absolute; right: -16px; top: -16px;
                              box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4), 0 2px 4px rgba(0,0,0,0.1);
                              border: 2px solid white;
                              color: white;
                          ">\${iconSvg}</div>
                      \`;
                  }

                    const messageBubble = document.createElement('div');
                    messageBubble.style.cssText = \`
                        max-width: 80%;
                        min-width: 30%;
                        padding: 12px 20px;
                        border-radius: \${borderRadius};
                        font-size: 15px;
                        line-height: 1.5;
                        word-wrap: break-word;
                        background: \${bubbleBg};
                        color: \${bubbleTextColor};
                        position: relative;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
                        border: 1px solid rgba(255, 255, 255, 0.2); \${sender === 'user' ? 'border: none;' : ''}
                        backdrop-filter: blur(10px);
                        font-weight: 400;
                    \`;

                    if (sender !== 'user') {
                        messageBubble.innerHTML += avatarHtml;
                    }

                    messageBubble.innerHTML += \`
                        <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; opacity: 0.8; letter-spacing: 0.02em; \${sender === 'user' ? 'color: rgba(255,255,255,0.8);' : ''}">
                            \${senderLabel}
                        </div>
                        <div style="font-weight: 400;">\${text}</div>
                        <div style="font-size: 11px; opacity: 0.6; text-align: \${sender === 'user' ? 'right' : 'left'}; margin-top: 6px; \${sender === 'user' ? 'color: rgba(255,255,255,0.7);' : ''} font-weight: 400;">
                            \${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    \`;

                    messageDiv.appendChild(messageBubble);
                    return messageDiv;
                };`

    // Part 12: View Management System
    const widgetScriptPart12 = `
                // View Management System
                const updateHeaderForView = (view) => {
                    const headerTitleElement = document.getElementById('header-title');
                    const headerSubtitle = document.getElementById('header-subtitle');
                    const backBtn = document.getElementById('back-to-chats');

                    switch(view) {
                        case 'email':
                            headerTitleElement.textContent = headerTitle;
                            headerSubtitle.textContent = "We're here to help!";
                            backBtn.style.display = 'none';
                            break;
                        case 'conversations':
                            headerTitleElement.textContent = 'Your Conversations';
                            headerSubtitle.textContent = 'Select a chat or start new one';
                            backBtn.style.display = 'none';
                            break;
                        case 'chat':
                            headerTitleElement.textContent = 'Live Chat';
                            headerSubtitle.textContent = 'Connected with support';
                            backBtn.style.display = 'flex';
                            break;
                    }
                };

                const showView = (viewName, direction = 'right') => {
                    const views = {
                        email: emailInputArea,
                        conversations: chatListDiv,
                        chat: messagesContainer
                    };
                    
                    const footers = {
                        conversations: newChatBtnContainer,
                        chat: inputArea
                    };

                    // Hide all views with animation
                    Object.values(views).forEach(view => {
                        if (view.style.display !== 'none') {
                            view.style.opacity = '0';
                            view.style.transform = direction === 'right' ? 'translateX(-20px)' : 'translateX(20px)';
                            setTimeout(() => {
                                view.style.display = 'none';
                            }, 200);
                        }
                    });

                    // Hide all footers
                    Object.values(footers).forEach(footer => {
                        if (footer && footer.style.display !== 'none') {
                            footer.style.opacity = '0';
                            setTimeout(() => {
                                footer.style.display = 'none';
                            }, 200);
                        }
                    });

                    // Show target view with animation
                    setTimeout(() => {
                        const targetView = views[viewName];
                        const targetFooter = footers[viewName];
                        
                        if (targetView) {
                            targetView.style.display = viewName === 'email' ? 'flex' : 'block';
                            targetView.style.transform = direction === 'right' ? 'translateX(20px)' : 'translateX(-20px)';
                            targetView.style.opacity = '0';
                            
                            setTimeout(() => {
                                targetView.style.opacity = '1';
                                targetView.style.transform = 'translateX(0)';
                            }, 50);
                        }
                        
                        if (targetFooter) {
                            targetFooter.style.display = 'block';
                            setTimeout(() => {
                                targetFooter.style.opacity = '1';
                            }, 100);
                        }
                        
                        updateHeaderForView(viewName);
                        currentView = viewName;
                    }, 200);
                };`

    // Part 13: Widget Assembly and Initialization
    const widgetScriptPart13 = `
                // Create all components
                const header = createHeader();
                const chatContent = createContentContainer();
                const emailInputArea = createEmailInputArea();
                const chatListDiv = createConversationsList();
                const messagesContainer = createMessagesContainer();
                const typingIndicatorBubble = createTypingIndicator();
                const inputArea = createInputArea();
                const newChatBtnContainer = createNewChatButton();

                // Assemble the widget
                chatContent.appendChild(emailInputArea);
                chatContent.appendChild(chatListDiv);
                chatContent.appendChild(messagesContainer);
                chatWindow.appendChild(header);
                chatWindow.appendChild(chatContent);
                chatWindow.appendChild(inputArea);
                chatWindow.appendChild(newChatBtnContainer);
                widget.appendChild(chatButton);
                widget.appendChild(chatWindow);
                document.body.appendChild(widget);

                // Get elements
                const closeBtn = document.getElementById('close-chat');
                const backBtn = document.getElementById('back-to-chats');
                const msgInput = document.getElementById("msg");
                const sendBtn = document.getElementById("sendBtn");
                const newChatBtn = document.getElementById("newChatBtn");
                const emailInput = document.getElementById("emailInput");
                const emailSubmitBtn = document.getElementById("emailSubmitBtn");`

    // Part 14: Event Handlers and Interactions
    const widgetScriptPart14 = `
                // Enhanced input focus effects
                const addInputEffects = () => {
                    [emailInput, msgInput].forEach(input => {
                        input.addEventListener('focus', () => {
                            input.style.borderColor = gradientColor1;
                            input.style.boxShadow = \`0 0 0 3px \${gradientColor1}20\`;
                            input.style.transform = 'translateY(-1px)';
                        });
                        input.addEventListener('blur', () => {
                            input.style.borderColor = '#e5e7eb';
                            input.style.boxShadow = 'none';
                            input.style.transform = 'translateY(0)';
                        });
                    });

                    [emailSubmitBtn, sendBtn].forEach(btn => {
                        btn.addEventListener('mouseenter', () => {
                            btn.style.transform = 'translateY(-2px)';
                            btn.style.boxShadow = \`0 8px 24px \${gradientColor1}40\`;
                        });
                        btn.addEventListener('mouseleave', () => {
                            btn.style.transform = 'translateY(0)';
                            btn.style.boxShadow = \`0 4px 16px \${gradientColor1}30\`;
                        });
                    });

                    newChatBtn.addEventListener('mouseenter', () => {
                        newChatBtn.style.background = 'linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)';
                        newChatBtn.style.transform = 'translateY(-1px)';
                        newChatBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                    });
                    newChatBtn.addEventListener('mouseleave', () => {
                        newChatBtn.style.background = 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)';
                        newChatBtn.style.transform = 'translateY(0)';
                        newChatBtn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
                    });
                };

                addInputEffects();

                // Widget toggle with enhanced smooth closing animation
                const toggleWidget = () => {
                    if (isExpanded) {
                        // Add smooth closing animation
                        chatWindow.classList.remove('slide-down');
                        chatWindow.classList.add('smooth-slide-down');
                        
                        // Hide the window after animation completes
                        setTimeout(() => {
                            chatWindow.style.display = 'none';
                            chatWindow.classList.remove('smooth-slide-down');
                            
                            // Show button with fade-in animation
                            chatButton.style.display = 'flex';
                            chatButton.classList.add('button-fade-in');
                            
                            // Remove the fade-in class after animation
                            setTimeout(() => {
                                chatButton.classList.remove('button-fade-in');
                            }, 500);
                            
                            isExpanded = false;
                        }, 500);
                    } else {
                        chatButton.style.display = 'none';
                        chatWindow.style.display = 'flex';
                        chatWindow.classList.remove('slide-down', 'smooth-slide-down');
                        isExpanded = true;
                        
                        // Initialize view based on user state
                        if (!userEmail) {
                            showView('email');
                        } else {
                            showView('conversations');
                            loadUserChats(userEmail); // Will call loadUserChats after view transition
                        }
                    }
                };

                chatButton.addEventListener('click', toggleWidget);
                closeBtn.addEventListener('click', toggleWidget);`

    // Part 15: Core Functionality - Socket and Message Handling
// Part 15: Core Functionality - Socket and Message Handling
// Part 15: Core Functionality - Socket and Message Handling
// Part 15: Core Functionality - Socket and Message Handling
const widgetScriptPart15 = `
                // Socket connection
                console.log("chatbotCode:", chatbotCode);
                console.log("currentWebsiteURL:", currentWebsiteURL);

                const socket = io("https://chatbothubserver.up.railway.app", {
                    path: '/socket.io',
                    query: { chatbotCode, currentWebsiteURL },
                    transports: ['websocket', 'polling'],
                });

                console.log(socket)
                // Message rendering function
                const renderMessage = (sender, text, timestamp) => {
                    const messageBubble = createMessageBubble(sender, text, timestamp);
                    messagesContainer.appendChild(messageBubble);
                    // This setTimeout ensures the DOM has updated before trying to scroll
                    setTimeout(() => {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }, 50); // Reduced timeout slightly for quicker scroll reaction
                };

                // Typing indicator functions
                const showTypingIndicator = () => {
                    if (isTyping) return;
                    if (messagesContainer.lastChild !== typingIndicatorBubble) {
                        messagesContainer.appendChild(typingIndicatorBubble);
                    }
                    typingIndicatorBubble.style.display = 'flex';
                    isTyping = true;
                    // Ensure scroll to bottom when typing indicator appears
                    setTimeout(() => {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }, 50);
                };

                const hideTypingIndicator = () => {
                    typingIndicatorBubble.style.display = 'none';
                    isTyping = false;
                };

                // View navigation functions
                const showChatList = () => {
                    localStorage.removeItem('currentChatId');
                    currentChatId = null;
                    
                    console.log("Widget: Navigating to chat list. currentChatId cleared.");
                    hideTypingIndicator();
                    messagesContainer.innerHTML = '';
                    
                    userInitiatedBackToList = true;
                    
                    if (!userEmail) {
                        showView('email');
                    } else {
                        showView('conversations');
                        loadUserChats(userEmail); // Will call loadUserChats after view transition
                        showView('conversations', 'left');
                    }
                };

                // CRITICAL CHANGE: Load messages FIRST, then show view
                const showChatMessages = async (chatId) => { // Made async
                    console.log("Widget: showChatMessages called for chat:", chatId);
                    // Set currentChatId immediately to indicate current intent
                    currentChatId = chatId; 
                    localStorage.setItem('currentChatId', currentChatId);

                    // 1. Emit join_chat signal to the server
                    socket.emit("join_chat", { chatId: chatId });

                    // 2. Load messages asynchronously
                    await loadMessages(chatId); // Wait for messages to load

                    // 3. ONLY THEN, change the view
                    showView('chat', 'right'); 
                    console.log("Widget: Messages loaded. Navigating to chat view.");

                    // *** ENSURE SCROLL TO BOTTOM AFTER VIEW TRANSITION ***
                    setTimeout(() => {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        console.log("Widget: Scrolled to bottom after chat view transition.");
                    }, 450); // A bit longer than showView's transition (400ms)
                    // ******************************************************
                };`
    // Part 16: Data Loading Functions
// Part 16: Data Loading Functions
// Part 16: Data Loading Functions
// Part 16: Data Loading Functions
const widgetScriptPart16 = `
                const loadMessages = async (chatId) => {
                    console.log("Widget: Attempting to load messages for chat:", chatId);
                    const loadingChatId = chatId; // Store the chatId being loaded locally

                    try {
                        if (!loadingChatId) {
                            messagesContainer.innerHTML = '';
                            currentChatId = null; // Ensure this is also null
                            localStorage.removeItem('currentChatId');
                            console.log("Widget: ChatId is null, cleared messages and currentChatId.");
                            return;
                        }

                        const response = await fetch(\`https://chatbothubserver.up.railway.app/api/chats/\${loadingChatId}\`);
                        const chat = await response.json();

                        // *** IMPORTANT CHECK: Prevent re-rendering if currentChatId has changed while fetching ***
                        // If the user has navigated away from this chat while data was fetching,
                        // do not render the messages.
                        if (currentChatId !== loadingChatId) {
                            console.warn("Widget: Aborting message load for old chat ID as currentChatId changed.");
                            return;
                        }
                        // ************************************************************************************

                        messagesContainer.innerHTML = ''; // Clear previous messages

                        const loadedMessages = chat.messages ? JSON.parse(chat.messages) : [];
                        loadedMessages.forEach(msg => {
                            renderMessage(msg.sender, msg.text, msg.timestamp);
                        });

                        hideTypingIndicator();
                        currentChatId = loadingChatId; // Re-confirm currentChatId after successful load
                        localStorage.setItem('currentChatId', currentChatId);
                        inputArea.style.display = chat.status === 'open' ? 'block' : 'none';

                        setTimeout(() => {
                            messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        }, 100);
                    } catch (error) {
                        console.error('Error loading chat messages:', error);
                        // Ensure error message is only rendered if still on this chat
                        if (currentChatId === loadingChatId) {
                            renderMessage('bot', 'Error loading chat history.', new Date().toISOString());
                        }
                    }
                };

                const loadUserChats = async (email) => {
                    console.log("Widget: Loading user chats for email:", email);
                    try {
                        const response = await fetch(\`https://chatbothubserver.up.railway.app/api/chats/\${chatbotCode}/\${email}\`);
                        const chats = await response.json();

                        chatListDiv.innerHTML = \`
                            <h3 style="margin: 0 0 24px 0; color: #1f2937; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">Your Conversations</h3>
                        \`;

                        if (chats.length === 0) {
                            chatListDiv.innerHTML += \`
                                <div style="text-align: center; padding: 48px 24px; color: #6b7280;">
                                    <div style="
                                        width: 64px; height: 64px; margin: 0 auto 20px;
                                        background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
                                        border-radius: 50%; display: flex; align-items: center; justify-content: center;
                                    ">
                                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="#9ca3af" stroke-width="2"/>
                                        </svg>
                                    </div>
                                    <p style="margin: 0 0 18px 0; font-size: 16px; font-weight: 500;">No conversations yet</p>
                                    <p style="margin: 0; font-size: 14px; font-weight: 400; opacity: 0.8;">Click "Start New Conversation" to begin!</p>
                                </div>
                            \`;
                        } else {
                            // Sort chats by updatedAt to get the most recent one
                            const sortedChats = chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
                            let foundOpenChatForAutoLoad = false; // Flag to ensure only one auto-load happens

                            sortedChats.forEach(chat => {
                                const chatItem = document.createElement('div');
                                chatItem.style.cssText = \`
                                    padding: 20px;
                                    background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
                                    border: 2px solid #e5e7eb;
                                    border-radius: 16px;
                                    margin-bottom: 12px;
                                    cursor: pointer;
                                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                                    backdrop-filter: blur(10px);
                                \`;

                                chatItem.addEventListener('mouseenter', () => {
                                    chatItem.style.borderColor = gradientColor1;
                                    chatItem.style.transform = 'translateY(-2px)';
                                    chatItem.style.boxShadow = \`0 8px 24px \${gradientColor1}20, 0 4px 12px rgba(0, 0, 0, 0.08)\`;
                                });

                                chatItem.addEventListener('mouseleave', () => {
                                    chatItem.style.borderColor = '#e5e7eb';
                                    chatItem.style.transform = 'translateY(0)';
                                    chatItem.style.boxShadow = 'none';
                                });

                                const createdAtDate = new Date(chat.createdAt).toLocaleString();
                                const updatedAtDate = new Date(chat.updatedAt).toLocaleString();

                                chatItem.innerHTML = \`
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                        <strong style="color: #1f2937; font-size: 16px; font-weight: 700; letter-spacing: -0.01em;">\${chat.name}</strong>
                                        <span style="
                                            padding: 6px 12px;
                                            border-radius: 16px;
                                            font-size: 11px;
                                            font-weight: 700;
                                            text-transform: uppercase;
                                            letter-spacing: 0.05em;
                                            \${chat.status === 'open'
                                                ? 'background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #166534; box-shadow: 0 2px 8px rgba(34, 197, 94, 0.2);'
                                                : 'background: linear-gradient(135deg, #fee2e2, #fecaca); color: #991b1b; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.2);'
                                            }
                                        ">\${chat.status}</span>
                                    </div>
                                    <div style="color: #6b7280; font-size: 13px; font-weight: 500; margin-bottom: 4px;">📅 Created: \${createdAtDate}</div>
                                    <div style="color: #6b7280; font-size: 13px; font-weight: 500; margin-bottom: 12px;">🕒 Last Update: \${updatedAtDate}</div>
                                    <div style="color: #9ca3af; font-size: 12px; margin-top: 12px; font-weight: 400; font-style: italic;">💬 Click to view conversation</div>
                                \`;

                                chatItem.addEventListener('click', () => showChatMessages(chat._id));
                                chatListDiv.appendChild(chatItem);

                                // If currentChatId is not set (from localStorage) and an open chat is found, set it as the active chat
                                if (!currentChatId && chat.status === 'open' && !foundOpenChatForAutoLoad) {
                                    currentChatId = chat._id;
                                    localStorage.setItem('currentChatId', currentChatId);
                                    foundOpenChatForAutoLoad = true; // Set flag to only set the first open chat as active
                                    console.log("Widget: Found and set most recent open chat for auto-load:", currentChatId);
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error loading user chats:', error);
                        renderMessage('bot', 'Error loading your chats.', new Date().toISOString());
                    } finally {
                        // *** IMPORTANT: RESET THE FLAG AFTER AUTO-LOAD LOGIC IS EVALUATED ***
                        userInitiatedBackToList = false; // Always reset after loadUserChats completes
                        // *******************************************************************
                    }
                };`

    // Part 17: Final Event Listeners and Initialization
// Part 17: Final Event Listeners and Initialization
// Part 17: Final Event Listeners and Initialization
const widgetScriptPart17 = `
                console.log("Widget: socketScript.onload initiated."); // Super early log

                // Email submission
                emailSubmitBtn.addEventListener('click', async () => {
                    const email = emailInput.value.trim();
                    if (email) {
                        localStorage.setItem('chatbotEmail', email);
                        userEmail = email;
                        console.log("Widget: Email submitted. Transitioning to conversations.");
                        showView('conversations', 'right');
                        loadUserChats(userEmail); // This will handle joining the correct room
                    } else {
                        console.warn("Widget: Email input is empty.");
                        emailInput.style.borderColor = '#ef4444';
                        emailInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.2)';
                        emailInput.focus();
                        setTimeout(() => {
                            emailInput.style.borderColor = '#e5e7eb';
                            emailInput.style.boxShadow = 'none';
                        }, 2000);
                    }
                });

                emailInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        emailSubmitBtn.click();
                    }
                });

                // New chat creation
                newChatBtn.addEventListener('click', async () => {
                    try {
                        messagesContainer.innerHTML = '';
                        showView('chat', 'right');
                        console.log("Widget: Emitting 'create_new_chat'.");
                        socket.emit("create_new_chat", { chatbotCode, email: userEmail });
                    } catch (error) {
                        console.error('Error creating new chat:', error);
                        hideTypingIndicator();
                        renderMessage('bot', 'Error starting a new chat.', new Date().toISOString());
                    }
                });

                // Message sending
                sendBtn.addEventListener("click", async () => {
                    const msg = msgInput.value.trim();
                    if (!msg || !currentChatId) {
                        console.warn("Widget: Cannot send message. Message empty or no currentChatId.");
                        return;
                    }

                    hideTypingIndicator();
                    renderMessage('user', msg, new Date().toISOString());
                    msgInput.value = '';
                    console.log("Widget: Emitting 'message' to server. ChatId:", currentChatId);
                    socket.emit("message", { chatbotCode, chatId: currentChatId, email: userEmail, message: msg, currentWebsiteURL });
                });

                msgInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        sendBtn.click();
                    }
                });

                // Back button
                backBtn.addEventListener('click', showChatList);

                // Socket event listeners
                socket.on("connect", () => {
                    console.log("Chatbot connected:", socket.id);
                    // The primary logic for determining currentChatId and joining rooms
                    // will now happen in the initial load block below.
                    // This 'connect' listener will mostly confirm connection.
                });

                socket.on("new_chat_data", (data) => {
                    console.log("Widget received new_chat_data:", data);
                    currentChatId = data.chat._id;
                    localStorage.setItem('currentChatId', currentChatId);
                    // If a new chat is created, ensure we immediately join its room
                    console.log("Widget: New chat data received. Joining new chat room:", currentChatId);
                    socket.emit("join_chat", { chatId: currentChatId });
                });

                socket.on("reply", (data) => {
                    hideTypingIndicator();
                    console.log("Widget received 'reply' event:", data);
                    // This check is CRUCIAL and works with immediate currentChatId clearing
                    renderMessage(data.sender, data.text, data.timestamp || new Date().toISOString());
                });

                socket.on("bot_typing_start", () => {
                    console.log("Widget received bot_typing_start");
                    showTypingIndicator();
                });

                socket.on("bot_typing_stop", () => {
                    console.log("Widget received bot_typing_stop");
                    hideTypingIndicator();
                });

                socket.on("chat_update", (data) => {
                    console.log("Widget received 'chat_update' event:", data);
                    // This check is CRUCIAL and works with immediate currentChatId clearing
                    if (data.chatId === currentChatId) { 
                        if (data.message && data.sender === "bot") {
                            renderMessage(data.sender, data.message, new Date().toISOString());
                        }
                        if (data.status === 'closed') {
                            inputArea.style.display = 'none';
                            renderMessage('bot', data.message || 'This conversation has been closed.', new Date().toISOString());
                        }
                    } else {
                         console.log("Widget: Ignoring 'chat_update' for non-current chat:", data.chatId, "Current ChatId:", currentChatId);
                    }
                });

                // *** CRITICAL INITIALIZATION LOGIC FOR WIDGET START ***
                // This block runs immediately on script load (after socketScript.onload)
                // ensuring currentChatId and room joining happen reliably.
                console.log("Widget: Checking initial state for userEmail. userEmail:", userEmail, "currentChatId:", currentChatId);
                // Ensure userInitiatedBackToList is reset when the widget initially loads
                userInitiatedBackToList = false; // *** IMPORTANT: Reset on full widget load ***

                if (userEmail) {
                    console.log("Widget: User email found. Loading chats.");
                    // loadUserChats will now determine the 'currentChatId' and handle auto-joining
                    // the most recent open chat, then potentially showing its messages.
                    loadUserChats(userEmail);
                    showView('conversations'); // Show conversations list initially
                } else {
                    console.log("Widget: No user email found. Showing email view.");
                    showView('email');
                }
                // *** END CRITICAL INITIALIZATION LOGIC ***
            };
        })();`

    // Concatenate all parts to form the final widgetScript
    const widgetScript =
      widgetScriptPart1 +
      widgetScriptPart2 +
      widgetScriptPart3 +
      widgetScriptPart4 +
      widgetScriptPart5 +
      widgetScriptPart6 +
      widgetScriptPart7 +
      widgetScriptPart8 +
      widgetScriptPart9 +
      widgetScriptPart10 +
      widgetScriptPart11 +
      widgetScriptPart12 +
      widgetScriptPart13 +
      widgetScriptPart14 +
      widgetScriptPart15 +
      widgetScriptPart16 +
      widgetScriptPart17

    res.type("application/javascript").send(widgetScript)
  } catch (err) {
    console.error("Error during widget loading:", err)
    res.status(500).send("// Internal server error during widget loading.")
  }
})

io.on("connection", (socket) => handleSocket(socket, io))

const PORT = 3001
server.listen(PORT, () => {
  console.log(`Main service running on http://localhost:${PORT}`)
})