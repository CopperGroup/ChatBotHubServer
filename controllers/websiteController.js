import Website from "../models/website.js";
import User from "../models/user.js";
import Plan from "../models/plan.js";
import { addAllowedOrigin } from "../services/allowedOrigins.js";
import Staff from "../models/staff.js";
import Chat from "../models/chat.js";
import {
  removeAllowedOrigin,
  replaceAllowedOrigin,
} from "../services/allowedOrigins.js";

import axios from "axios";

import {
  userSubscriptionCancellationEmail,
  billingWarningEmail,
  freeTrialEndWarningEmail,
  tokenPurchaseSuccessEmail,
  subscriptionSuccessEmail,
  subscriptionFailedEmail,
  firstSubscriptionEmail,
  adminSubscriptionCancellationEmail,
} from "../services/email.js"; // Якщо ці методи тут
import { getFreePlanId } from "./planController.js";
// import { sendPlanStateToPlanController } from "../services/plan-state.js"; // This import is duplicated below, keeping the one from the shared variables fetcher context

// --- Configuration and Defaults ---
let PLAN_CONTROLLER_SERVICE_URL = "http://localhost:3002";
let FREE_TRIAL_DURATION_DAYS = 3;
let PRICE_FOR_SCRAPING = 10;
// Shared variables fetcher
async function fetchSharedVariables() {
  const url =
    process.env.SHARED_VARIABLES_SERVICE_URL || "http://localhost:3001";
  const apiKey = process.env.SHARED_VARIABLES_SERVICE_API_KEY;

  if (!url || !apiKey) return;

  try {
    const [planUrlRes, trialRes] = await Promise.all([
      axios.get(`${url}/variables/PLAN_CONTROLLER_SERVICE_URL`, {
        headers: { "x-api-key": apiKey },
      }),
      axios.get(`${url}/variables/FREE_TRIAL_DURATION_DAYS`, {
        headers: { "x-api-key": apiKey },
      }),
    ]);

    if (planUrlRes?.data?.status === "success" && planUrlRes.data.value) {
      PLAN_CONTROLLER_SERVICE_URL = planUrlRes.data.value;
    }

    if (trialRes?.data?.status === "success" && trialRes.data.value) {
      FREE_TRIAL_DURATION_DAYS = parseInt(trialRes.data.value, 10);
    }
  } catch (error) {
    console.warn("Failed to fetch shared variables. Using defaults.");
  }
}
fetchSharedVariables();

// Helper functions
async function getProPlanId() {
  const proPlan = await Plan.findOne({ name: "Pro" });
  if (!proPlan) throw new Error("Pro plan not found.");
  return proPlan._id;
}

async function sendPlanStateToPlanController(
  websiteId,
  planId,
  freeTrialStartDate,
  nextBillingDate
) {
  const apiKey = process.env.PLAN_CONTROLLER_SERVICE_API_KEY;
  if (!PLAN_CONTROLLER_SERVICE_URL || !apiKey) return;

  try {
    await axios.post(
      `${PLAN_CONTROLLER_SERVICE_URL}/plan-states`,
      {
        websiteId,
        planId,
        freeTrialStartDate: freeTrialStartDate
          ? freeTrialStartDate.toISOString()
          : null,
        nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : null,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
      }
    );
  } catch (err) {
    console.error(
      `Plan Controller update failed for website ${websiteId}:`,
      err.message
    );
  }
}

// ========== CONTROLLER ==========

export const createWebsite = async (req, res) => {
  const {
    name,
    link,
    description,
    chatbotCode,
    userId,
    preferences,
    shopifyAccessToken,
  } = req.body;

  try {
    if (!userId)
      return res.status(400).json({ message: "User ID is required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    let website = await Website.findOne({ chatbotCode });
    if (website) {
      return res.status(400).json({ message: "Chatbot code already in use" });
    }

    const userWebsitesCount = await Website.countDocuments({ owner: userId });
    const proPlanId = await getProPlanId();

    let freeTrialStartDate = null;
    let freeTrialPlanId = null;
    let nextBillingDate = null;

    if (userWebsitesCount === 0) {
      freeTrialStartDate = new Date();
      freeTrialPlanId = proPlanId;
      nextBillingDate = new Date(freeTrialStartDate);
      nextBillingDate.setDate(
        nextBillingDate.getDate() + FREE_TRIAL_DURATION_DAYS
      );

      await firstSubscriptionEmail(
        user.email,
        name,
        "Pro",
        nextBillingDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      );
    } else {
      nextBillingDate = new Date();
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }

    website = new Website({
      name,
      link,
      description,
      chatbotCode,
      plan: proPlanId,
      creditCount: 100,
      lastCreditBoostDate: new Date(),
      preferences: preferences || {
        colors: { gradient1: "#10b981", gradient2: "#059669" },
        header: "Chat Support",
        allowAIResponses: false,
      },
      owner: userId,
      freeTrial: freeTrialStartDate,
      freeTrialPlanId,
      freeTrialEnded: false,
      shopifyAccessToken: shopifyAccessToken || null,
    });

    await website.save();
    await addAllowedOrigin(website.link);

    user.websites.push(website._id);
    await user.save();

    await sendPlanStateToPlanController(
      website._id.toString(),
      proPlanId.toString(),
      freeTrialStartDate,
      nextBillingDate
    );

    res.status(201).json(website);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getAllWebsites = async (req, res) => {
  try {
    const websites = await Website.find()
      .populate("plan")
      .populate({ path: "owner", select: "-password" });
    res.json(websites);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getWebsiteById = async (req, res) => {
  try {
    const website = await Website.findById(req.params.id)
      .populate("plan")
      .populate({ path: "owner", select: "-password" });
    if (!website)
      return res.status(404).json({ message: "Website not found." });
    res.json(website);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getWebsiteByLink = async (req, res) => {
  const { link } = req.query;
  try {
    if (!link)
      return res.status(400).json({ message: "Website link is required." });

    const website = await Website.findOne({ link: String(link) })
      .populate("plan")
      .populate({ path: "owner", select: "-password" });

    if (!website) {
      return res
        .status(404)
        .json({ message: "Website not found with the provided link." });
    }

    res.json(website);
  } catch (err) {
    console.error("Error finding website by link:", err.message);
    res.status(500).send("Server Error");
  }
};

export const updateWebsite = async (req, res) => {
  const {
    name,
    link,
    description,
    preferences,
    language,
    userId,
    predefinedAnswers,
    aiSummary,
  } = req.body;
  const websiteId = req.params.id;

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res
        .status(403)
        .json({ message: "Not authorized to update this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    const oldLink = website.link;

    website.name = name || website.name;
    website.link = link || website.link;
    website.description = description || website.description;
    website.language = language || website.language;
    website.predefinedAnswers = predefinedAnswers || website.predefinedAnswers;
    website.aiSummary = aiSummary || website.aiSummary

    if (preferences) {
      website.preferences = { ...website.preferences, ...preferences };
    }

    await website.save();

    if (oldLink !== website.link) {
      replaceAllowedOrigin(oldLink, website.link);
    }

    const updatedWebsite = await Website.findById(websiteId)
      .populate("plan")
      .populate({ path: "owner", select: "-password" });

    res.json({ website: updatedWebsite });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const deleteWebsite = async (req, res) => {
  const { userId } = req.body;
  const websiteId = req.params.id;

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

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
};

export const changeWebsitePlan = async (req, res) => {
  const userId = req.user.id;
  const { planId: newPlanId } = req.body;
  const websiteId = req.params.id;
  const authToken = req.headers["x-auth-token"];

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res
        .status(403)
        .json({ message: "Not authorized to change plan for this website." });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    const newPlan = await Plan.findById(newPlanId);
    if (!newPlan)
      return res.status(404).json({ message: "New plan not found." });

    const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
    const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      return res
        .status(500)
        .json({ message: "Payment service configuration error." });
    }

    const response = await fetch(
      `${PAYMENT_SERVICE_BASE_URL}/subscriptions/change-plan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-token": authToken,
          "x-main-service-api-key": PAYMENT_SERVICE_API_KEY,
        },
        body: JSON.stringify({
          userId,
          websiteId,
          newPlanId,
          oldStripeSubscriptionId: website.stripeSubscriptionId,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(`Payment service error: ${errorBody.message}`);
    }

    const paymentServiceResponseData = await response.json();

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
};

export const confirmPlanChange = async (req, res) => {
  const websiteId = req.params.id;
  const { newPlanId, newStripeSubscriptionId, paymentId, nextBillingDate } =
    req.body;

  try {
    if (
      !newPlanId ||
      !newStripeSubscriptionId ||
      !paymentId ||
      !nextBillingDate
    ) {
      return res.status(400).json({
        message:
          "Missing newPlanId, newStripeSubscriptionId, paymentId, or nextBillingDate.",
      });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    if (website.lastProcessedPaymentId === paymentId) {
      console.log(
        `Website ${websiteId}: Payment ID ${paymentId} already processed. Skipping.`
      );
      return res
        .status(200)
        .json({ message: "Plan already updated for this payment." });
    }

    const { PAYMENT_SERVICE_BASE_URL, PAYMENT_SERVICE_API_KEY } = process.env;
    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error(
        "Missing PAYMENT_SERVICE_BASE_URL or PAYMENT_SERVICE_API_KEY in .env"
      );
      return res
        .status(500)
        .json({ message: "Payment service configuration error." });
    }

    let paymentStatusData;
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/payments/${paymentId}/status`,
        {
          method: "GET",
          headers: {
            "x-main-service-api-key": PAYMENT_SERVICE_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response
          .json()
          .catch(() => ({ message: response.statusText }));
        console.error(`Error from payment service:`, errorBody);
        throw new Error(
          `Payment service returned ${response.status} - ${errorBody.message}`
        );
      }

      paymentStatusData = await response.json();
    } catch (error) {
      console.error(`Failed to verify payment ${paymentId}:`, error);
      return res.status(500).json({ message: "Failed to verify payment." });
    }

    if (paymentStatusData.status !== "SUCCEEDED") {
      return res.status(400).json({
        message: `Payment not succeeded. Status: ${paymentStatusData.status}`,
      });
    }

    website.plan = newPlanId;
    website.stripeSubscriptionId = newStripeSubscriptionId;
    website.lastProcessedPaymentId = paymentId;
    website.billedSuccessfuly = true;
    website.freeTrial = null;
    website.freeTrialPlanId = null;
    website.freeTrialEnded = false;

    const newPlan = await Plan.findById(newPlanId);
    if (newPlan?.creditBoostMonthly > 0) {
      website.creditCount += newPlan.creditBoostMonthly;
      website.lastCreditBoostDate = new Date();
    }

    await website.save();

    const user = await User.findById(website.owner);
    if (user) {
      await subscriptionSuccessEmail(
        user.email,
        website.name,
        newPlan.name,
        new Date(nextBillingDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      );
    }

    await sendPlanStateToPlanController(
      website._id.toString(),
      newPlanId,
      null,
      new Date(nextBillingDate)
    );

    res.status(200).json({ message: "Website plan updated successfully." });
  } catch (err) {
    console.error("Error confirming plan change:", err.message);
    res.status(500).send("Server Error");
  }
};

export const handleBillingFailure = async (req, res) => {
  const websiteId = req.params.id;
  const { nextBillingDate } = req.body;

  try {
    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    website.billedSuccessfuly = false;
    await website.save();

    const user = await User.findById(website.owner);
    if (user) {
      await subscriptionFailedEmail(
        user.email,
        website.name,
        website._id.toString()
      );
    }

    await sendPlanStateToPlanController(
      website._id.toString(),
      website.plan.toString(),
      website.freeTrial,
      nextBillingDate ? new Date(nextBillingDate) : null
    );

    res
      .status(200)
      .json({ message: "Website billing status updated to unsuccessful." });
  } catch (err) {
    console.error("Error handling billing failure:", err.message);
    res.status(500).send("Server Error");
  }
};

export const cancelSubscription = async (req, res) => {
  const userId = req.user.id;
  const websiteId = req.params.id;
  const authToken = req.headers["x-auth-token"];
  const { reason, feedback } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId)) {
      return res
        .status(403)
        .json({ message: "Not authorized to cancel this subscription." });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });
    if (!website.stripeSubscriptionId) {
      return res
        .status(400)
        .json({ message: "No active Stripe subscription." });
    }

    const { PAYMENT_SERVICE_BASE_URL, PAYMENT_SERVICE_API_KEY } = process.env;
    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Missing payment service config");
      return res.status(500).json({ message: "Payment service config error." });
    }

    await adminSubscriptionCancellationEmail(
      website.name,
      user.email,
      reason,
      feedback
    );

    let responseData;
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/subscriptions/${website.stripeSubscriptionId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-auth-token": authToken,
            "x-main-service-api-key": PAYMENT_SERVICE_API_KEY,
          },
          body: JSON.stringify({ userId, websiteId }),
        }
      );

      if (!response.ok) {
        const errorBody = await response
          .json()
          .catch(() => ({ message: response.statusText }));
        console.error("Cancel error:", errorBody);
        throw new Error(
          `Payment service error: ${response.status} - ${errorBody.message}`
        );
      }

      responseData = await response.json();
    } catch (error) {
      console.error("Error calling payment service:", error);
      return res.status(500).json({
        message: "Failed to cancel subscription with payment service.",
      });
    }

    res.status(200).json({
      message: "Subscription cancellation initiated.",
      status: responseData.status,
    });
  } catch (err) {
    console.error("Error in cancelSubscription:", err.message);
    res.status(500).send("Server Error");
  }
};

// Confirm Subscription Cancellation
export const confirmSubscriptionCancellation = async (req, res) => {
  const websiteId = req.params.id;
  const { nextBillingDate } = req.body;

  try {
    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    const freePlan = await getFreePlanId();
    website.plan = freePlan._id;
    website.stripeSubscriptionId = null;
    website.lastProcessedPaymentId = null;
    website.billedSuccessfuly = false;
    website.freeTrial = null;
    website.freeTrialPlanId = null;
    website.freeTrialEnded = true;
    await website.save();

    const user = await User.findOne({ websites: websiteId });
    if (user) {
      await userSubscriptionCancellationEmail(user.email, website.name);
    } else {
      console.warn(
        `User not found for website ID: ${websiteId}. Cannot send user cancellation email.`
      );
    }

    await sendPlanStateToPlanController(
      website._id.toString(),
      website.plan.toString(),
      null,
      null
    );

    res.status(200).json({
      message: "Website subscription cancelled and plan reverted to Free.",
    });
  } catch (err) {
    console.error("Error confirming subscription cancellation:", err.message);
    res.status(500).send("Server Error");
  }
};

// Free Trial Ended
export const freeTrialEnded = async (req, res) => {
  const websiteId = req.params.id;
  const apiKey = req.headers["x-plan-controller-api-key"];
  if (!apiKey || apiKey !== process.env.PLAN_CONTROLLER_SERVICE_API_KEY) {
    console.warn(
      `[Main Service] Unauthorized access to /free-trial-ended for website ${websiteId}.`
    );
    return res
      .status(401)
      .json({ message: "Unauthorized access: Invalid API Key." });
  }

  try {
    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    if (
      website.freeTrial &&
      website.freeTrialPlanId &&
      !website.freeTrialEnded
    ) {
      const freePlan = await Plan.findOne({ name: "Free" });
      if (!freePlan)
        return res.status(500).json({ message: "Free plan not found." });

      website.plan = freePlan._id;
      website.freeTrial = null;
      website.freeTrialPlanId = null;
      website.freeTrialEnded = true;
      website.stripeSubscriptionId = null;
      website.billedSuccessfuly = false;

      await website.save();

      console.log(
        `[Main Service] Website ${websiteId} free trial ended. Downgraded to Free plan.`
      );
      return res
        .status(200)
        .json({ message: "Website plan downgraded due to free trial ending." });
    }

    res.status(200).json({
      message:
        "Website not on active free trial or trial already ended; no primary action taken.",
    });
  } catch (err) {
    console.error("Error handling free trial ended notification:", err.message);
    res.status(500).send("Server Error");
  }
};

// Payment Warning
export const paymentWarning = async (req, res) => {
  const websiteId = req.params.id;
  const { type, daysUntilEvent, nextBillingDate } = req.body;

  try {
    if (
      !type ||
      !["billing", "free_trial_end"].includes(type) ||
      typeof daysUntilEvent === "undefined"
    ) {
      return res.status(400).json({ message: "Invalid request parameters." });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    const user = await User.findById(website.owner);
    if (!user)
      return res
        .status(404)
        .json({ message: "User not found for this website." });

    const formattedNextBillingDate = nextBillingDate
      ? new Date(nextBillingDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

    if (type === "billing") {
      await billingWarningEmail(
        user.email,
        website.name,
        website._id.toString(),
        daysUntilEvent,
        formattedNextBillingDate
      );
    } else {
      const currentPlan = await Plan.findById(website.plan);
      await freeTrialEndWarningEmail(
        user.email,
        website.name,
        website._id.toString(),
        currentPlan?.name || "your plan",
        daysUntilEvent
      );
    }

    res.status(200).json({
      message: `Payment warning notification processed for type: ${type}.`,
    });
  } catch (err) {
    console.error(
      `Error processing payment warning for website ${websiteId}:`,
      err.message
    );
    res.status(500).send("Server Error");
  }
};

// Add Credits
export const addCredits = async (req, res) => {
  const websiteId = req.params.id;
  const { tokensToAdd, paymentId } = req.body;

  try {
    if (!tokensToAdd || tokensToAdd <= 0 || !paymentId) {
      return res
        .status(400)
        .json({ message: "Invalid tokensToAdd or missing paymentId." });
    }

    const website = await Website.findById(websiteId);
    if (!website)
      return res.status(404).json({ message: "Website not found." });

    if (website.lastProcessedPaymentId === paymentId) {
      return res
        .status(200)
        .json({ message: "Credits already added for this payment." });
    }

    const { PAYMENT_SERVICE_BASE_URL, PAYMENT_SERVICE_API_KEY } = process.env;
    const response = await fetch(
      `${PAYMENT_SERVICE_BASE_URL}/payments/${paymentId}/status`,
      {
        method: "GET",
        headers: {
          "x-main-service-api-key": PAYMENT_SERVICE_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        `Payment service error: ${body.message || response.statusText}`
      );
    }

    const paymentStatusData = await response.json();
    if (paymentStatusData.status !== "SUCCEEDED") {
      return res.status(400).json({
        message: `Payment not successful: ${paymentStatusData.status}`,
      });
    }

    website.creditCount += tokensToAdd;
    website.lastProcessedPaymentId = paymentId;
    website.billedSuccessfuly = true;
    await website.save();

    const user = await User.findById(website.owner);
    if (user) {
      await tokenPurchaseSuccessEmail(user.email, tokensToAdd, website.name);
    }

    res.status(200).json({
      message: "Credits added successfully.",
      newCreditCount: website.creditCount,
    });
  } catch (err) {
    console.error("Error adding credits:", err.message);
    res.status(500).send("Server Error");
  }
};

// NEW: Controller function to get AI summary for a website
export const getAiSummary = async (req, res) => {
  const websiteId = req.params.websiteId; // Using websiteId from URL parameter

  try {
    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    // Return the aiSummary field
    res.status(200).json({ websiteId: website._id, aiSummary: website.aiSummary });
  } catch (err) {
    console.error(`Error fetching AI summary for website ${websiteId}:`, err.message);
    res.status(500).send("Server Error");
  }
};

// NEW: Controller function to update AI summary for a website
export const updateAiSummary = async (req, res) => {
  const websiteId = req.params.websiteId; // Using websiteId from URL parameter
  const { newSummary } = req.body; // Expecting the new summary in the request body

  try {
    if (typeof newSummary !== 'string') {
      return res.status(400).json({ message: "newSummary field is required and must be a string." });
    }

    const website = await Website.findById(websiteId);
    if (!website) {
      return res.status(404).json({ message: "Website not found." });
    }

    // Update the aiSummary field
    website.aiSummary = newSummary;
    website.creditCount = website.creditCount - PRICE_FOR_SCRAPING
    await website.save();

    res.status(200).json({ message: "AI summary updated successfully.", websiteId: website._id, newAiSummary: website.aiSummary });
  } catch (err) {
    console.error(`Error updating AI summary for website ${websiteId}:`, err.message);
    res.status(500).send("Server Error");
  }
};