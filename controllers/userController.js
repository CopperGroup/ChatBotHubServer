import jwt from "jsonwebtoken";
import User from "../models/user.js";
import Website from "../models/website.js";
import Plan from "../models/plan.js";
import { changePasswordLinkEmail } from "../services/email.js";

const JWT_SECRET = process.env.JWT_SECRET;
const RESET_PASSWORD_SECRET = process.env.RESET_PASSWORD_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;
const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

export const registerUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required" });

    let user = await User.findOne({ email });
    if (user)
      return res
        .status(400)
        .json({ message: "User with this email already exists" });

    user = new User({ email, password });
    await user.save();

    const payload = { user: { id: user.id, email: user.email } };
    jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" }, (err, token) => {
      if (err) throw err;
      res
        .status(201)
        .json({
          message: "User registered successfully",
          token,
          user: payload.user,
        });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const loginUser = async (req, res) => {
  const { email, password, shopifyUserId, shopifyUserAccessToken } = req.body;
  try {
    if (email && password) {
      const user = await User.findOne({ email });
      if (!user || !(await user.comparePassword(password))) {
        return res.status(400).json({ message: "Invalid Credentials" });
      }

      const payload = { user: { id: user.id, email: user.email } };
      jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" }, (err, token) => {
        if (err) throw err;
        res.json({
          message: "Logged in successfully",
          token,
          user: { ...payload.user, websites: user.websites },
        });
      });
    } else if (shopifyUserId && shopifyUserAccessToken) {
      const user = await User.findOne({ shopifyUserId });
      if (!user)
        return res
          .status(400)
          .json({ message: "No user found with this Shopify ID." });

      user.shopifyUserAccessToken = shopifyUserAccessToken;
      await user.save();

      const payload = { user: { id: user.id, email: user.email } };
      jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" }, (err, token) => {
        if (err) throw err;
        res.json({
          message: "Logged in via Shopify",
          token,
          user: { ...payload.user, websites: user.websites },
        });
      });
    } else {
      return res
        .status(400)
        .json({
          message: "Email and password, or Shopify credentials are required.",
        });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getUserProfile = async (req, res) => {
  try {
    if (req.user.id !== req.params.userId)
      return res.status(403).json({ message: "Unauthorized" });

    const user = await User.findById(req.params.userId)
      .select("-password")
      .populate({
        path: "websites",
        model: Website,
        populate: { path: "plan", model: Plan },
      });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server Error" });
  }
};

export const updateStripeCustomerId = async (req, res) => {
  try {
    const { stripeCustomerId } = req.body;
    if (req.user.id !== req.params.userId)
      return res.status(403).json({ message: "Unauthorized" });

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.stripeCusId = stripeCustomerId;
    await user.save();

    res.status(200).json({ message: "Customer Id added succesfuly" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server Error" });
  }
};

export const updatePreferences = async (req, res) => {
  const { preferences } = req.body;
  try {
    if (req.user.id !== req.params.userId)
      return res.status(403).json({ message: "Unauthorized" });

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.preferences = { ...user.preferences, ...preferences };
    await user.save();

    res.json({
      message: "Preferences updated successfully",
      preferences: user.preferences,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(200)
        .json({ message: "If a user with that email exists..." });

    const resetToken = jwt.sign(
      { id: user._id.toString() },
      RESET_PASSWORD_SECRET,
      { expiresIn: "1h" }
    );
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
    await changePasswordLinkEmail(user.email, resetLink);

    res.status(200).json({ message: "If a user with that email exists..." });
  } catch (err) {
    console.error("Error in forgot-password:", err.message);
    res.status(500).json({ message: "Could not send password reset email." });
  }
};

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Password too short." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, RESET_PASSWORD_SECRET);
    } catch {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const user = await User.findOne({
      _id: decoded.id,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token." });

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("Error in reset-password:", err.message);
    res.status(500).json({ message: "Server Error" });
  }
};

export const getUserPayments = async (req, res) => {
  const userId = req.params.userId;
  try {
    if (req.user.id !== userId)
      return res.status(403).json({ message: "Unauthorized" });

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Missing payment config");
      return res.status(500).json({ message: "Payment config error." });
    }

    const response = await fetch(
      `${PAYMENT_SERVICE_BASE_URL}/payments/users/${userId}`,
      {
        method: "GET",
        headers: {
          "x-main-service-api-key": PAYMENT_SERVICE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error("Payment fetch error:", errorBody);
      throw new Error(`Payment error: ${response.status}`);
    }

    const paymentsData = await response.json();
    res.status(200).json(paymentsData);
  } catch (err) {
    console.error("Error in fetching payments:", err.message);
    res.status(500).send("Server Error");
  }
};
