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
        type: Object, // Mixed type for preferences object
        default: {
            colors: {
                gradient1: '#10b981', // Default primary color
                gradient2: '#059669', // Default secondary color
            },
            header: 'Chat Support', // Default chat header title
            heading: 'Hi there 👋 <br/> How can we help you today?', // New: Default welcome heading
            allowAIResponses: false,
            language: "en",
            dynamiclyAdaptToLanguage: false,
            allowedPaths: [],
            disallowedPaths: [],
            dailyTokenLimit: null,
            scrapePaths: [],
            // New features added to preferences:
            theme: 'light', // 'light' or 'dark'
            branding: true, // true to show "Powered by", false to hide
            tabsMode: true, // true for tab navigation, false for single chat view
            logoUrl: './logo.png', // URL for custom logo image
            bgImageUrl: 'bg-image.png', // URL for background image (if backgroundType is 'image')
            backgroundType: 'gradient', // 'gradient', 'image', or 'solid'
            singleBackgroundColor: '#FFFFFF', // Solid background color (if backgroundType is 'solid')
            quickActions: [], // Array of quick action button objects
            selectedHomeTabHelpArticles: [], // Array of selected help article IDs/titles
            showQuickActions: true, // Controls visibility of Quick Actions section
            showHomeTabHelpSection: true, // Controls visibility of Help Articles section
            showStaffInitials: true, // Controls visibility of Staff Initials
            selectedStaffInitials: [], // Array of selected staff initials (strings)
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