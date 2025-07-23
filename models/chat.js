import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    messages: { type: String, default: '[]' }, // stored as JSON string
    aiResponsesEnabled: { type: Boolean, default: true },
    leadingStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null },
    currentWorkflowBlockId: { type: String },
    country: { 
        type: Object,
        default: {
            country: null,
            countryCode: null,
            flag: null,
        }
    },
    avatar: { type: String },
    // NEW FIELD: Reference to the parent Website
    website: { type: mongoose.Schema.Types.ObjectId, ref: 'Website', required: true } // Added this line
}, { timestamps: true });

export default mongoose.model('Chat', chatSchema);