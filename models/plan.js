// models/plan.js
import mongoose from 'mongoose';

const planSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // e.g., "Free", "Basic", "Pro"
  description: { type: String },
  priceMonthly: { type: Number, default: 0 }, // 0 for free plans
  creditBoostMonthly: { type: Number, default: 0 }, // Credits added automatically each month
  allowAI: { type: Boolean, default: false }, // Whether AI responses are allowed by this plan
  maxStaffMembers: { type: Number, default: 2 }, // Maximum number of staff members allowed
  allowPredefinedResponses: { type: Boolean, default: false }, // Whether predefined responses are allowed
});

export default mongoose.model('Plan', planSchema);