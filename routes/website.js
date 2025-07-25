import express from "express";
import authMiddleware from "../middleware/auth.js";
import paymentServiceAuth from "../middleware/paymentServiceAuth.js";

import {
  createWebsite,
  getAllWebsites,
  getWebsiteById,
  getWebsiteByLink,
  updateWebsite,
  deleteWebsite,
  changeWebsitePlan,
  confirmPlanChange,
  handleBillingFailure,
  cancelSubscription,
  confirmSubscriptionCancellation,
  freeTrialEnded,
  paymentWarning,
  addCredits,
} from "../controllers/websiteController.js";

const router = express.Router();

// Public or Authenticated routes
router.post("/", createWebsite);
router.get("/", getAllWebsites);
router.get("/:id", getWebsiteById);
router.get("/by-link/search", getWebsiteByLink);
router.put("/:id", updateWebsite);
router.delete("/:id", deleteWebsite);

// Requires Auth
router.put("/:id/change-plan", authMiddleware, changeWebsitePlan);
router.delete("/:id/cancel-subscription", authMiddleware, cancelSubscription);

// Webhook/API auth (internal service calls)
router.put("/:id/confirm-plan-change", paymentServiceAuth, confirmPlanChange);
router.put("/:id/billing-failed", paymentServiceAuth, handleBillingFailure);
router.put(
  "/:id/cancel-subscription-confirmed",
  paymentServiceAuth,
  confirmSubscriptionCancellation
);
router.put("/:id/free-trial-ended", paymentServiceAuth, freeTrialEnded);
router.post("/:id/payment-warning", paymentServiceAuth, paymentWarning);
router.put("/:id/add-credits", paymentServiceAuth, addCredits);

export default router;
