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
  getWebsiteFaqs,
  getWebsiteSingleFaq,
  // NEW: Import the new functions
  getAiSummary,
  updateAiSummary,
} from "../controllers/websiteController.js";

const router = express.Router();

// Public or Authenticated routes
router.post("/", createWebsite);
router.get("/", getAllWebsites);
router.get("/:id", getWebsiteById);
router.get("/by-link/search", getWebsiteByLink);
router.put("/:id", authMiddleware, updateWebsite);
router.delete("/:id", authMiddleware, deleteWebsite);
router.get("/faqs/:chatbotCode", getWebsiteFaqs)
router.get("/faqs/:chatbotCode/:faqId", getWebsiteSingleFaq)
// NEW: Unprotected endpoints for AI Summary
// GET /websites/:websiteId/summary - To retrieve the AI summary
router.get("/:websiteId/summary", getAiSummary);
// PUT /websites/:websiteId/summary - To update the AI summary
router.put("/:websiteId/summary", updateAiSummary);

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

export const websiteRoutes = router;