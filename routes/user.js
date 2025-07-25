import express from "express";
import authMiddleware from "../middleware/auth.js";
import {
  registerUser,
  loginUser,
  getUserProfile,
  updateStripeCustomerId,
  updatePreferences,
  forgotPassword,
  resetPassword,
  getUserPayments,
} from "../controllers/userController.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/:userId", authMiddleware, getUserProfile);
router.put("/:userId/customerId", authMiddleware, updateStripeCustomerId);
router.put("/:userId/preferences", authMiddleware, updatePreferences);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/:userId/payments", authMiddleware, getUserPayments);

export const userRoutes = router;
