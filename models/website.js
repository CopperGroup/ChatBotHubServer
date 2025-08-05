// models/website.js
import mongoose from 'mongoose';

const websiteSchema = new mongoose.Schema({
    name: { type: String, required: true },
    link: { type: String, required: true },
    description: { type: String },
    predefinedAnswers: { type: String, default: '{"blocks":[{"id":"start","type":"start","name":"Start","message":"Hi! What is your name?","description":"Collect user name.","position":{"x":69,"y":66},"connections":{"output":[]}},{"id":"userResponse1","type":"userResponse","name":"User Response","message":"","description":"Receive user response","position":{"x":520.3999938964844,"y":171.19998168945312},"connections":{"output":[]}},{"id":"end1","type":"end","name":"End","message":"Thank you, please wait for the agent to contact you","description":"End qualification and notify staff","position":{"x":931.3999938964844,"y":285.1999816894531},"connections":{}}],"connections":[{"id":"start-userResponse1--1751194193584","from":"start","to":"userResponse1","fromType":"output","toType":"input"},{"id":"userResponse1-end1--1751194203295","from":"userResponse1","to":"end1","fromType":"output","toType":"input"}],"metadata":{"websiteId":"685d76972d08a290586bc531","createdAt":"2025-06-29T10:56:22.587Z","version":"1.0"}}' }, // JSON string
    chatbotCode: { type: String, required: true, unique: true },
    chats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    staffMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }],
    preferences: {
        type: Object,
        default: {
            colors: {
                gradient1: '#00bc7c',
                gradient2: '#009a67',
            },
            header: 'Chat Bot Hub',
            heading: {
                text: 'Hi there 👋 <br/> How can we help you today?',
                color: '#1f2937',
                shadow: true,
                shadowColor: '#efebeb',
                fontSize: '24px'
            },
            allowAIResponses: false,
            language: "en",
            dynamiclyAdaptToLanguage: false,
            allowedPaths: [],
            disallowedPaths: [],
            dailyTokenLimit: null,
            scrapePaths: ["/blog","/blog/multi-language-support","/blog/workflow-automation-v12","/blog/telegram-notifications","/blog/ai-agent-credits","/blog/staff-management-system","/blog/customer-support-automation","/blog/chatbot-integration-guide","/"],
            theme: 'light',
            branding: true,
            tabsMode: true,
            logoUrl: './logo.png', // The provided object doesn't have a logoUrl, so we retain the default.
            bgImageUrl: 'bg-image.png',
            backgroundType: 'image',
            singleBackgroundColor: '#d10a0a',
            quickActions: [{
                text: "Send us a message",
                deepLinkType: "internal",
                internalTab: "messages",
                internalView: "chat",
                icon: "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke-width=\"1.5\" stroke=\"currentColor\" height=\"16\" width=\"16\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5\" /></svg>"
            }, {
                text: "Get help",
                deepLinkType: "internal",
                internalTab: "help",
                icon: "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke-width=\"1.5\" stroke=\"currentColor\" height=\"16\" width=\"16\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z\" /></svg>"
            }],
            selectedHomeTabHelpArticles: [],
            showQuickActions: true,
            showHomeTabHelpSection: false,
            showStaffInitials: true,
            selectedStaffInitials: [],
            bgColor: '#000000'
        },
    },
    creditCount: { type: Number, default: 100 },
    lastCreditBoostDate: { type: Date, default: null },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    freeTrial: { type: Date},
    freeTrialPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    freeTrialEnded: { type: Boolean, default: false },
    lastProcessedPaymentId: { type: String, unique: true, sparse: true },
    stripeSubscriptionId: { type: String, default: null },
    billedSuccessfuly: { type: Boolean, default: false },
    exlusiveCustomer: { type: Boolean, default: false },
    aiSummary: { type: String, default: ""},
    shopifyAccessToken: { type: String, default: null },
    faqs: [
        {
            title: String,
            description: String,
            answer: String,
        }
    ]
}, { timestamps: true });

export default mongoose.model('Website', websiteSchema);