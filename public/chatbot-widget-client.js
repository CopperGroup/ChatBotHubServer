(function () {
  // These variables will be injected by the server
  // via the global window.chatbotConfig object.
  let gradientColor1;
  let gradientColor2;
  let headerTitle;
  let allowAIResponsesFromBackend;
  let injectedAllowedPaths;
  let injectedDisallowedPaths;
  let t; // translated phrases
  let chatbotCode;
  let currentWebsiteURL;
  let socketIoUrl; // This will be passed from server.js
  let backendUrl;
  let currentLangCode; // Injected language code from the server (default or detected)
  let dynamicLanguage; // Injected boolean to enable/disable dynamic language detectionG

  // Global widget variables
  let userEmail = localStorage.getItem("chatbotEmail");
  let currentChatId = localStorage.getItem("currentChatId");
  let isAskingForName = false; // Not used in provided parts, keep for context
  let isExpanded = false;
  let isTyping = false;
  let currentView = "email"; // 'email', 'conversations', 'chat'
  // NEW GLOBAL VARIABLE: Controls the visibility of the input area for the current chat
  let isInputVisible = true; // Default value: input is shown initially

  // --- Core function to check path and toggle widget display ---
  function checkAndToggleWidget() {
    const currentPathname = window.location.pathname;

    function checkVisibility() {
      // Retrieve injectedAllowedPaths and injectedDisallowedPaths directly
      // inside checkVisibility to ensure they are updated after config load.
      const allowed = injectedAllowedPaths;
      const disallowed = injectedDisallowedPaths;

      // Add a safety check for 'undefined' or 'null' values for allowed/disallowed
      // before trying to access .length or .some().
      if (!Array.isArray(allowed) || !Array.isArray(disallowed)) {
        // console.warn("[Chatbot] 'allowed' or 'disallowed' paths are not arrays. Defaulting to hidden.");
        return false; // Safely exit if paths are not correctly initialized
      }

      let isAllowedByRules = true; // Assume allowed unless rules dictate otherwise

      if (allowed.length > 0) {
        isAllowedByRules = allowed.some((path) => {
          return path === "/"
            ? currentPathname === "/"
            : currentPathname.startsWith(path);
        });
      }

      let isDisallowedByRules = false;
      if (disallowed.length > 0) {
        isDisallowedByRules = disallowed.some((path) => {
          return path === "/"
            ? currentPathname === "/"
            : currentPathname.startsWith(path);
        });
      }

      // The condition for displaying the widget is if it's allowed by rules AND NOT disallowed by rules
      return isAllowedByRules && !isDisallowedByRules;
    }

    let attempts = 0;
    const maxAttempts = 3;
    const delays = [200, 300, 700];

    function tryToggleWidget() {
      shouldDisplayWidget = checkVisibility();
      const widget = document.getElementById("chatbot-widget");

      if (widget) {
        if (shouldDisplayWidget) {
          widget.style.display = "";
          // console.log(`[Chatbot] Widget visible after ${attempts + 1} attempt(s).`);
        } else {
          widget.style.display = "none";
          // console.warn("[Chatbot] Widget not loaded: path restrictions apply or element not found after retries.");
        }
        return;
      }

      if (attempts < maxAttempts) {
        attempts++;
        // console.log(`[Chatbot] Widget element not found yet. Retrying in ${delays[attempts - 1]}ms (Attempt ${attempts}/${maxAttempts}).`);
        setTimeout(tryToggleWidget, delays[attempts - 1]);
      } else {
        // console.warn("[Chatbot] Widget element not found after all retries. Widget will not be displayed.");
        if (widget) {
          widget.style.display = "none";
        }
      }
    }

    // Start the process
    tryToggleWidget();
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
  window.addEventListener("popstate", () => {
    // console.log("[Chatbot] popstate detected");
    checkAndToggleWidget();
  });

  // Monkey-patch pushState and replaceState to detect SPA navigation
  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    // console.log("[Chatbot] pushState detected");
    checkAndToggleWidget();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    // console.log("[Chatbot] replaceState detected");
    checkAndToggleWidget();
  };

  // console.log("[Chatbot] Widget will be displayed.");

  // Load Socket.IO script dynamically
  const socketScript = document.createElement("script");
  socketScript.src = "https://cdn.socket.io/4.7.2/socket.io.min.js";
  document.head.appendChild(socketScript);

  const markedScript = document.createElement("script");
  markedScript.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
  document.head.appendChild(markedScript);

  markedScript.onload = () => {
    // console.log("marked.js loaded");
  };

  socketScript.onload = async () => {
    // Made async to await language fetching
    // Retrieve injected configurations
    const config = window.chatbotConfig || {};
    gradientColor1 = config.gradient1;
    gradientColor2 = config.gradient2;
    headerTitle = config.headerText;
    allowAIResponsesFromBackend = config.allowAIResponses;
    injectedAllowedPaths = config.allowedPaths;
    injectedDisallowedPaths = config.disallowedPaths;
    // t = config.translatedPhrases; // This will now be loaded dynamically
    currentLangCode = config.language; // Server-injected default or detected language
    dynamicLanguage = config.allowDynamicLanguage; // Server-injected boolean
    chatbotCode = config.chatbotCode;
    currentWebsiteURL = window.location.href; // Still get current URL from client
    socketIoUrl = config.socketIoUrl; // Injected from server
    backendUrl = config.backendUrl;

    // --- LANGUAGE DETECTION AND LOADING LOGIC ---
    let browserLanguage = navigator.language || navigator.userLanguage;
    let languageCode = browserLanguage.split("-")[0]; // Take the first part (e.g., "en" from "en-US")

    if (dynamicLanguage) {
      try {
        // Fetch possible languages from the backend first
        const languagesResponse = await fetch(
          `${backendUrl}/getPossibleLanguages`
        );
        if (!languagesResponse.ok) {
          throw new Error(`HTTP error! status: ${languagesResponse.status}`);
        }
        const possibleLanguages = await languagesResponse.json();

        let languageToFetch = languageCode;

        if (!possibleLanguages.includes(languageCode)) {
          if (languageCode !== "en") {
            languageToFetch = "en"; // Fallback to English if browser language not supported and not already English
          } else {
            // If browser language is "en" but not in possibleLanguages (shouldn't happen if "en" is default)
            // Or if possibleLanguages is empty, we still default to "en" implicitly.
            console.warn(
              "Chatbot: Browser language 'en' not in possible languages or list is empty. Using 'en' as fallback."
            );
            languageToFetch = "en";
          }
        }

        // Make the request to get interface language translations
        const translationResponse = await fetch(
          `${backendUrl}/getInterfaceLanguage/${languageToFetch}`
        );
        if (!translationResponse.ok) {
          throw new Error(`HTTP error! status: ${translationResponse.status}`);
        }
        t = await translationResponse.json();
        // console.log(`Chatbot: Loaded translations for: ${languageToFetch}`);
      } catch (error) {
        console.error(
          "Chatbot: Error fetching dynamic language translations:",
          error
        );
        // Fallback to server-injected 't' if dynamic loading fails or use a hardcoded default
        // If config.translatedPhrases is available, use it as a last resort.
        t = config.translatedPhrases || {
          "We're here to help!": "We're here to help!",
          "Welcome!": "Welcome!",
          "Please enter your email address to start a conversation with our support team.":
            "Please enter your email address to start a conversation with our support team.",
          "Enter your email address": "Enter your email address",
          "Start Conversation": "Start Conversation",
          "Your Conversations": "Your Conversations",
          "Select a chat or start new one": "Select a chat or start new one",
          "Live Chat": "Live Chat",
          "Connected with support": "Connected with support",
          "No conversations yet": "No conversations yet",
          'Click "Start New Conversation" to begin!':
            'Click "Start New Conversation" to begin!',
          "✨ Start New Conversation": "✨ Start New Conversation",
          "Type your message...": "Type your message...",
          "Please choose an option to continue.":
            "Please choose an option to continue.",
          You: "You",
          Bot: "Bot",
          "AI Assistant": "AI Assistant",
          "Support Team": "Support Team",
          Owner: "Owner",
          "Error loading chat history.": "Error loading chat history.",
          "Error loading your chats.": "Error loading your chats.",
          "Created:": "Created:",
          "Last Update:": "Last Update:",
          "Click to view conversation": "Click to view conversation",
          open: "open",
          closed: "closed",
          "Error starting a new chat.": "Error starting a new chat.",
          "This conversation has been closed.":
            "This conversation has been closed.",
        };
        console.log(
          "Chatbot: Falling back to default or server-injected translations."
        );
      }
    } else {
      // If dynamicLanguage is false, use the server-injected translated phrases directly
      t = config.translatedPhrases;
      // console.log("Chatbot: Dynamic language disabled. Using server-injected translations.");
    }
    // --- END LANGUAGE DETECTION AND LOADING LOGIC ---

    // --- CSS Styles and Animations ---
    const style = document.createElement("style");
    style.textContent = `
            /* Widget Animations */
            @keyframes slideUp { from { opacity: 0; transform: translateY(30px) scale(0.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
            @keyframes slideDown { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(30px) scale(0.9); } }
            @keyframes slideInFromRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
            @keyframes slideInFromLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes messageSlideIn { from { opacity: 0; transform: translateY(15px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
            @keyframes pulse { 0% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } 100% { opacity: 0.4; transform: scale(1); } }
            
            /* Enhanced closing animations */
            @keyframes smoothSlideDown { 0% { opacity: 1; transform: translateY(0) scale(1); visibility: visible; } 50% { opacity: 0.7; transform: translateY(15px) scale(0.98); } 100% { opacity: 0; transform: translateY(30px) scale(0.95); visibility: hidden; } }
            
            @keyframes buttonFadeIn { from { opacity: 0; transform: scale(0.8) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            
            .smooth-slide-down { animation: smoothSlideDown 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
            .headerTitleElement { color: white !important; }
            .button-fade-in { animation: buttonFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both; }
            
            /* View Transitions */
            .view-transition-enter { animation: slideInFromRight 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
            .view-transition-exit { animation: slideInFromLeft 0.4s cubic-bezier(0.4, 0, 0.2, 1) reverse; }
            .slide-down { animation: slideDown 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
            
            /* Message Components */
            .message-bubble { animation: messageSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            .typing-indicator-bubble { display: flex; justify-content: flex-start; margin-bottom: 20px; animation: fadeIn 0.3s ease-out; }
            .typing-indicator-bubble .message-content { max-width: 80%; padding: 16px 20px; border-radius: 20px 20px 20px 6px; font-size: 14px; line-height: 1.5; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); color: #374151; border: 1px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04); backdrop-filter: blur(10px); }
            .typing-indicator-bubble .typing-dots { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
            .typing-indicator-bubble .typing-dots span { display: inline-block; width: 10px; height: 10px; background: linear-gradient(135deg, #6b7280, #9ca3af); border-radius: 50%; animation: pulse 1.6s infinite ease-in-out both; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
            .typing-indicator-bubble .typing-dots span:nth-child(1) { animation-delay: 0.2s; }
            .typing-indicator-bubble .typing-dots span:nth-child(2) { animation-delay: 0.4s; }
            .typing-indicator-bubble .typing-dots span:nth-child(3) { animation-delay: 0.6s; }
            
            /* Scrollbar Styles */
            .chatbot-scrollbar::-webkit-scrollbar { width: 8px; }
            .chatbot-scrollbar::-webkit-scrollbar-track { background: linear-gradient(to bottom, #f8fafc, #f1f5f9); border-radius: 4px; }
            .chatbot-scrollbar::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #cbd5e1, #94a3b8); border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.2); }
            .chatbot-scrollbar::-webkit-scrollbar-thumb:hover { background: linear-gradient(to bottom, #94a3b8, #64748b); }
            
            .message-bubble a {
                color: #10b981; /* Default to Tailwind's emerald-500 */
                text-decoration: underline;
                font-weight: 600; /* Keep bold for emphasis */
                transition: all 0.2s ease-in-out;
            }

            .message-bubble a:hover {
                color: #059669; /* Slightly darker emerald for hover state (emerald-600) */
                text-decoration: none; /* Remove underline on hover for a cleaner look */
            }
            @media (max-width: 440px) { #chat-window { width: 100%; max-width: 340px; } #chatbot-widget { right: 12px !important; bottom: 12px !important; } }
            @media (max-width: 360px) { #chat-window { width: 100%; max-width: 320px; } #chatbot-widget { right: 10px !important; bottom: 10px !important; } #chatbot-input-area { padding: 14px !important; } #msg { padding: 10px 14px !important; } #sendBtn { padding: 10px 14px !important; } }
            @media (max-width: 340px) { #chat-window { width: 100%; max-width: 310px; } #chatbot-widget { right: 8px !important; bottom: 8px !important; } }
        `;
    document.head.appendChild(style);

    // --- Widget Container and Chat Button ---
    const widget = document.createElement("div");
    widget.id = "chatbot-widget";
    widget.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            display: none;
        `;

    const chatButton = document.createElement("div");
    chatButton.id = "chat-button";
    chatButton.style.cssText = `
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, ${gradientColor1} 0%, ${gradientColor2} 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 12px 40px ${gradientColor1}30, 0 4px 16px rgba(0, 0, 0, 0.1);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            backdrop-filter: blur(10px);
        `;

    chatButton.innerHTML = `
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;

    chatButton.addEventListener("mouseenter", () => {
      chatButton.style.transform = "scale(1.1) translateY(-2px)";
      chatButton.style.boxShadow = `0 16px 50px ${gradientColor1}40, 0 8px 24px rgba(0, 0, 0, 0.15)`;
    });

    chatButton.addEventListener("mouseleave", () => {
      chatButton.style.transform = "scale(1) translateY(0)";
      chatButton.style.boxShadow = `0 12px 40px ${gradientColor1}30, 0 4px 16px rgba(0, 0, 0, 0.1)`;
    });

    // --- Chat Window Container ---
    const chatWindow = document.createElement("div");
    chatWindow.id = "chat-window";
    chatWindow.style.cssText = `
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
        `;

    // --- Header Component ---
    const createHeader = () => {
      const header = document.createElement("div");
      header.id = "chat-header";
      header.style.cssText = `
                background: linear-gradient(135deg, ${gradientColor1} 0%, ${gradientColor2} 100%);
                color: white;
                padding: 24px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-shrink: 0;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                position: relative;
                overflow: hidden;
            `;

      const backBtn = document.createElement("button");
      backBtn.id = "back-to-chats";
      backBtn.style.cssText = `
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
            `;
      backBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;

      const headerContent = document.createElement("div");
      headerContent.style.cssText = "flex: 1; text-align: center;";
      headerContent.innerHTML = `
                <h3 id="header-title" style="margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; transition: all 0.3s ease; color: white !important;">${headerTitle}</h3>
                <p id="header-subtitle" style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9; font-weight: 400; transition: all 0.3s ease;">${t["We're here to help!"]}</p>
            `;

      const closeBtn = document.createElement("button");
      closeBtn.id = "close-chat";
      closeBtn.style.cssText = `
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
            `;
      closeBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;

      // Hover effects
      [backBtn, closeBtn].forEach((btn) => {
        btn.addEventListener("mouseenter", () => {
          btn.style.background = "rgba(255, 255, 255, 0.25)";
          btn.style.transform = "scale(1.05)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "rgba(255, 255, 255, 0.15)";
          btn.style.transform = "scale(1)";
        });
      });

      header.appendChild(backBtn);
      header.appendChild(headerContent);
      header.appendChild(closeBtn);
      return header;
    };

    // --- Content Container ---
    const createContentContainer = () => {
      const chatContent = document.createElement("div");
      chatContent.id = "chatbot-content";
      chatContent.style.cssText = `
                flex: 1;
                display: flex;
                flex-direction: column;
                background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
                min-height: 0;
                overflow: hidden;
                position: relative;
            `;
      return chatContent;
    };

    // --- Email Input Component ---
    const createEmailInputArea = () => {
      const emailInputArea = document.createElement("div");
      emailInputArea.id = "email-input-area";
      emailInputArea.style.cssText = `
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
            `;
      emailInputArea.className = "chatbot-scrollbar";

      emailInputArea.innerHTML = `
                <div style="
                    width: 88px;
                    min-height: 88px;
                    height: 88px;
                    background: linear-gradient(135deg, ${gradientColor1} 0%, ${gradientColor2} 100%);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 8px 32px ${gradientColor1}30, 0 4px 16px rgba(0, 0, 0, 0.1);
                ">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="white" stroke-width="2"/>
                        <polyline points="22,6 12,13 2,6" stroke="white" stroke-width="2"/>
                    </svg>
                </div>
                <h3 style="margin: 0 0 12px 0; color: #1f2937; font-size: 22px; font-weight: 700; letter-spacing: -0.02em;">${t["Welcome!"]}</h3>
                <p style="margin: 0 0 28px 0; color: #6b7280; font-size: 15px; line-height: 1.6; font-weight: 400;">
                    ${t["Please enter your email address to start a conversation with our support team."]}
                </p>
                <input id="emailInput" type="email" placeholder="${t["Enter your email address"]}" style="
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
                    background: linear-gradient(135deg, ${gradientColor1} 0%, ${gradientColor2} 100%);
                    color: white;
                    border: none;
                    border-radius: 12px;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 4px 16px ${gradientColor1}30;
                    letter-spacing: 0.02em;
                ">${t["Start Conversation"]}</button>
            `;
      return emailInputArea;
    };

    // --- Conversations List Component ---
    const createConversationsList = () => {
      const chatListDiv = document.createElement("div");
      chatListDiv.id = "chat-list";
      chatListDiv.style.cssText = `
                flex: 1;
                overflow-y: auto;
                padding: 24px;
                display: none;
                min-height: 0;
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            `;
      chatListDiv.className = "chatbot-scrollbar";
      return chatListDiv;
    };

    const createNewChatButton = () => {
      const newChatBtnContainer = document.createElement("div");
      newChatBtnContainer.id = "new-chat-button-container";
      newChatBtnContainer.style.cssText = `
                padding: 24px;
                background: rgba(255, 255, 255, 0.95);
                border-top: 1px solid #e5e7eb;
                display: none;
                flex-shrink: 0;
                backdrop-filter: blur(20px);
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            `;
      newChatBtnContainer.innerHTML = `
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
                ">${t["✨ Start New Conversation"]}</button>
            `;
      return newChatBtnContainer;
    };

    // --- Messages Container Component ---
    const createMessagesContainer = () => {
      const messagesContainer = document.createElement("div");
      messagesContainer.id = "messages-container";
      messagesContainer.style.cssText = `
                flex: 1;
                overflow-y: auto;
                padding: 24px;
                display: none;
                min-height: 0;
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            `;
      messagesContainer.className = "chatbot-scrollbar";
      return messagesContainer;
    };

    const createTypingIndicator = () => {
      const typingIndicatorBubble = document.createElement("div");
      typingIndicatorBubble.className = "typing-indicator-bubble";
      typingIndicatorBubble.id = "typing-indicator-bubble";
      typingIndicatorBubble.style.display = "none";

      typingIndicatorBubble.innerHTML = `
                <div class="message-content">
                    <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; opacity: 0.8; letter-spacing: 0.02em;">${t["Support Team"]}</div>
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            `;
      return typingIndicatorBubble;
    };

    // --- Input Area Component ---
    const createInputArea = () => {
      const inputArea = document.createElement("div");
      inputArea.id = "chatbot-input-area";
      inputArea.style.cssText = `
                padding: 24px;
                border-top: 1px solid #e5e7eb;
                background: rgba(255, 255, 255, 0.95);
                display: block; // Always display the container, manage inner divs
                flex-shrink: 0;
                backdrop-filter: blur(20px);
                opacity: 0; /* Initially hidden, will be managed by updateInputAreaVisibility */
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            `;

      inputArea.innerHTML = `
                <div id="input-field-container" style="display: flex; gap: 12px;">
                    <input id="msg" placeholder="${t["Type your message..."]}" style="
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
                        background: linear-gradient(135deg, ${gradientColor1} 0%, ${gradientColor2} 100%);
                        color: white;
                        border: none;
                        border-radius: 12px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        box-shadow: 0 4px 16px ${gradientColor1}30;
                        display: flex; /* Added to center the SVG */
                        align-items: center; /* Added to center the SVG */
                        justify-content: center; /* Added to center the SVG */
                    ">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
                <div id="input-status-message" style="
                    text-align: center;
                    color: #6b7280;
                    font-size: 14px;
                    padding: 14px 18px;
                    background: #f1f5f9;
                    border-radius: 12px;
                    display: none; /* Hidden by default */
                ">${t["Please choose an option to continue."]}</div>
            `;
      return inputArea;
    };

    // --- Message Rendering Component ---
    const createMessageBubble = (
      sender,
      text,
      timestamp,
      options = [],
      isReplySent = false
    ) => {
      const messageDiv = document.createElement("div");
      messageDiv.className = "message-bubble";
      messageDiv.style.cssText = `
                margin-bottom: 20px;
                display: flex;
                ${
                  sender === "user"
                    ? "justify-content: flex-end;"
                    : "justify-content: flex-start;"
                }
            `;

      let bubbleBg = "";
      let bubbleTextColor = "";
      let senderLabel = "";
      let borderRadius = "20px";
      let avatarHtml = "";
      let iconSvg = "";

      // ... (existing sender-specific styling and labels) ...
      if (sender === "user") {
        bubbleBg = `linear-gradient(135deg, ${gradientColor1} 0%, ${gradientColor2} 100%)`;
        bubbleTextColor = "white";
        senderLabel = t["You"];
        borderRadius = "20px 20px 6px 20px";
      } else if (sender === "bot") {
        bubbleBg = "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)";
        bubbleTextColor = "#374151";
        senderLabel = t["Bot"];
        borderRadius = "20px 20px 20px 6px";
        iconSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="4" r="1" fill="currentColor"/><rect x="11.5" y="5" width="1" height="1.5" fill="currentColor"/><path d="M12 6.5c-4.5 0-6 2-6 5.5v3c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-3c0-3.5-1.5-5.5-6-5.5z" fill="currentColor"/><circle cx="12" cy="12" r="4.5" fill="white"/><ellipse cx="10" cy="11.5" rx="1" ry="1.2" fill="currentColor"/><ellipse cx="14" cy="11.5" rx="1" ry="1.2" fill="currentColor"/></svg>`;
        avatarHtml = `
                    <div style="
                        width: 32px; height: 32px; border-radius: 50%;
                        background: linear-gradient(135deg, #f97316 0%, #fbbf24 100%);
                        display: flex; align-items: center; justify-content: center;
                        position: absolute; right: -16px; top: -16px;
                        box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3), 0 2px 4px rgba(0,0,0,0.1);
                        border: 2px solid white;
                        color: white;
                    ">${iconSvg}</div>
                `;
      } else if (sender === "ai") {
        bubbleBg = "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)";
        bubbleTextColor = "#374151";
        senderLabel = t["AI Assistant"];
        borderRadius = "20px 20px 20px 6px";
        iconSvg = `
                <svg
                    width="18" height="18" viewBox="0 0 24 24"
                    fill="none" xmlns="http://www.w3.org/2000/svg"
                    style="padding-left: 4px;">
                    <path
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                        stroke="currentColor" stroke-width="1.5" fill="none"
                    />
                </svg>
                `;

        avatarHtml = `
                    <div style="
                        width: 32px; height: 32px; border-radius: 50%;
                        background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
                        display: flex; align-items: center; justify-content: center;
                        position: absolute; right: -16px; top: -16px;
                        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3), 0 2px 4px rgba(0,0,0,0.1);
                        border: 2px solid white;
                        color: white;
                    ">
                    ${iconSvg}
                    </div>
                `;
      } else if (sender.startsWith("staff-")) {
        // This covers staff and owners (formatted as staff-<Name>)
        const staffName = sender.split("-")[1];
        bubbleBg = "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)";
        bubbleTextColor = "#374151";
        senderLabel = staffName;
        borderRadius = "20px 20px 20px 6px";
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" fill="currentColor"/></svg>`;
        avatarHtml = `
                    <div style="
                        width: 32px; height: 32px; border-radius: 50%;
                        background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
                        display: flex; align-items: center; justify-content: center;
                        position: absolute; right: -16px; top: -16px;
                        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3), 0 2px 4px rgba(0,0,0,0.1);
                        border: 2px solid white;
                        color: white;
                    ">${iconSvg}</div>
                `;
      } else if (sender === "owner") {
        bubbleBg = "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)";
        bubbleTextColor = "#374151";
        senderLabel = t["Owner"];
        borderRadius = "20px 20px 20px 6px";
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>`;
        avatarHtml = `
                    <div style="
                        width: 32px; height: 32px; border-radius: 50%;
                        background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
                        display: flex; align-items: center; justify-content: center;
                        position: absolute; right: -16px; top: -16px;
                        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4), 0 2px 4px rgba(0,0,0,0.1);
                        border: 2px solid white;
                        color: white;
                    ">${iconSvg}</div>
                `;
      }
      // ... (end of existing sender-specific styling and labels) ...

      const messageBubble = document.createElement("div");
      messageBubble.style.cssText = `
                max-width: 80%;
                min-width: 30%;
                padding: 12px 20px;
                border-radius: ${borderRadius};
                font-size: 15px;
                line-height: 1.5;
                word-wrap: break-word;
                background: ${bubbleBg};
                color: ${bubbleTextColor};
                position: relative;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.2); ${
                  sender === "user" ? "border: none;" : ""
                }
                backdrop-filter: blur(10px);
                font-weight: 400;
            `;

      if (sender !== "user") {
        messageBubble.innerHTML += avatarHtml;
      }

      // Convert Markdown to HTML here
      // Ensure marked.js is loaded and available as `marked`
      const markdownToHtml =
        typeof marked !== "undefined" ? marked.parse(text) : text;

      messageBubble.innerHTML += `
                <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; opacity: 0.8; letter-spacing: 0.02em; ${
                  sender === "user" ? "color: rgba(255,255,255,0.8);" : ""
                }">
                    ${senderLabel}
                </div>
                <div style="font-weight: 400;">${markdownToHtml}</div>
                <div style="font-size: 11px; opacity: 0.6; text-align: ${
                  sender === "user" ? "right" : "left"
                }; margin-top: 6px; ${
        sender === "user" ? "color: rgba(255,255,255,0.7);" : ""
      } font-weight: 400;">
                    ${new Date(timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                </div>
            `;

      messageDiv.appendChild(messageBubble);

      // Add options as clickable buttons if they exist
      if (options && options.length > 0) {
        const optionsContainer = document.createElement("div");
        optionsContainer.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    gap: 8px; /* Simple padding between options */
                    margin-top: 15px;
                    width: 100%; /* Ensure it takes full width for column layout */
                `;
        options.forEach((optionText) => {
          const optionButton = document.createElement("button");
          optionButton.className = "option-button"; // Add a class for styling
          optionButton.textContent = optionText;
          // MODIFIED STYLES FOR OPTIONS & DISABLED STATE
          optionButton.style.cssText = `
                        padding: 10px 15px;
                        background: none; /* No background */
                        color: #374151; /* Darker text color for better readability on light bubble */
                        border: none; /* No border */
                        border-radius: 8px;
                        font-size: 14px;
                        font-weight: 600; /* Semibold */
                        cursor: pointer;
                        transition: all 0.2s ease;
                        text-align: left; /* Align text to the left */
                        box-shadow: none; /* No box-shadow */
                        outline: none; /* Remove outline on focus */
                        ${
                          isReplySent
                            ? "opacity: 0.6; pointer-events: none; cursor: default;"
                            : ""
                        }
                    `;
          if (!isReplySent) {
            // Only add hover effects and click listener if not disabled
            optionButton.addEventListener("mouseenter", () => {
              optionButton.style.color = gradientColor1; // Change text color on hover
              optionButton.style.transform = "translateX(5px)"; // Subtle slide effect
            });
            optionButton.addEventListener("mouseleave", () => {
              optionButton.style.color = "#374151"; // Revert text color
              optionButton.style.transform = "translateX(0)";
            });
            optionButton.addEventListener("click", () => {
              if (currentChatId) {
                // Disable all option buttons in this message block immediately
                const parentMessageBubble =
                  optionButton.closest(".message-bubble");
                if (parentMessageBubble) {
                  const allButtonsInThisBubble =
                    parentMessageBubble.querySelectorAll(".option-button");
                  allButtonsInThisBubble.forEach((btn) => {
                    btn.disabled = true;
                    btn.style.opacity = "0.6";
                    btn.style.cursor = "default";
                    btn.style.pointerEvents = "none"; // Remove hover effects
                    btn.style.cursor = "default"; // Remove hover effects
                  });
                }

                renderMessage("user", optionText, new Date().toISOString());
                socket.emit("message", {
                  chatbotCode,
                  chatId: currentChatId,
                  email: userEmail,
                  message: optionText,
                  currentWebsiteURL,
                });

                // NEW: After selecting an option, explicitly hide the input field
                // and show the "Please choose an option" message.
                // It will be re-evaluated when the bot replies.
                updateInputAreaVisibility(false);
                // console.log("Widget: Option clicked (user message sent). Hiding input field until bot replies.");
              }
            });
          }
          optionsContainer.appendChild(optionButton);
        });
        messageBubble.appendChild(optionsContainer);
      }

      return messageDiv;
    };

    // --- View Management System ---
    const updateHeaderForView = (view) => {
      const headerTitleElement = document.getElementById("header-title");
      const headerSubtitle = document.getElementById("header-subtitle");
      const backBtn = document.getElementById("back-to-chats");

      switch (view) {
        case "email":
          headerTitleElement.textContent = headerTitle;
          headerSubtitle.textContent = t["We're here to help!"];
          backBtn.style.display = "none";
          break;
        case "conversations":
          headerTitleElement.textContent = t["Your Conversations"];
          headerSubtitle.textContent = t["Select a chat or start new one"];
          backBtn.style.display = "none";
          break;
        case "chat":
          headerTitleElement.textContent = t["Live Chat"];
          headerSubtitle.textContent = t["Connected with support"];
          backBtn.style.display = "flex";
          break;
      }
    };

    const showView = (viewName, direction = "right") => {
      const views = {
        email: emailInputArea,
        conversations: chatListDiv,
        chat: messagesContainer,
      };

      const footers = {
        conversations: newChatBtnContainer,
        chat: inputArea,
      };

      // Hide all views with animation
      Object.values(views).forEach((view) => {
        if (view.style.display !== "none") {
          view.style.opacity = "0";
          view.style.transform =
            direction === "right" ? "translateX(-20px)" : "translateX(20px)";
          setTimeout(() => {
            view.style.display = "none";
          }, 200);
        }
      });

      // Hide all footers
      Object.values(footers).forEach((footer) => {
        if (footer && footer.style.opacity !== "0") {
          // Check opacity to see if it's already fading out
          footer.style.opacity = "0";
          setTimeout(() => {
            footer.style.display = "none";
          }, 200);
        }
      });

      // Show target view with animation
      setTimeout(() => {
        const targetView = views[viewName];
        const targetFooter = footers[viewName];

        if (targetView) {
          targetView.style.display = viewName === "email" ? "flex" : "block";
          targetView.style.transform =
            direction === "right" ? "translateX(20px)" : "translateX(-20px)";
          targetView.style.opacity = "0";

          setTimeout(() => {
            targetView.style.opacity = "1";
            targetView.style.transform = "translateX(0)";
          }, 50);
        }

        if (targetFooter) {
          targetFooter.style.display = "block"; // Always show the inputArea container
          setTimeout(() => {
            targetFooter.style.opacity = "1";
            // Further manage internal visibility using updateInputAreaVisibility if it's the chat view
            if (viewName === "chat") {
              updateInputAreaVisibility(isInputVisible);
            }
          }, 100);
        }

        updateHeaderForView(viewName);
        currentView = viewName;
      }, 200);
    };

    // NEW FUNCTION: Manages the visibility of the input field vs. the status message
    const updateInputAreaVisibility = (showInput) => {
      const inputFieldContainer = document.getElementById(
        "input-field-container"
      );
      const inputStatusMessage = document.getElementById(
        "input-status-message"
      );
      const inputArea = document.getElementById("chatbot-input-area");

      if (!inputFieldContainer || !inputStatusMessage || !inputArea) return;

      if (showInput) {
        inputFieldContainer.style.display = "flex";
        inputStatusMessage.style.display = "none";
        isInputVisible = true;
        // console.log("Widget: updateInputAreaVisibility: Showing input field, hiding status message.");
      } else {
        inputFieldContainer.style.display = "none";
        inputStatusMessage.style.display = "block";
        isInputVisible = false;
        // console.log("Widget: updateInputAreaVisibility: Hiding input field, showing status message.");
      }
      // Ensure the main input area container is visible (opacity handled by showView)
      inputArea.style.display = "block";
      inputArea.style.opacity = "1";
    };

    // --- Widget Assembly and Initialization ---
    // Create all components
    const header = createHeader();
    const chatContent = createContentContainer();
    const emailInputArea = createEmailInputArea();
    const chatListDiv = createConversationsList();
    const messagesContainer = createMessagesContainer();
    const typingIndicatorBubble = createTypingIndicator();
    const inputArea = createInputArea(); // Input area element is created here
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

    // Get elements (re-get after appending to DOM for robustness)
    const closeBtn = document.getElementById("close-chat");
    const backBtn = document.getElementById("back-to-chats");
    const msgInput = document.getElementById("msg");
    const sendBtn = document.getElementById("sendBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const emailInput = document.getElementById("emailInput");
    const emailSubmitBtn = document.getElementById("emailSubmitBtn");

    // --- Event Handlers and Interactions ---
    // Enhanced input focus effects
    const addInputEffects = () => {
      [emailInput, msgInput].forEach((input) => {
        input.addEventListener("focus", () => {
          input.style.borderColor = gradientColor1;
          input.style.boxShadow = `0 0 0 3px ${gradientColor1}20`;
          input.style.transform = "translateY(-1px)";
        });
        input.addEventListener("blur", () => {
          input.style.borderColor = "#e5e7eb";
          input.style.boxShadow = "none";
          input.style.transform = "translateY(0)";
        });
      });

      [emailSubmitBtn, sendBtn].forEach((btn) => {
        btn.addEventListener("mouseenter", () => {
          btn.style.transform = "translateY(-2px)";
          btn.style.boxShadow = `0 8px 24px ${gradientColor1}40`;
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.transform = "translateY(0)";
          btn.style.boxShadow = `0 4px 16px ${gradientColor1}30`;
        });
      });

      newChatBtn.addEventListener("mouseenter", () => {
        newChatBtn.style.background =
          "linear-gradient(135deg, #e5e7eb 0%, #d1d5db 100%)";
        newChatBtn.style.transform = "translateY(-1px)";
        newChatBtn.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.08)";
      });
      newChatBtn.addEventListener("mouseleave", () => {
        newChatBtn.style.background =
          "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)";
        newChatBtn.style.transform = "translateY(0)";
        newChatBtn.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.04)";
      });
    };

    addInputEffects();

    // Widget toggle with enhanced smooth closing animation
    const toggleWidget = () => {
      if (isExpanded) {
        // Add smooth closing animation
        chatWindow.classList.remove("slide-down");
        chatWindow.classList.add("smooth-slide-down");

        // Hide the window after animation completes
        setTimeout(() => {
          chatWindow.style.display = "none";
          chatWindow.classList.remove("smooth-slide-down");

          // Show button with fade-in animation
          chatButton.style.display = "flex";
          chatButton.classList.add("button-fade-in");

          // Remove the fade-in class after animation
          setTimeout(() => {
            chatButton.classList.remove("button-fade-in");
          }, 500);

          isExpanded = false;
        }, 500);
      } else {
        chatButton.style.display = "none";
        chatWindow.style.display = "flex";
        chatWindow.classList.remove("slide-down", "smooth-slide-down");
        isExpanded = true;

        // Initialize view based on user state
        if (!userEmail) {
          showView("email");
        } else {
          showView("conversations");
          loadUserChats(userEmail); // Will call loadUserChats after view transition
        }
      }
    };

    chatButton.addEventListener("click", toggleWidget);
    closeBtn.addEventListener("click", toggleWidget);

    // --- Core Functionality - Socket and Message Handling ---
    // console.log("chatbotCode:", chatbotCode);
    // console.log("currentWebsiteURL:", currentWebsiteURL);

    const socket = io(socketIoUrl, {
      // Use the injected socketIoUrl
      path: "/socket.io",
      query: { chatbotCode, currentWebsiteURL },
      transports: ["websocket", "polling"],
    });

    // console.log(socket)
    // Message rendering function
    const renderMessage = (
      sender,
      text,
      timestamp,
      options = [],
      isReplySent = false
    ) => {
      const messageBubble = createMessageBubble(
        sender,
        text,
        timestamp,
        options,
        isReplySent
      );
      messagesContainer.appendChild(messageBubble);
      // This setTimeout ensures the DOM has updated before trying to scroll
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 50);

      // The logic for updating input visibility is now primarily handled by the 'reply' or 'chat_update' events
      // and the optionButton click listener, not directly here, unless it's a user message.
      if (sender === "user") {
        // When a user sends a message, assume input should be visible for the next turn,
        // unless the preceding bot message had options that are now considered 'replied to'.
        // The actual visibility update will happen when the bot replies.
        // console.log("Widget: renderMessage: User message. Input state will be determined by next bot reply.");
      } else {
        // Bot/AI/staff message
        // If a bot sends a message with options, and it's the latest message, hide the input field.
        // If it sends a message without options, show the input field.
        if (options && options.length > 0 && !isReplySent) {
          updateInputAreaVisibility(false); // Hide input, show "choose option" message
          // console.log("Widget: renderMessage: Bot message with options. Hiding input.");
        } else {
          updateInputAreaVisibility(true); // Show input
          // console.log("Widget: renderMessage: Bot message without options or options replied to. Showing input.");
        }
      }
    };

    // Typing indicator functions
    const showTypingIndicator = () => {
      if (isTyping) return;
      if (messagesContainer.lastChild !== typingIndicatorBubble) {
        messagesContainer.appendChild(typingIndicatorBubble);
      }
      typingIndicatorBubble.style.display = "flex";
      isTyping = true;
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 50);
    };

    const hideTypingIndicator = () => {
      typingIndicatorBubble.style.display = "none";
      isTyping = false;
    };

    // View navigation functions
    const showChatList = () => {
      localStorage.removeItem("currentChatId");
      currentChatId = null;

      // console.log("Widget: Navigating to chat list. currentChatId cleared.");
      hideTypingIndicator();
      messagesContainer.innerHTML = "";

      // When going back to chat list, reset input visibility to default (visible)
      updateInputAreaVisibility(true);

      if (!userEmail) {
        showView("email");
      } else {
        showView("conversations");
        loadUserChats(userEmail); // Will call loadUserChats after view transition
        showView("conversations", "left");
      }
    };

    // CRITICAL CHANGE: Load messages FIRST, then show view
    const showChatMessages = async (chatId) => {
      // console.log("Widget: showChatMessages called for chat:", chatId);
      currentChatId = chatId;
      localStorage.setItem("currentChatId", currentChatId);

      socket.emit("join_chat", { chatId: chatId });

      await loadMessages(chatId);

      showView("chat", "right");
      // console.log("Widget: Messages loaded. Navigating to chat view.");

      // Adjust this timeout to be AFTER the showView transition finishes + a small buffer
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        // console.log("Widget: Scrolled to bottom after chat view transition.");
      }, 450); // Keep this to ensure scroll
    };

    // --- Data Loading Functions ---
    const loadMessages = async (chatId) => {
      // console.log("Widget: Attempting to load messages for chat:", chatId);
      const loadingChatId = chatId;

      try {
        if (!loadingChatId) {
          messagesContainer.innerHTML = "";
          currentChatId = null;
          localStorage.removeItem("currentChatId");
          // console.log("Widget: ChatId is null, cleared messages and currentChatId.");
          return;
        }

        const response = await fetch(
          `${backendUrl}/api/chats/${loadingChatId}`
        );
        const chat = await response.json();
        // console.log("Widget: Fetched chat data:", chat);

        if (currentChatId !== loadingChatId) {
          // console.warn("Widget: Aborting message load for old chat ID as currentChatId changed.");
          return;
        }

        messagesContainer.innerHTML = "";

        const loadedMessages = chat.messages ? JSON.parse(chat.messages) : [];
        // console.log("Widget: Parsed loaded messages:", loadedMessages);

        let lastBotMessageWithOptionsPresent = false;
        let userRepliedAfterLastOptions = false;

        loadedMessages.forEach((msg, index) => {
          let isReplySentForThisOptionsBlock = false;
          if (msg.options && msg.options.length > 0) {
            lastBotMessageWithOptionsPresent = true; // Flag that we encountered options
            userRepliedAfterLastOptions = false; // Reset for this options block
            for (let i = index + 1; i < loadedMessages.length; i++) {
              if (loadedMessages[i].sender === "user") {
                userRepliedAfterLastOptions = true;
                break;
              }
            }
            isReplySentForThisOptionsBlock = userRepliedAfterLastOptions;
          } else {
            // If a message without options is encountered after options, and it's a bot message,
            // it means the bot continued the conversation without needing options.
            // If it's a user message, it means the user replied.
            // In either case, subsequent messages mean options were "resolved"
            lastBotMessageWithOptionsPresent = false;
          }
          renderMessage(
            msg.sender,
            msg.text,
            msg.timestamp,
            msg.options,
            isReplySentForThisOptionsBlock
          );
        });

        hideTypingIndicator();
        currentChatId = loadingChatId;
        localStorage.setItem("currentChatId", currentChatId);

        // --- CRITICAL REFINED LOGIC FOR INPUT AREA VISIBILITY (POST-LOAD) ---
        // This logic determines the final state of the input area after all messages are loaded.
        if (chat.status === "closed") {
          updateInputAreaVisibility(false); // Chat closed, hide input
          // console.log("Widget: Load: Chat is closed. Input will be hidden.");
        } else if (
          lastBotMessageWithOptionsPresent &&
          !userRepliedAfterLastOptions
        ) {
          // If the last bot message had options, and no user replied after it, hide input.
          updateInputAreaVisibility(false);
          // console.log(`Widget: Load: Last bot message had options and no user reply after. Input will be hidden.`);
        } else {
          // Default: show input if chat is open and no unresolved options
          updateInputAreaVisibility(true);
          // console.log("Widget: Load: No unresolved options or chat is open. Input will be shown.");
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        // --- END CRITICAL REFINED LOGIC ---
      } catch (error) {
        // console.error('Error loading chat messages:', error);
        if (currentChatId === loadingChatId) {
          renderMessage(
            "bot",
            t["Error loading chat history."],
            new Date().toISOString()
          );
        }
      }
    };

    const loadUserChats = async (email) => {
      // console.log("Widget: Loading user chats for email:", email);
      try {
        // console.log(backendUrl)
        const response = await fetch(
          `${backendUrl}/api/chats/${chatbotCode}/${email}`
        );
        // console.log(response)
        const chats = await response.json();

        chatListDiv.innerHTML = `
                    <h3 style="margin: 0 0 24px 0; color: #1f2937; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">${t["Your Conversations"]}</h3>
                `;

        if (chats.length === 0) {
          chatListDiv.innerHTML += `
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
                            <p style="margin: 0 0 18px 0; font-size: 16px; font-weight: 500;">${t["No conversations yet"]}</p>
                            <p style="margin: 0; font-size: 14px; font-weight: 400; opacity: 0.8;">${t['Click "Start New Conversation" to begin!']}</p>
                        </div>
                    `;
        } else {
          const sortedChats = chats.sort(
            (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
          );
          let foundOpenChatForAutoLoad = false;

          sortedChats.forEach((chat) => {
            const chatItem = document.createElement("div");
            chatItem.style.cssText = `
                            padding: 20px;
                            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
                            border: 2px solid #e5e7eb;
                            border-radius: 16px;
                            margin-bottom: 12px;
                            cursor: pointer;
                            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                            backdrop-filter: blur(10px);
                        `;

            chatItem.addEventListener("mouseenter", () => {
              chatItem.style.borderColor = gradientColor1;
              chatItem.style.transform = "translateY(-2px)";
              chatItem.style.boxShadow = `0 8px 24px ${gradientColor1}20, 0 4px 12px rgba(0, 0, 0, 0.08)`;
            });

            chatItem.addEventListener("mouseleave", () => {
              chatItem.style.borderColor = "#e5e7eb";
              chatItem.style.transform = "translateY(0)";
              chatItem.style.boxShadow = "none";
            });

            const createdAtDate = new Date(chat.createdAt).toLocaleString();
            const updatedAtDate = new Date(chat.updatedAt).toLocaleString();

            chatItem.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <strong style="color: #1f2937; font-size: 16px; font-weight: 700; letter-spacing: -0.01em;">${
                                  chat.name
                                }</strong>
                                <span style="
                                    padding: 6px 12px;
                                    border-radius: 16px;
                                    font-size: 11px;
                                    font-weight: 700;
                                    text-transform: uppercase;
                                    letter-spacing: 0.05em;
                                    ${
                                      chat.status === "open"
                                        ? "background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #166534; box-shadow: 0 2px 8px rgba(34, 197, 94, 0.2);"
                                        : "background: linear-gradient(135deg, #fee2e2, #fecaca); color: #991b1b; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.2);"
                                    }
                                ">${t[chat.status]}</span>
                            </div>
                            <div style="color: #6b7280; font-size: 13px; font-weight: 500; margin-bottom: 4px;">📅 ${
                              t["Created:"]
                            } ${createdAtDate}</div>
                            <div style="color: #6b7280; font-size: 13px; font-weight: 500; margin-bottom: 12px;">🕒 ${
                              t["Last Update:"]
                            } ${updatedAtDate}</div>
                            <div style="color: #9ca3af; font-size: 12px; margin-top: 12px; font-weight: 400; font-style: italic;">💬 ${
                              t["Click to view conversation"]
                            }</div>
                        `;

            chatItem.addEventListener("click", () =>
              showChatMessages(chat._id)
            );
            chatListDiv.appendChild(chatItem);

            if (
              !currentChatId &&
              chat.status === "open" &&
              !foundOpenChatForAutoLoad
            ) {
              currentChatId = chat._id;
              localStorage.setItem("currentChatId", currentChatId);
              foundOpenChatForAutoLoad = true;
              // console.log("Widget: Found and set most recent open chat for auto-load:", currentChatId);
            }
          });
        }
      } catch (error) {
        // console.error('Error loading user chats:', error);
        renderMessage(
          "bot",
          t["Error loading your chats."],
          new Date().toISOString()
        );
      } finally {
        // userInitiatedBackToList is not used in the provided code, can be removed if not needed elsewhere
      }
    };

    // --- Final Event Listeners and Initialization ---
    // console.log("Widget: socketScript.onload initiated.");

    // Email submission
    emailSubmitBtn.addEventListener("click", async () => {
      const email = emailInput.value.trim();
      if (email) {
        localStorage.setItem("chatbotEmail", email);
        userEmail = email;
        // console.log("Widget: Email submitted. Transitioning to conversations.");
        showView("conversations", "right");
        loadUserChats(userEmail);
      } else {
        // console.warn("Widget: Email input is empty.");
        emailInput.style.borderColor = "#ef4444";
        emailInput.style.boxShadow = "0 0 0 3px rgba(239, 68, 68, 0.2)";
        emailInput.focus();
        setTimeout(() => {
          emailInput.style.borderColor = "#e5e7eb";
          emailInput.style.boxShadow = "none";
        }, 2000);
      }
    });

    emailInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        emailSubmitBtn.click();
      }
    });

    // New chat creation
    newChatBtn.addEventListener("click", async () => {
      try {
        messagesContainer.innerHTML = "";
        showView("chat", "right");
        // When starting a new chat, the input should always be visible
        updateInputAreaVisibility(true);
        const countryRes = await fetch("https://ipwho.is/");

        const data = await countryRes.json();
        // console.log("Widget: Emitting 'create_new_chat'.");
        socket.emit("create_new_chat", {
          chatbotCode,
          email: userEmail,
          country: {
            country: data.country,
            countryCode: data.country_code,
            flag: data.flag.img,
          },
        });
      } catch (error) {
        // console.error('Error creating new chat:', error);
        hideTypingIndicator();
        renderMessage(
          "bot",
          t["Error starting a new chat."],
          new Date().toISOString()
        );
      }
    });

    // Message sending
    sendBtn.addEventListener("click", async () => {
      const msg = msgInput.value.trim();
      if (!msg || !currentChatId) {
        // console.warn("Widget: Cannot send message. Message empty or no currentChatId.");
        return;
      }

      // --- NEW LOGIC TO DISABLE PREVIOUS OPTIONS ---
      // When a user sends a message, any existing options from previous bot messages should be disabled.
      const allMessageBubbles =
        messagesContainer.querySelectorAll(".message-bubble");
      allMessageBubbles.forEach((bubble) => {
        const optionButtons = bubble.querySelectorAll(".option-button");
        optionButtons.forEach((button) => {
          button.disabled = true;
          button.style.opacity = "0.6";
          button.style.cursor = "default";
          // Optionally, remove hover effects if they were added
          button.onmouseenter = null;
          button.onmouseleave = null;
        });
      });
      // --- END NEW LOGIC ---

      hideTypingIndicator();
      renderMessage("user", msg, new Date().toISOString());
      msgInput.value = "";
      // console.log("Widget: Emitting 'message' to server. ChatId:", currentChatId);

      // точка
      socket.emit("message", {
        chatbotCode,
        chatId: currentChatId,
        email: userEmail,
        message: msg,
        currentWebsiteURL,
      });

      // NEW: After user sends a regular message, explicitly show the input field
      updateInputAreaVisibility(true);
      // console.log("Widget: Regular message sent by user. Showing input field.");
    });

    msgInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendBtn.click();
      }
    });

    // Back button
    backBtn.addEventListener("click", showChatList);

    // Socket event listeners
    socket.on("connect", () => {
      // console.log("Chatbot connected:");
    });

    socket.on("new_chat_data", (data) => {
      // console.log("Widget received new_chat_data:", data);
      currentChatId = data.chat._id;
      localStorage.setItem("currentChatId", currentChatId);
      // console.log("Widget: New chat data received. Joining new chat room:", currentChatId);
      socket.emit("join_chat", { chatId: currentChatId });
    });

    socket.on("reply", (data) => {
      hideTypingIndicator();
      // console.log("Widget received 'reply' event:", data);
      // The renderMessage function now handles setting isInputVisible and updating inputArea display
      // This is the primary trigger for showing/hiding the input based on bot response.
      renderMessage(
        data.sender,
        data.text,
        data.timestamp || new Date().toISOString(),
        data.options
      );
    });

    socket.on("bot_typing_start", () => {
      // console.log("Widget received bot_typing_start");
      showTypingIndicator();
    });

    socket.on("bot_typing_stop", () => {
      // console.log("Widget received bot_typing_stop");
      hideTypingIndicator();
    });

    socket.on("chat_update", (data) => {
      // console.log("Widget received 'chat_update' event:", data);
      if (data.chatId === currentChatId) {
        if (data.message && data.sender === "bot") {
          // Chat update with a new message (e.g., from an agent)
          renderMessage(
            data.sender,
            data.message,
            new Date().toISOString(),
            data.options
          );
        }
        if (data.status === "closed") {
          updateInputAreaVisibility(false); // Chat closed, hide input permanently
          // console.log("Widget: Chat_update: Chat status changed to closed. Hiding input.");
          // Render message if it wasn't already part of the `data.message` above
          if (!data.message) {
            renderMessage(
              "bot",
              t["This conversation has been closed."],
              new Date().toISOString()
            );
          }
        } else if (data.status === "open") {
          // If chat becomes open, and the *last message* (whether from this update or previously)
          // doesn't have options, show the input.
          // console.log("Widget: Chat_update: Chat status changed to open. Re-evaluating input visibility.");
          // Re-evaluate input visibility based on the very last message in the container
          const lastMessageElement = messagesContainer.lastElementChild;
          if (
            lastMessageElement &&
            lastMessageElement.classList.contains("message-bubble")
          ) {
            const optionButtons =
              lastMessageElement.querySelectorAll(".option-button");
            // If the last message in the UI *still* has active options, keep input hidden
            if (
              optionButtons.length > 0 &&
              Array.from(optionButtons).some((btn) => !btn.disabled)
            ) {
              updateInputAreaVisibility(false);
            } else {
              // No options in the last message, or options were disabled, so show input.
              updateInputAreaVisibility(true);
            }
          } else {
            // No messages or last message is typing indicator, default to showing input.
            updateInputAreaVisibility(true);
          }
        }
      } else {
        // console.log("Widget: Ignoring 'chat_update' for non-current chat:", data.chatId, "Current ChatId:", currentChatId);
      }
    });

    // --- CRITICAL INITIALIZATION LOGIC FOR WIDGET START ---
    // console.log("Widget: Checking initial state for userEmail. userEmail:", userEmail, "currentChatId:", currentChatId);

    if (userEmail) {
      // console.log("Widget: User email found. Loading chats.");
      loadUserChats(userEmail);
      showView("conversations");
    } else {
      // console.log("Widget: No user email found. Showing email view.");
      showView("email");
    }
    // Initial setup for input area visibility
    updateInputAreaVisibility(isInputVisible);
    // --- END CRITICAL INITIALIZATION LOGIC ---
  }; // End of socketScript.onload function
})(); // End of IIFE
