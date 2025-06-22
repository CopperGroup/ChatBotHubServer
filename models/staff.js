// models/staff.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const staffSchema = new mongoose.Schema({
  website: { type: mongoose.Schema.Types.ObjectId, ref: 'Website', required: true },
  email: { type: String, required: true, unique: true }, // john.strike@website.url.com format
  password: { type: String, required: true },
  name: { type: String, required: true }, // e.g., John Strike
}, { timestamps: true });

// Pre-save hook to hash password before saving
staffSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

// Method to compare passwords
staffSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('Staff', staffSchema);