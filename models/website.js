import mongoose from 'mongoose';

const websiteSchema = new mongoose.Schema({
    name: { type: String, required: true },
    link: { type: String, required: true },
    description: { type: String },
    predefinedAnswers: { type: String, default: '[]' }, // JSON string
    chatbotCode: { type: String, required: true, unique: true },
    chats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    staffMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }],
    preferences: {
        type: Object,
        default: {
            colors: {
                gradient1: '#667eea',
                gradient2: '#764ba2',
            },
            header: 'Chat Support',
            allowAIResponses: false,
            // ADDED: New path preferences
            allowedPaths: [],   // Array of strings, e.g., ['/', '/contact', '/products']
            disallowedPaths: [], // Array of strings, e.g., ['/admin', '/checkout']
        },
    },
    creditCount: { type: Number, default: 100 },
    lastCreditBoostDate: { type: Date, default: null },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    freeTrial: { type: Date}
}, { timestamps: true });

export default mongoose.model('Website', websiteSchema);