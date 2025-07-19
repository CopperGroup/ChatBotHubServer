// routes/website.js
import express from "express";
import Website from "../models/website.js";
import User from "../models/user.js";
import Plan from "../models/plan.js";
import Staff from "../models/staff.js";
import Chat from "../models/chat.js";
import authMiddleware from "../middleware/auth.js";
import paymentServiceAuth from "../middleware/paymentServiceAuth.js";
import axios from "axios";

import {
  addAllowedOrigin,
  removeAllowedOrigin,
  replaceAllowedOrigin,
} from "../services/allowedOrigins.js";

import {
  subscriptionSuccessEmail,
  subscriptionFailedEmail,
  firstSubscriptionEmail,
  tokenPurchaseSuccessEmail,
  billingWarningEmail,
  freeTrialEndWarningEmail,
} from "../services/email.js"; // Import all email functions

const router = express.Router();

// --- Configuration for Plan Controller Service ---
let PLAN_CONTROLLER_SERVICE_URL = "http://localhost:3002"; // Default fallback
let FREE_TRIAL_DURATION_DAYS = 14; // Default fallback

// Helper function to fetch shared variables at startup
async function fetchSharedVariables() {
  const sharedVariablesServiceUrl = process.env.SHARED_VARIABLES_SERVICE_URL || "http://localhost:3001";
  const sharedVariablesServiceApiKey = process.env.SHARED_VARIABLES_SERVICE_API_KEY;

  if (!sharedVariablesServiceUrl || !sharedVariablesServiceApiKey) {
    console.warn("Shared Variables Service URL or API Key not configured in main service .env. Using fallback values.");
    return;
  }

  try {
    const [planControllerUrlRes, freeTrialDurationRes] = await Promise.all([
      axios.get(`${sharedVariablesServiceUrl}/variables/PLAN_CONTROLLER_SERVICE_URL`, {
        headers: { 'x-api-key': sharedVariablesServiceApiKey }
      }),
      axios.get(`${sharedVariablesServiceUrl}/variables/FREE_TRIAL_DURATION_DAYS`, {
        headers: { 'x-api-key': sharedVariablesServiceApiKey }
      })
    ]);

    if (planControllerUrlRes.data.status === 'success' && planControllerUrlRes.data.value) {
      PLAN_CONTROLLER_SERVICE_URL = planControllerUrlRes.data.value;
      console.log(`[Main Service] Fetched PLAN_CONTROLLER_SERVICE_URL: ${PLAN_CONTROLLER_SERVICE_URL}`);
    } else {
      console.warn("[Main Service] PLAN_CONTROLLER_SERVICE_URL not found in Shared Variables. Using fallback.");
    }

    if (freeTrialDurationRes.data.status === 'success' && freeTrialDurationRes.data.value) {
      FREE_TRIAL_DURATION_DAYS = parseInt(freeTrialDurationRes.data.value, 10);
      console.log(`[Main Service] Fetched FREE_TRIAL_DURATION_DAYS: ${FREE_TRIAL_DURATION_DAYS}`);
    } else {
      console.warn("[Main Service] FREE_TRIAL_DURATION_DAYS not found in Shared Variables. Using fallback.");
    }

  } catch (error) {
    console.error("[Main Service] Error fetching shared variables:", error.message);
    console.warn("[Main Service] Using fallback values for Plan Controller URL and Free Trial Duration.");
  }
}

// Fetch shared variables once at application startup
fetchSharedVariables();

// Helper function to get Pro plan
async function getProPlanId() {
  const proPlan = await Plan.findOne({ name: "Pro" });
  if (!proPlan) {
    throw new Error("Pro plan not found. Please ensure default plans are seeded and a 'Pro' plan exists.");
  }
  return proPlan._id;
}

// Helper function to get Free plan
async function getFreePlanId() {
  const freePlan = await Plan.findOne({ name: "Free" });
  if (!freePlan) {
    throw new Error("Free plan not found. Please ensure default plans are seeded or handle this state.");
  }
  return freePlan._id;
}

/**
 * Sends website plan state updates to the Plan Controller Service.
 * This is the primary function for Main Service to update Plan Controller.
 * @param {string} websiteId
 * @param {string} planId
 * @param {Date | null} freeTrialStartDate - Null if no free trial or trial has ended
 * @param {Date | null} nextBillingDate - Null if subscription cancelled or trial ended
 * @returns {Promise<void>}
 */
async function sendPlanStateToPlanController(websiteId, planId, freeTrialStartDate, nextBillingDate) {
  if (!PLAN_CONTROLLER_SERVICE_URL) {
    console.error(`[Main Service] Skipping Plan Controller update: PLAN_CONTROLLER_SERVICE_URL is not set.`);
    return;
  }
  const planControllerApiKey = process.env.PLAN_CONTROLLER_SERVICE_API_KEY;

  if (!planControllerApiKey) {
    console.error(`[Main Service] Skipping Plan Controller update: PLAN_CONTROLLER_SERVICE_API_KEY is not set.`);
    return;
  }

  try {
    console.log(`[Main Service] Sending plan state update for website ${websiteId} to Plan Controller.`);
    await axios.post(`${PLAN_CONTROLLER_SERVICE_URL}/plan-states`, {
      websiteId,
      planId,
      freeTrialStartDate: freeTrialStartDate ? freeTrialStartDate.toISOString() : null,
      nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : null, // Ensure null is sent as ISO string or null
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': planControllerApiKey
      }
    });
    console.log(`[Main Service] Plan state update sent successfully for website ${websiteId}.`);
  } catch (error) {
    console.error(`[Main Service] Failed to send plan state update for website ${websiteId} to Plan Controller:`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      console.error("[Main Service] Plan Controller Error:", error.response.data);
    }
  }
}

/**
 * Sends next billing date updates to the Plan Controller Service.
 * This function is now deprecated in favor of sendPlanStateToPlanController for consistency.
 * It's kept here for reference but will not be called in the new logic.
 * @param {string} websiteId
 * @param {Date | null} nextBillingDate
 * @returns {Promise<void>}
 */
/*
async function sendNextBillingDateToPlanController(websiteId, nextBillingDate) {
  if (!PLAN_CONTROLLER_SERVICE_URL) {
    console.error(`[Main Service] Skipping Plan Controller update: PLAN_CONTROLLER_SERVICE_URL is not set.`);
    return;
  }
  const planControllerApiKey = process.env.PLAN_CONTROLLER_SERVICE_API_KEY;

  if (!planControllerApiKey) {
    console.error(`[Main Service] Skipping Plan Controller update: PLAN_CONTROLLER_SERVICE_API_KEY is not set.`);
    return;
  }

  try {
    console.log(`[Main Service] Sending next billing date update for website ${websiteId} to Plan Controller.`);
    await axios.put(`${PLAN_CONTROLLER_SERVICE_URL}/plan-states/${websiteId}/update-billing-date`, {
      nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : null,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': planControllerApiKey
      }
    });
    console.log(`[Main Service] Next billing date update sent successfully for website ${websiteId}.`);
  } catch (error) {
    console.error(`[Main Service] Failed to send next billing date update for website ${websiteId} to Plan Controller:`, error.message);
    if (axios.isAxiosError(error) && error.response) {
      console.error("[Main Service] Plan Controller Error:", error.response.data);
    }
  }
}
*/


// Create Website
router.post("/", async (req, res) => {
  const { name, link, description, chatbotCode, userId, preferences, shopifyAccessToken } = req.body;

  try {
    if (!userId) {
      return res.status(400).json({ message: "User ID is required to create a website." });
    }

    const creatingUser = await User.findById(userId);
    if (!creatingUser) {
      return res.status(404).json({ message: "Creating user not found." });
    }

    // Check if a website with this chatbotCode already exists
    let website = await Website.findOne({ chatbotCode });
    if (website) {
      // If a website with this chatbotCode already exists, it means it's an attempt to
      // create a duplicate or the code isn't unique enough.
      // For Shopify integration, we typically would either update an existing website
      // based on `link` (shop URL) and `owner`, or create a truly new one.
      // The current `router.post` handles only creation of new websites.
      // If your Next.js route is designed to *always* create, this might be ok,
      // but if it's meant to handle updates too, that logic needs to be in this Express route.
      // For now, adhering strictly to the `chatbotCode` unique constraint check provided.
      return res.status(400).json({ message: "Chatbot code already in use." });
    }

    const userWebsitesCount = await Website.countDocuments({ owner: userId });

    let initialPlanId;
    let freeTrialStartDate = null;
    let freeTrialPlanId = null;
    let nextBillingDate = null; // Initialize as null, set based on plan/trial

    const proPlan = await getProPlanId();
    initialPlanId = proPlan._id;

    if (userWebsitesCount === 0) {
      freeTrialStartDate = new Date();
      freeTrialPlanId = proPlan._id;
      nextBillingDate = new Date(freeTrialStartDate);
      nextBillingDate.setDate(nextBillingDate.getDate() + FREE_TRIAL_DURATION_DAYS);
      console.log(`[Main Service] Assigning Pro plan with ${FREE_TRIAL_DURATION_DAYS}-day free trial to first website for user ${userId}.`);

      // Send first subscription/free trial email
      await firstSubscriptionEmail(creatingUser.email, name, proPlan.name, nextBillingDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

    } else {
      // Not the first website, assign Pro plan without free trial (immediate billing)
      nextBillingDate = new Date();
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1); // Next billing in 1 month
      console.log(`[Main Service] Assigning Pro plan (no free trial) to website for user ${userId}.`);
    }

    website = new Website({
      name,
      link,
      description,
      chatbotCode,
      plan: initialPlanId,
      creditCount: 100,
      lastCreditBoostDate: new Date(),
      preferences: preferences || {
        colors: {
          gradient1: "#10b981",
          gradient2: "#059669",
        },
        header: "Chat Support",
        allowAIResponses: false,
      },
      owner: userId,
      freeTrial: freeTrialStartDate,
      freeTrialPlanId: freeTrialPlanId,
      freeTrialEnded: false,
      shopifyAccessToken: shopifyAccessToken || null, // Save the Shopify access token if provided
    });

    await website.save();

    addAllowedOrigin(website.link);
    creatingUser.websites.push(website._id);
    await creatingUser.save();

    // Inform Plan Controller Service about the new website's plan state
    await sendPlanStateToPlanController(
      website._id.toString(),
      website.plan.toString(),
      freeTrialStartDate,
      nextBillingDate // Pass the calculated nextBillingDate
    );

    res.status(201).json(website);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// Get all websites (no changes)
router.get("/", async (req, res) => {
  try {
    const websites = await Website.find().populate("plan").populate({ path: "owner", select: "-password" });
    res.json(websites);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Get single website (no changes)
router.get("/:id", async (req, res) => {
  try {
    const website = await Website.findById(req.params.id).populate("plan").populate({ path: "owner", select: "-password" });
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }
    res.json(website);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Update website (no changes related to plans)
router.put("/:id", authMiddleware, async (req, res) => {
  const { name, link, description, preferences, language, userId, predefinedAnswers } = req.body;
  const websiteId = req.params.id;


  try {
    const user = await User.findById(userId);
    console.warn(websiteId, userId, user.websites, user.websites.includes(websiteId))
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to update this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    const oldLink = website.link;

    website.name = name || website.name;
    website.link = link || website.link;
    website.predefinedAnswers = predefinedAnswers || website.predefinedAnswers;
    website.description = description || website.description;
    website.language = language || website.language;

    if (preferences) {
      website.preferences = { ...website.preferences, ...preferences };
    }

    await website.save();

    if (oldLink !== website.link) {
      replaceAllowedOrigin(oldLink, website.link);
    }

    const updatedWebsite = await Website.findById(websiteId).populate("plan").populate({ path: "owner", select: "-password" });
    res.json({ website: updatedWebsite });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Delete website (no changes related to plans)
router.delete("/:id", authMiddleware, async (req, res) => {
  const { userId } = req.body;
  const websiteId = req.params.id;

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to delete this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    const linkToRemove = website.link;

    await Chat.deleteMany({ website: websiteId });
    await Staff.deleteMany({ website: websiteId });

    user.websites = user.websites.filter((id) => id.toString() !== websiteId);
    await user.save();

    await website.deleteOne();

    removeAllowedOrigin(linkToRemove);

    res.json({ message: "Website deleted successfully." });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});


// Change Plan (called by client, initiates payment service)
router.put("/:id/change-plan", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { planId: newPlanId } = req.body;
  const websiteId = req.params.id;
  const authToken = req.headers['x-auth-token'];

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to change plan for this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    const newPlan = await Plan.findById(newPlanId);
    if (!newPlan) {
      return res.status(404).json({ message: "New plan not found." });
    }

    const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
    const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Payment service URL or API key not configured in main service .env");
      return res.status(500).json({ message: "Payment service configuration error." });
    }

    let paymentServiceResponseData;
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/subscriptions/change-plan`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': authToken,
            'x-main-service-api-key': PAYMENT_SERVICE_API_KEY
          },
          body: JSON.stringify({
            userId: userId,
            websiteId: websiteId,
            newPlanId: newPlanId,
            oldStripeSubscriptionId: website.stripeSubscriptionId,
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`Error response from payment service for plan change:`, errorBody);
        throw new Error(`Payment service returned non-OK status: ${response.status} - ${errorBody.message || JSON.stringify(errorBody)}`);
      }

      paymentServiceResponseData = await response.json();

    } catch (fetchError) {
      console.error("Error initiating plan change with payment service:", fetchError);
      return res.status(500).json({ message: "Failed to initiate plan change with payment service." });
    }

    // Main Service now waits for confirm-plan-change webhook for final update to Plan Controller
    // No direct call to sendPlanStateToPlanController here.

    res.status(200).json({
      message: "Plan change initiated. Please complete payment.",
      clientSecret: paymentServiceResponseData.clientSecret,
      newStripeSubscriptionId: paymentServiceResponseData.newSubscriptionId,
      paymentId: paymentServiceResponseData.paymentId,
    });

  } catch (err) {
    console.error("Error in change-plan route:", err.message);
    res.status(500).send("Server Error");
  }
});


// Confirms plan change (called by Payment Service Webhook)
router.put("/:id/confirm-plan-change", paymentServiceAuth, async (req, res) => {
  const websiteId = req.params.id;
  const { newPlanId, newStripeSubscriptionId, paymentId, nextBillingDate } = req.body; // NEW: nextBillingDate from Payment Service

  try {
    if (!newPlanId || !newStripeSubscriptionId || !paymentId || !nextBillingDate) {
      return res.status(400).json({ message: "Missing newPlanId, newStripeSubscriptionId, paymentId, or nextBillingDate." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    if (website.lastProcessedPaymentId === paymentId) {
      console.log(`Website ${websiteId}: Payment ID ${paymentId} already processed for plan change. Skipping update.`);
      return res.status(200).json({ message: "Plan already updated for this payment." });
    }

    const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
    const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Payment service URL or API key not configured in main service .env");
      return res.status(500).json({ message: "Payment service configuration error." });
    }

    let paymentStatusData;
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/payments/${paymentId}/status`,
        {
          method: 'GET',
          headers: {
            'x-main-service-api-key': PAYMENT_SERVICE_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`Error response from payment service for payment ${paymentId}:`, errorBody);
        throw new Error(`Payment service returned non-OK status: ${response.status} - ${errorBody.message || JSON.stringify(errorBody)}`);
      }
      paymentStatusData = await response.json();

    } catch (fetchError) {
      console.error(`Error verifying payment ${paymentId} with payment service:`, fetchError);
      return res.status(500).json({ message: "Failed to verify payment with payment service." });
    }

    if (paymentStatusData.status !== 'SUCCEEDED') {
      return res.status(400).json({ message: `Payment ${paymentId} is not in SUCCEEDED status. Current status: ${paymentStatusData.status}` });
    }

    // Update website plan and Stripe Subscription ID in the main service database
    website.plan = newPlanId;
    website.stripeSubscriptionId = newStripeSubscriptionId;
    website.lastProcessedPaymentId = paymentId;
    website.billedSuccessfuly = true;
    website.freeTrial = null; // Clear free trial on successful paid subscription
    website.freeTrialPlanId = null; // Clear associated trial plan
    website.freeTrialEnded = false; // Ensure this is false if now on a paid plan (actively billed)

    const newPlan = await Plan.findById(newPlanId);
    if (newPlan && newPlan.creditBoostMonthly > 0) {
      const now = new Date();

      website.creditCount += newPlan.creditBoostMonthly;
      website.lastCreditBoostDate = now;
    }

    await website.save();

    const user = await User.findById(website.owner);
    if (user) {
      await subscriptionSuccessEmail(user.email, website.name, newPlan.name, new Date(nextBillingDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    }

    // Inform Plan Controller Service about the updated plan state (successful payment)
    await sendPlanStateToPlanController(
      website._id.toString(),
      newPlanId,
      null, // No free trial active after successful payment
      new Date(nextBillingDate) // Use the nextBillingDate provided by Payment Service
    );

    res.status(200).json({ message: "Website plan updated successfully." });

  } catch (err) {
    console.error("Error confirming plan change for website:", err.message);
    res.status(500).send("Server Error");
  }
});


// Handles billing failure (called by Payment Service Webhook)
router.put("/:id/billing-failed", paymentServiceAuth, async (req, res) => {
  const websiteId = req.params.id;
  const { nextBillingDate } = req.body; // NEW: nextBillingDate (next retry date) from Payment Service

  try {
    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    website.billedSuccessfuly = false;
    await website.save();

    const user = await User.findById(website.owner);
    if (user) {
      await subscriptionFailedEmail(user.email, website.name, website._id.toString());
    }

    // Inform Plan Controller Service about the billing failure and next retry date
    // Plan Controller should handle setting next_billing_date to this retry date
    await sendPlanStateToPlanController(
      website._id.toString(),
      website.plan.toString(), // Current plan
      website.freeTrial, // Maintain current free trial status
      nextBillingDate ? new Date(nextBillingDate) : null // Pass next retry date or null
    );

    res.status(200).json({ message: "Website billing status updated to unsuccessful." });

  } catch (err) {
    console.error("Error handling billing failure for website:", err.message);
    res.status(500).send("Server Error");
  }
});

router.post("/:id/cancel-subscription", authMiddleware, async (req, res) => {
  // Get userId from the authenticated token
  const userId = req.user.id;
  const websiteId = req.params.id;
  const authToken = req.headers['x-auth-token']; // Pass user's auth token to payment service

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to cancel subscription for this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    if (!website.stripeSubscriptionId) {
      return res.status(400).json({ message: "No active Stripe subscription found for this website." });
    }

    // Call Payment Service to handle Stripe subscription cancellation
    const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
    const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Payment service URL or API key not configured in main service .env");
      return res.status(500).json({ message: "Payment service configuration error." });
    }

    let paymentServiceResponseData;
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/subscriptions/${website.stripeSubscriptionId}`, // Use the Stripe Subscription ID in the URL
        {
          method: 'DELETE', // Use DELETE method
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': authToken, // Pass user's auth token
            'x-main-service-api-key': PAYMENT_SERVICE_API_KEY // Authenticate main service to payment service
          },
          body: JSON.stringify({
            userId: userId, // Pass userId and websiteId in body for payment service to verify
            websiteId: websiteId
          })
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`Error response from payment service for subscription cancellation:`, errorBody);
        throw new Error(`Payment service returned non-OK status: ${response.status} - ${errorBody.message || JSON.stringify(errorBody)}`);
      }

      paymentServiceResponseData = await response.json();

    } catch (fetchError) {
      console.error("Error initiating subscription cancellation with payment service:", fetchError);
      return res.status(500).json({ message: "Failed to initiate subscription cancellation with payment service." });
    }

    // Respond to the client that cancellation was initiated
    res.status(200).json({
      message: "Subscription cancellation initiated.",
      status: paymentServiceResponseData.status // Status from payment service (e.g., 'canceled')
    });

  } catch (err) {
    console.error("Error in cancel-subscription route:", err.message);
    res.status(500).send("Server Error");
  }
});


// Handles subscription cancellation confirmation (called by Payment Service Webhook/API)
router.put("/:id/cancel-subscription-confirmed", paymentServiceAuth, async (req, res) => {
  const websiteId = req.params.id;
  const { nextBillingDate } = req.body; // NEW: nextBillingDate (null for cancellation) from Payment Service

  try {
    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    const freePlan = await getFreePlanId();

    website.plan = freePlan._id; // Set to Free Plan
    website.stripeSubscriptionId = null;
    website.lastProcessedPaymentId = null;
    website.billedSuccessfuly = false;
    website.freeTrial = null;
    website.freeTrialPlanId = null;
    website.freeTrialEnded = true;

    await website.save();

    // Inform Plan Controller to clear billing/trial info
    // Set next billing date to null as there will be no future billing for this subscription
    await sendPlanStateToPlanController(
      website._id.toString(),
      website.plan.toString(),
      null, // No free trial
      null // Next billing date is null for cancelled subscriptions
    );

    res.status(200).json({ message: "Website subscription cancelled and plan reverted to Free." });

  } catch (err) {
    console.error("Error confirming subscription cancellation for website:", err.message);
    res.status(500).send("Server Error");
  }
});


// NEW ENDPOINT: Free trial ended notification from Plan Controller Service
router.put("/:id/free-trial-ended", async (req, res) => {
  const websiteId = req.params.id;

  const planControllerApiKeyHeader = req.headers['x-plan-controller-api-key'];
  const expectedApiKey = process.env.PLAN_CONTROLLER_SERVICE_API_KEY;

  if (!planControllerApiKeyHeader || planControllerApiKeyHeader !== expectedApiKey) {
    console.warn(`[Main Service] Unauthorized access attempt to /free-trial-ended for website ${websiteId}.`);
    return res.status(401).json({ message: "Unauthorized access: Invalid API Key." });
  }

  try {
    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    if (website.freeTrial && website.freeTrialPlanId && !website.freeTrialEnded) {
      const freePlan = await Plan.findOne({ name: "Free" });
      if (!freePlan) {
        return res.status(500).json({ message: "Free plan not found." });
      }

      website.plan = freePlan._id;
      website.freeTrial = null;
      website.freeTrialPlanId = null;
      website.freeTrialEnded = true;
      website.stripeSubscriptionId = null;
      website.billedSuccessfuly = false;

      await website.save();
      console.log(`[Main Service] Website ${websiteId} free trial ended. Downgraded to Free plan.`);

      // No need to inform Plan Controller here, as it initiated this event.
      // The Plan Controller will handle clearing its internal free trial state after this notification.

      res.status(200).json({ message: "Website plan downgraded due to free trial ending." });
    } else {
      console.log(`[Main Service] Website ${websiteId} received free trial ended notification but was not on active trial or trial already ended. No primary action taken.`);
      res.status(200).json({ message: "Website not on active free trial or trial already ended; no primary action taken." });
    }

  } catch (err) {
    console.error("Error handling free trial ended notification:", err.message);
    res.status(500).send("Server Error");
  }
});

router.put("/:id/free-trial-ended", async (req, res) => {
  const websiteId = req.params.id;

  const planControllerApiKeyHeader = req.headers['x-plan-controller-api-key'];
  const expectedApiKey = process.env.PLAN_CONTROLLER_SERVICE_API_KEY;

  if (!planControllerApiKeyHeader || planControllerApiKeyHeader !== expectedApiKey) {
    console.warn(`[Main Service] Unauthorized access attempt to /free-trial-ended for website ${websiteId}.`);
    return res.status(401).json({ message: "Unauthorized access: Invalid API Key." });
  }

  try {
    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    if (website.freeTrial && website.freeTrialPlanId && !website.freeTrialEnded) {
      const freePlan = await Plan.findOne({ name: "Free" });
      if (!freePlan) {
        return res.status(500).json({ message: "Free plan not found." });
      }

      website.plan = freePlan._id;
      website.freeTrial = null;
      website.freeTrialPlanId = null;
      website.freeTrialEnded = true;
      website.stripeSubscriptionId = null;
      website.billedSuccessfuly = false;

      await website.save();
      console.log(`[Main Service] Website ${websiteId} free trial ended. Downgraded to Free plan.`);

      // No need to inform Plan Controller here, as it initiated this event.
      // The Plan Controller will handle clearing its internal free trial state after this notification.

      res.status(200).json({ message: "Website plan downgraded due to free trial ending." });
    } else {
      console.log(`[Main Service] Website ${websiteId} received free trial ended notification but was not on active trial or trial already ended. No primary action taken.`);
      res.status(200).json({ message: "Website not on active free trial or trial already ended; no primary action taken." });
    }

  } catch (err) {
    console.error("Error handling free trial ended notification:", err.message);
    res.status(500).send("Server Error");
  }
});


// NEW ENDPOINT: Accept payment warning notifications from Plan Controller
router.post("/:id/payment-warning", paymentServiceAuth, async (req, res) => {
  const websiteId = req.params.id;
  const { type, daysUntilEvent, nextBillingDate } = req.body; // type: 'billing' or 'free_trial_end'

  try {
    if (!type || !['billing', 'free_trial_end'].includes(type) || typeof daysUntilEvent === 'undefined') {
      return res.status(400).json({ message: "Invalid request: Missing type, invalid type, or missing daysUntilEvent." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    const user = await User.findById(website.owner);
    if (!user) {
      console.warn(`[Main Service] User not found for website ${websiteId}. Cannot send warning email.`);
      return res.status(404).json({ message: "User not found for this website." });
    }

    const formattedNextBillingDate = nextBillingDate ? new Date(nextBillingDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null;

    if (type === 'billing') {
      await billingWarningEmail(user.email, website.name, website._id.toString(), daysUntilEvent, formattedNextBillingDate);
      console.log(`[Main Service] Sent billing warning email for website ${websiteId}, due in ${daysUntilEvent} days.`);
    } else if (type === 'free_trial_end') {
      const currentPlan = await Plan.findById(website.plan);
      await freeTrialEndWarningEmail(user.email, website.name, website._id.toString(), currentPlan ? currentPlan.name : 'your current plan', daysUntilEvent);
      console.log(`[Main Service] Sent free trial end warning email for website ${websiteId}, ends in ${daysUntilEvent} days.`);
    }

    res.status(200).json({ message: `Payment warning notification processed for type: ${type}.` });

  } catch (err) {
    console.error(`[Main Service] Error processing payment warning for website ${websiteId}:`, err.message);
    res.status(500).send("Server Error");
  }
});


// Add credits (called by Payment Service)
router.put("/:id/add-credits", paymentServiceAuth, async (req, res) => {
  const websiteId = req.params.id;
  const { tokensToAdd, paymentId } = req.body;

  try {
    if (!tokensToAdd || tokensToAdd <= 0 || !paymentId) {
      return res.status(400).json({ message: "Invalid tokensToAdd or missing paymentId." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    if (website.lastProcessedPaymentId === paymentId) {
      console.log(`Website ${websiteId}: Payment ID ${paymentId} already processed. Skipping credit addition.`);
      return res.status(200).json({ message: "Credits already added for this payment." });
    }

    const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
    const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Payment service URL or API key not configured in main service .env");
      return res.status(500).json({ message: "Payment service configuration error." });
    }

    let paymentStatusData;
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/payments/${paymentId}/status`,
        {
          method: 'GET',
          headers: {
            'x-main-service-api-key': PAYMENT_SERVICE_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`Error response from payment service for payment ${paymentId}:`, errorBody);
        throw new Error(`Payment service returned non-OK status: ${response.status} - ${errorBody.message || JSON.stringify(errorBody)}`);
      }

      paymentStatusData = await response.json();

    } catch (fetchError) {
      console.error(`Error verifying payment ${paymentId} with payment service:`, fetchError);
      return res.status(500).json({ message: "Failed to verify payment with payment service." });
    }

    if (paymentStatusData.status !== 'SUCCEEDED') {
      return res.status(400).json({ message: `Payment ${paymentId} is not in SUCCEEDED status. Current status: ${paymentStatusData.status}` });
    }

    website.creditCount += tokensToAdd;
    website.lastProcessedPaymentId = paymentId;
    website.billedSuccessfuly = true;
    await website.save();

    const user = await User.findById(website.owner);
    if (user) {
      await tokenPurchaseSuccessEmail(user.email, tokensToAdd, website.name);
    }


    res.status(200).json({ message: "Credits added successfully.", newCreditCount: website.creditCount });

  } catch (err) {
    console.error("Error adding credits to website:", err.message);
    res.status(500).send("Server Error");
  }
});

export const websiteRoutes = router;