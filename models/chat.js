import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    messages: { type: String, default: '[]' }, // stored as JSON string
    aiResponsesEnabled: { type: Boolean, default: true },
    // NEW FIELD: Reference to the Staff member leading this chat
    leadingStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null } // Optional, can be null
}, { timestamps: true }); // This option automatically adds createdAt and updatedAt fields

export default mongoose.model('Chat', chatSchema);