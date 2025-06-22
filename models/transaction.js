// models/transaction.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Link to the user who made the transaction
    date: { type: Date, default: Date.now }, // Date of the transaction
    amount: { type: Number, required: true }, // Amount of the transaction (e.g., in USD, credits, etc.)
    name: { type: String, required: true }, // Name/description of the transaction (e.g., "Monthly Subscription", "Credit Purchase")
    status: { type: String, enum: ['In progress', 'Successful', 'Failed'], default: 'In progress' }, // Status of the transaction
}, { timestamps: true }); // Automatically adds createdAt and updatedAt

export default mongoose.model('Transaction', transactionSchema);