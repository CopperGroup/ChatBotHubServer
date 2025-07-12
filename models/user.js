// models/user.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    websites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Website' }],
    preferences: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            telegram: false,
            toasts: true,
            sound: true,
            telegramBotSetUp: false
        },
    },
    transactions: [{ type: String }],
    stripeCusId: { type: String },
    // New fields for password reset
    resetPasswordToken: String,
    resetPasswordExpires: Date,
}, { timestamps: true });

// Pre-save hook to hash password before saving
userSchema.pre('save', async function(next) {
    // Only hash the password if the password field has been modified (or is new)
    if (this.isModified('password')) {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    }
    next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);