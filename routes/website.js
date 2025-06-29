import express from "express"
import Website from "../models/website.js"
import User from "../models/user.js"
import Plan from "../models/plan.js"
import Staff from "../models/staff.js"
import Chat from "../models/chat.js"
import authMiddleware from "../middleware/auth.js"

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
  const { planId, userId } = req.body
  const websiteId = req.params.id

  try {
    // Verify ownership
    const user = await User.findById(userId)
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to change plan for this website." })
    }

    const website = await Website.findById(websiteId)
    if (!website) {
      return res.status(404).json({ message: "Website not found." })
    }

    const newPlan = await Plan.findById(planId)
    if (!newPlan) {
      return res.status(404).json({ message: "Plan not found." })
    }

    // Update website plan
    website.plan = planId

    // If upgrading to a plan with more credits, boost credits immediately
    if (newPlan.creditBoostMonthly > 0) {
      website.creditCount += newPlan.creditBoostMonthly
      website.lastCreditBoostDate = new Date()
    }

    await website.save()

    res.json({
      message: "Plan changed successfully",
      website: await Website.findById(websiteId).populate("plan"),
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

export const websiteRoutes = router