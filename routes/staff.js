import express from "express"
import jwt from "jsonwebtoken"
import Staff from "../models/staff.js"
import Website from "../models/website.js"
import { PlanValidator } from "../services/plan-validator.js"
import authMiddleware from "../middleware/auth.js"

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret"

// Staff Login (no changes needed here as it's a read operation)
router.post("/login", async (req, res) => {
  const { email, password } = req.body
  try {
    const staff = await Staff.findOne({ email }).populate("website")
    if (!staff) {
      return res.status(400).json({ message: "Invalid Credentials" })
    }

    const isMatch = await staff.comparePassword(password)
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Credentials" })
    }

    const payload = {
      staff: {
        id: staff.id.toString(),
        email: staff.email,
        name: staff.name,
        websiteId: staff.website._id.toString(),
        websiteName: staff.website.name,
      },
    }

    jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" }, (err, token) => {
      if (err) throw err
      res.json({ token, staff: payload.staff })
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Create Staff Member (with plan validation)
router.post("/:websiteId", authMiddleware, async (req, res) => {
  const { email, password, name, userId } = req.body
  const websiteId = req.params.websiteId

  try {
    // Verify website ownership
    const website = await Website.findById(websiteId).populate("plan")
    if (!website) {
      return res.status(404).json({ message: "Website not found" })
    }

    // Check if user owns this website
    const User = (await import("../models/user.js")).default
    const user = await User.findById(userId)
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to add staff to this website" })
    }

    // Validate staff limit using PlanValidator
    const staffValidation = await PlanValidator.validateStaffLimit(websiteId)
    if (!staffValidation.isValid) {
      return res.status(400).json({
        message: `Cannot add more staff members. Your ${staffValidation.planName} plan allows maximum of ${staffValidation.max} staff members. Currently: ${staffValidation.current}/${staffValidation.max}`,
        planLimitation: true,
        currentPlan: staffValidation.planName,
        currentStaff: staffValidation.current,
        maxStaff: staffValidation.max,
      })
    }

    // Check if email already exists
    const existingStaff = await Staff.findOne({ email })
    if (existingStaff) {
      return res.status(400).json({ message: "Staff member with this email already exists" })
    }

    const staff = new Staff({
      website: websiteId,
      email,
      password,
      name,
    })

    await staff.save()

    // --- NEW: Update the associated Website to include the new staff member
    await Website.findByIdAndUpdate(websiteId, { $push: { staffMembers: staff._id } })
    // --- END NEW

    res.status(201).json({
      message: "Staff member created successfully",
      staff: { id: staff._id, email: staff.email, name: staff.name },
      planInfo: {
        current: staffValidation.current + 1,
        max: staffValidation.max,
        planName: staffValidation.planName,
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Get Staff Members for a website (no changes needed here as it's a read operation)
router.get("/:websiteId", authMiddleware, async (req, res) => {
  const { userId } = req.query
  const websiteId = req.params.websiteId

  try {
    // Verify website ownership
    const User = (await import("../models/user.js")).default
    const user = await User.findById(userId)
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to view staff for this website" })
    }

    const staffMembers = await Staff.find({ website: websiteId }).select("-password")
    const staffValidation = await PlanValidator.validateStaffLimit(websiteId)

    res.json({
      staffMembers,
      planInfo: {
        current: staffValidation.current,
        max: staffValidation.max,
        planName: staffValidation.planName,
        canAddMore: staffValidation.isValid,
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Delete Staff Member
router.delete("/:staffId", authMiddleware, async (req, res) => {
  const { userId } = req.body
  const staffId = req.params.staffId

  try {
    const staff = await Staff.findById(staffId)
    if (!staff) {
      return res.status(404).json({ message: "Staff member not found" })
    }

    // Store website ID before deletion for later update
    const websiteIdToDeleteFrom = staff.website.toString()

    // Verify website ownership
    const User = (await import("../models/user.js")).default
    const user = await User.findById(userId)
    if (!user || !user.websites.includes(websiteIdToDeleteFrom)) {
      return res.status(403).json({ message: "Not authorized to delete this staff member" })
    }

    await staff.deleteOne()

    // --- NEW: Remove the staff member from the associated Website's staffMembers array
    await Website.findByIdAndUpdate(websiteIdToDeleteFrom, { $pull: { staffMembers: staffId } })
    // --- END NEW

    // Get updated plan info
    const staffValidation = await PlanValidator.validateStaffLimit(websiteIdToDeleteFrom)

    res.json({
      message: "Staff member deleted successfully",
      planInfo: {
        current: staffValidation.current,
        max: staffValidation.max,
        planName: staffValidation.planName,
        canAddMore: staffValidation.isValid,
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

// Get plan information for a website (no changes needed here as it's a read operation)
router.get("/:websiteId/plan-info", async (req, res) => {
  const { userId } = req.query
  const websiteId = req.params.websiteId

  try {
    // Verify website ownership
    const User = (await import("../models/user.js")).default
    const user = await User.findById(userId)
    if (!user || !user.websites.includes(websiteId)) {
      return res.status(403).json({ message: "Not authorized to view plan info for this website" })
    }

    const website = await Website.findById(websiteId).populate("plan")
    if (!website) {
      return res.status(404).json({ message: "Website not found" })
    }

    const staffValidation = await PlanValidator.validateStaffLimit(websiteId)
    const aiValidation = await PlanValidator.validateAIUsage(websiteId)

    res.json({
      plan: {
        name: website.plan.name,
        description: website.plan.description,
        priceMonthly: website.plan.priceMonthly,
        maxStaffMembers: website.plan.maxStaffMembers,
        allowAI: website.plan.allowAI,
        creditBoostMonthly: website.plan.creditBoostMonthly,
      },
      usage: {
        staff: {
          current: staffValidation.current,
          max: staffValidation.max,
          canAddMore: staffValidation.isValid,
        },
        ai: {
          enabled: aiValidation.planAllowsAI,
          credits: aiValidation.creditCount,
          canUse: aiValidation.isValid,
        },
      },
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
})

export default router