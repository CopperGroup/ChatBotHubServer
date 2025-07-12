// routes/website.js
import express from "express"
import Website from "../models/website.js"
import User from "../models/user.js"
import Plan from "../models/plan.js"
import Staff from "../models/staff.js"
import Chat from "../models/chat.js"
import authMiddleware from "../middleware/auth.js"
import paymentServiceAuth from "../middleware/paymentServiceAuth.js" // Import the new middleware

import {
  addAllowedOrigin,
  removeAllowedOrigin,
  replaceAllowedOrigin,
} from "../services/allowedOrigins.js"

const router = express.Router()

// Helper function to get Free plan
async function getFreePlanId() {
  const freePlan = await Plan.findOne({ name: "Free" })
  if (!freePlan) {
    throw new Error("Free plan not found. Please ensure default plans are seeded.")
  }
  return freePlan._id
}

// Create Website
router.post("/", async (req, res) => {
  const { name, link, description, chatbotCode, userId, preferences } = req.body

  try {
    if (!userId) {
      return res.status(400).json({ message: "User ID is required to create a website." })
    }

    const creatingUser = await User.findById(userId)
    if (!creatingUser) {
      return res.status(404).json({ message: "Creating user not found." })
    }

    let website = await Website.findOne({ chatbotCode })
    if (website) {
      return res.status(400).json({ message: "Chatbot code already in use." })
    }

    const defaultPlanId = await getFreePlanId()

    website = new Website({
      name,
      link,
      description,
      chatbotCode,
      plan: defaultPlanId,
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
    })

    await website.save()

    // Add the new website's domain to the allowed origins
    addAllowedOrigin(website.link)

    creatingUser.websites.push(website._id)
    await creatingUser.save()

    res.status(201).json(website)
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Get all websites
router.get("/", async (req, res) => {
  try {
    const websites = await Website.find().populate("plan").populate({ path: "owner", select: "-password" })
    res.json(websites)
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Get single website
router.get("/:id", async (req, res) => {
  try {
    const website = await Website.findById(req.params.id).populate("plan").populate({ path: "owner", select: "-password" })
    if (!website) {
      return res.status(404).json({ message: "Website not found." })
    }
    res.json(website)
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Update website
router.put("/:id", authMiddleware, async (req, res) => {
  const { name, link, description, preferences, language, userId, predefinedAnswers} = req.body
  const websiteId = req.params.id

  try {
    // Verify ownership
    const user = await User.findById(userId)
    console.log(user)
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to update this website." })
    }

    const website = await Website.findById(websiteId)
    if (!website) {
      return res.status(404).json({ message: "Website not found." })
    }

    // Store the old link to check for changes
    const oldLink = website.link

    website.name = name || website.name
    website.link = link || website.link
    website.predefinedAnswers = predefinedAnswers || website.predefinedAnswers
    website.description = description || website.description
    website.language = language || website.language

    if (preferences) {
      website.preferences = { ...website.preferences, ...preferences }
    }

    await website.save()

    // If the link was changed, update the allowed origins set
    if (oldLink !== website.link) {
      replaceAllowedOrigin(oldLink, website.link)
    }

    const updatedWebsite = await Website.findById(websiteId).populate("plan").populate({ path: "owner", select: "-password" })
    res.json({ website: updatedWebsite })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Delete website
router.delete("/:id", authMiddleware, async (req, res) => {
  const { userId } = req.body
  const websiteId = req.params.id

  try {
    // Verify ownership
    const user = await User.findById(userId)
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to delete this website." })
    }

    const website = await Website.findById(websiteId)
    if (!website) {
      return res.status(404).json({ message: "Website not found." })
    }

    // Store the link before deleting the website
    const linkToRemove = website.link

    // Delete associated data
    await Chat.deleteMany({ website: websiteId })
    await Staff.deleteMany({ website: websiteId })

    // Remove from user's websites
    user.websites = user.websites.filter((id) => id.toString() !== websiteId)
    await user.save()

    await website.deleteOne()

    // Remove the website's domain from the allowed origins
    removeAllowedOrigin(linkToRemove)

    res.json({ message: "Website deleted successfully." })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

router.put("/:id/change-plan", authMiddleware, async (req, res) => {
  // Get userId from the authenticated token, not from body for security
  const userId = req.user.id;
  const { planId: newPlanId } = req.body; // planId is the new plan's _id
  const websiteId = req.params.id;
  const authToken = req.headers['x-auth-token']; // Get user's auth token from client

  try {
    // 1. Verify ownership and retrieve website's current subscription ID
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

    // Call Payment Service to handle Stripe subscription cancellation and new subscription creation
    const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL; // Ensure this is in main service .env
    const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY; // Ensure this is in main service .env

    if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
      console.error("Payment service URL or API key not configured in main service .env");
      return res.status(500).json({ message: "Payment service configuration error." });
    }

    let paymentServiceResponseData; // To store the parsed JSON response from payment service
    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_BASE_URL}/subscriptions/change-plan`, // New endpoint in Payment Service
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': authToken, // Pass user's auth token to payment service
            'x-main-service-api-key': PAYMENT_SERVICE_API_KEY // Authenticate main service to payment service
          },
          body: JSON.stringify({
            userId: userId,
            websiteId: websiteId,
            newPlanId: newPlanId,
            oldStripeSubscriptionId: website.stripeSubscriptionId,
          }),
        }
      );

      // Check if the HTTP response itself was successful (2xx status)
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        console.error(`Error response from payment service for plan change:`, errorBody);
        throw new Error(`Payment service returned non-OK status: ${response.status} - ${errorBody.message || JSON.stringify(errorBody)}`);
      }

      paymentServiceResponseData = await response.json(); // Parse the JSON response

    } catch (fetchError) {
      console.error("Error initiating plan change with payment service:", fetchError);
      return res.status(500).json({ message: "Failed to initiate plan change with payment service." });
    }

    // Payment service returns clientSecret for frontend payment confirmation
    res.status(200).json({
      message: "Plan change initiated. Please complete payment.",
      clientSecret: paymentServiceResponseData.clientSecret,
      newStripeSubscriptionId: paymentServiceResponseData.newSubscriptionId, // New subscription ID from payment service
      paymentId: paymentServiceResponseData.paymentId // Payment record ID from payment service
    });

  } catch (err) {
    console.error("Error in change-plan route:", err.message);
    res.status(500).send("Server Error");
  }
});

// --- NEW ROUTE: CONFIRM PLAN CHANGE (CALLED BY PAYMENT SERVICE WEBHOOK) ---
router.put("/:id/confirm-plan-change", paymentServiceAuth, async (req, res) => {
    const websiteId = req.params.id;
    const { newPlanId, newStripeSubscriptionId, paymentId } = req.body;

    try {
        if (!newPlanId || !newStripeSubscriptionId || !paymentId) {
            return res.status(400).json({ message: "Missing newPlanId, newStripeSubscriptionId, or paymentId." });
        }

        const website = await Website.findById(websiteId);
        if (!website) {
            return res.status(404).json({ message: "Website not found." });
        }

        // Idempotency check: Ensure this paymentId hasn't been processed before for this website
        // This is crucial to prevent re-processing if webhook retries.
        if (website.lastProcessedPaymentId === paymentId) {
            console.log(`Website ${websiteId}: Payment ID ${paymentId} already processed for plan change. Skipping update.`);
            return res.status(200).json({ message: "Plan already updated for this payment." });
        }

        // Verify payment status with the Payment Service
        // This is to ensure the payment service is indeed confirming a SUCCEEDED payment
        const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL;
        const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

        if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
            console.error("Payment service URL or API key not configured in main service .env");
            return res.status(500).json({ message: "Payment service configuration error." });
        }

        let paymentStatusData;
        try {
            const response = await fetch( // Using fetch as per user's preference
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
        website.stripeSubscriptionId = newStripeSubscriptionId; // Store the new Stripe Subscription ID
        website.lastProcessedPaymentId = paymentId; // Mark this payment as processed for idempotency

        // If upgrading to a plan with more credits, boost credits immediately
        const newPlan = await Plan.findById(newPlanId); // Re-fetch new plan to get creditBoostMonthly
        if (newPlan && newPlan.creditBoostMonthly > 0) {
            // Apply credit boost only if the new plan offers more than the current
            // or if it's the first boost for this period. Refine logic as needed for proration.
            website.creditCount += newPlan.creditBoostMonthly;
            website.lastCreditBoostDate = new Date(); // Reset boost date
        }

        await website.save();

        res.status(200).json({ message: "Website plan updated successfully." });

    } catch (err) {
        console.error("Error confirming plan change for website:", err.message);
        res.status(500).send("Server Error");
    }
});


// --- NEW ROUTE TO ADD CREDITS (CALLED BY PAYMENT SERVICE) ---
// This route is protected by paymentServiceAuth middleware
router.put("/:id/add-credits", paymentServiceAuth, async (req, res) => {
  const websiteId = req.params.id;
  const { tokensToAdd, paymentId } = req.body; // paymentId from payment service's Payment record

  try {
      if (!tokensToAdd || tokensToAdd <= 0 || !paymentId) {
          return res.status(400).json({ message: "Invalid tokensToAdd or missing paymentId." });
      }

      const website = await Website.findById(websiteId);
      if (!website) {
          return res.status(404).json({ message: "Website not found." });
      }

      // Idempotency check: Ensure this paymentId hasn't been processed before
      if (website.lastProcessedPaymentId === paymentId) {
          console.log(`Website ${websiteId}: Payment ID ${paymentId} already processed. Skipping credit addition.`);
          return res.status(200).json({ message: "Credits already added for this payment." });
      }

      // Verify payment status with the Payment Service
      // This requires the payment service to expose an endpoint like /payments/:paymentId/status
      const PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL; // Add this to your main service's .env
      const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY; // Same key as in paymentServiceAuth

      if (!PAYMENT_SERVICE_BASE_URL || !PAYMENT_SERVICE_API_KEY) {
          console.error("Payment service URL or API key not configured in main service .env");
          return res.status(500).json({ message: "Payment service configuration error." });
      }

      let paymentStatusData;
      try {
          const response = await fetch(
              `${PAYMENT_SERVICE_BASE_URL}/payments/${paymentId}/status`,
              {
                  method: 'GET', // Explicitly define method for fetch
                  headers: {
                      'x-main-service-api-key': PAYMENT_SERVICE_API_KEY,
                      'Content-Type': 'application/json' // Good practice for clarity
                  }
              }
          );

          // Check if the HTTP response itself was successful (2xx status)
          if (!response.ok) {
              const errorBody = await response.json().catch(() => ({ message: response.statusText }));
              console.error(`Error response from payment service for payment ${paymentId}:`, errorBody);
              throw new Error(`Payment service returned non-OK status: ${response.status} - ${errorBody.message || JSON.stringify(errorBody)}`);
          }

          paymentStatusData = await response.json(); // Parse the JSON response

      } catch (fetchError) {
          console.error(`Error verifying payment ${paymentId} with payment service:`, fetchError);
          return res.status(500).json({ message: "Failed to verify payment with payment service." });
      }

      if (paymentStatusData.status !== 'SUCCEEDED') {
          return res.status(400).json({ message: `Payment ${paymentId} is not in SUCCEEDED status. Current status: ${paymentStatusData.status}` });
      }

      // Add credits
      website.creditCount += tokensToAdd;
      website.lastProcessedPaymentId = paymentId; // Store the processed payment ID
      await website.save();

      res.status(200).json({ message: "Credits added successfully.", newCreditCount: website.creditCount });

  } catch (err) {
      console.error("Error adding credits to website:", err.message);
      res.status(500).send("Server Error");
  }
});

export const websiteRoutes = router;