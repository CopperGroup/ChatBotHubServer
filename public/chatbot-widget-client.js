(function() {
    // --- Configuration for the chatbot ---
    const chatbotConfig = window.chatbotConfig;

    console.log(chatbotConfig)
    // A single function to encapsulate all the initialization logic
    async function initializeChatbot() {
        if (!chatbotConfig) {
            console.error("[Chatbot Widget] Configuration object 'chatbotConfig' not found.");
            return;
        }

        console.log(chatbotConfig)
        const result = await fetch(`${chatbotConfig.backendUrl}/widget/validate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },          
            body: JSON.stringify({
                chatbotCode: chatbotConfig.chatbotCode,
                requestOrigin: window.location.href,
            })
        });
        
        const displayWidget = await result.json();

        if(!displayWidget.allowed) return;

        // Define the CSS for the skeleton and iframe
        const widgetStyles = `
            /* Iframe Styles */
            .chatbot-iframe {
                position: fixed;
                bottom: 1.5rem; /* Default for larger screens */
                right: 1.5rem;  /* Default for larger screens */
                width: 5rem;    /* Default for larger screens */
                height: 5rem;   /* Default for larger screens */
                border: none;
                z-index: 10000;
                opacity: 0; /* Initially hidden */
            }
            .chatbot-iframe.loaded {
                opacity: 1; /* Visible when loaded */
            }

            /* Media queries for smaller screens */
            @media (max-width: 500px) {
                .chatbot-iframe {
                    bottom: 0.5rem;
                    right: 0.5rem;
                }
            }
        `;

        // Create a style element and append the CSS to the head
        const styleElement = document.createElement('style');
        styleElement.textContent = widgetStyles;
        document.head.appendChild(styleElement);


        // Create iframe and skeleton elements
        const iframe = document.createElement('iframe');
        iframe.src = "https://widjet.chatboth.com"; // IMPORTANT: Update this path to your actual chatbot.html file
        iframe.title = "Chatbot Widget";
        iframe.className = "chatbot-iframe";
        iframe.id = "chatbot-iframe";
        iframe.style.display = 'none'; // Initially hidden to prevent flash of content

        const skeleton = document.createElement('div');
        skeleton.id = "chatbot-skeleton";

        // Append the iframe and skeleton to the document body
        document.body.appendChild(iframe);
        document.body.appendChild(skeleton);

        if (iframe && skeleton) {
            // Hide skeleton and show iframe when iframe loads

            function checkAndToggleWidgetVisibility() {
                const currentPathname = window.location.pathname;

                function shouldDisplayWidget() {
                    const allowed = chatbotConfig.allowedPaths || [];
                    const disallowed = chatbotConfig.disallowedPaths || [];

                    let isAllowedByRules = true;
                    if (allowed.length > 0) {
                        isAllowedByRules = allowed.some(path =>
                            path === "/" ? currentPathname === "/" : currentPathname.startsWith(path)
                        );
                    }

                    let isDisallowedByRules = false;
                    if (disallowed.length > 0) {
                        isDisallowedByRules = disallowed.some(path =>
                            path === "/" ? currentPathname === "/" : currentPathname.startsWith(path)
                        );
                    }
                    
                    const isDisplayed = isAllowedByRules && !isDisallowedByRules;
                    console.log(`[Chatbot] shouldDisplayWidget: ${isDisplayed}. Path: ${currentPathname}`);
                    return isDisplayed;
                }

                const widget = iframe;
                const shouldDisplay = shouldDisplayWidget();

                // Toggle visibility based on the path rules
                if (shouldDisplay) {
                    widget.style.display = ""; // Show the iframe
                    // The 'loaded' class and opacity will be handled by the 'load' event listener
                } else {
                    widget.style.display = "none"; // Hide the iframe
                }
            }
            
            // Initial check for the widget's visibility
            checkAndToggleWidgetVisibility();

            // Monkey-patch pushState and replaceState to detect SPA navigation
            const originalPushState = history.pushState;
            history.pushState = function() {
                originalPushState.apply(this, arguments);
                checkAndToggleWidgetVisibility();
            };

            const originalReplaceState = history.replaceState;
            history.replaceState = function() {
                originalReplaceState.apply(this, arguments);
                checkAndToggleWidgetVisibility();
            };

            // This listener ensures the iframe becomes visible after its content has loaded
            iframe.addEventListener('load', () => {
                skeleton.style.display = 'none'; // Hide the skeleton
                iframe.classList.add('loaded'); // Add 'loaded' class to show iframe

                // Send the config data to the iframe once it's loaded
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage({
                        type: 'chatbotConfig',
                        config: chatbotConfig
                    }, '*'); // Use '*' or specify your iframe's origin for security
                }
            });

            // Message listener for iframe resizing
            window.addEventListener('message', (event) => {
                // IMPORTANT: For security, verify the origin of the message.
                // You should define this more robustly in a production environment.
                const chatbotIframeOrigin = new URL(iframe.src).origin;
                if (event.origin !== chatbotIframeOrigin) {
                    // console.warn('Message from untrusted origin:', event.origin);
                    return;
                }

                if (!iframe) {
                    console.warn('Chatbot iframe not found.');
                    return;
                }

                const isMobile = window.innerWidth < 425; // Define mobile breakpoint, consistent with your CSS media query

                if (event.data && event.data.type === 'chatbotExpand') {
                    if (isMobile) {
                        iframe.style.width = '100vw';
                        iframe.style.height = '100vh';
                        iframe.style.bottom = '0';
                        iframe.style.right = '0';
                        iframe.style.borderRadius = '0'; // No border radius for full screen
                    } else {
                        iframe.style.width = event.data.width; // Use passed width (e.g., '400px')
                        iframe.style.height = event.data.height; // Use passed height (e.g., '629px')
                        iframe.style.bottom = '1.5rem'; // Revert to default bottom for larger screens
                        iframe.style.right = '1.5rem';  // Revert to default right for larger screens
                        iframe.style.borderRadius = '20px'; // Rounded corners for desktop expanded
                    }
                    iframe.style.boxShadow = "0 25px 80px rgba(0, 0, 0, 0.15), 0 10px 40px rgba(0, 0, 0, 0.1)";
                } else if (event.data && (event.data.type === 'chatbotCollapse' || event.data.type === 'initialized')) {
                    // Delay the collapse for smoother transition if expanded
                    setTimeout(() => {
                        iframe.style.width = '80px'; // Revert to collapsed button size
                        iframe.style.height = '80px'; // Revert to collapsed button size
                        iframe.style.boxShadow = 'none';

                        // Revert bottom/right to their default collapsed values (from CSS)
                        // This logic should align with the CSS media queries for .chatbot-iframe
                        if (window.innerWidth < 500) { // Using 500px as defined in your CSS for collapsed state
                            iframe.style.bottom = '0.5rem';
                            iframe.style.right = '0.5rem';
                        } else {
                            iframe.style.bottom = '1.5rem';
                            iframe.style.right = '1.5rem';
                        }
                    }, 500); // This delay should match or be slightly less than the iframe's CSS transition time
                }
            });
        } else {
            console.warn('Chatbot iframe or skeleton element not found.');
        }
    }

    // This is the key part to make it robust against timing issues.
    if (document.readyState === 'loading') {
        // If the DOM is not yet ready, wait for it.
        document.addEventListener('DOMContentLoaded', initializeChatbot);
    } else {
        // If the DOM is already ready, run the initialization function immediately.
        initializeChatbot();
    }
})();