import jwt from "jsonwebtoken";
import Staff from "../models/staff.js";
import Website from "../models/website.js";
import { PlanValidator } from "../services/plan-validator.js";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

export const loginStaff = async (req, res) => {
  const { email, password } = req.body;
  try {
    const staff = await Staff.findOne({ email }).populate("website");
    if (!staff) return res.status(400).json({ message: "Invalid Credentials" });

    const isMatch = await staff.comparePassword(password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid Credentials" });

    const payload = {
      staff: {
        id: staff.id.toString(),
        email: staff.email,
        name: staff.name,
        websiteId: staff.website._id.toString(),
        websiteName: staff.website.name,
      },
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" }, (err, token) => {
      if (err) throw err;
      res.json({ token, staff: payload.staff });
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const createStaff = async (req, res) => {
  const { email, password, name, userId } = req.body;
  const websiteId = req.params.websiteId;

  try {
    const website = await Website.findById(websiteId).populate("plan");
    if (!website) return res.status(404).json({ message: "Website not found" });

    const User = (await import("../models/user.js")).default;
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId))
      return res
        .status(403)
        .json({ message: "Not authorized to add staff to this website" });

    const staffValidation = await PlanValidator.validateStaffLimit(websiteId);
    if (!staffValidation.isValid) {
      return res.status(400).json({
        message: `Cannot add more staff members. Your ${staffValidation.planName} plan allows maximum of ${staffValidation.max} staff members. Currently: ${staffValidation.current}/${staffValidation.max}`,
        planLimitation: true,
        currentPlan: staffValidation.planName,
        currentStaff: staffValidation.current,
        maxStaff: staffValidation.max,
      });
    }

    const existingStaff = await Staff.findOne({ email });
    if (existingStaff)
      return res
        .status(400)
        .json({ message: "Staff member with this email already exists" });

    const staff = new Staff({ website: websiteId, email, password, name });
    await staff.save();
    await Website.findByIdAndUpdate(websiteId, {
      $push: { staffMembers: staff._id },
    });

    res.status(201).json({
      message: "Staff member created successfully",
      staff: { id: staff._id, email: staff.email, name: staff.name },
      planInfo: {
        current: staffValidation.current + 1,
        max: staffValidation.max,
        planName: staffValidation.planName,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getStaff = async (req, res) => {
  const { userId } = req.query;
  const websiteId = req.params.websiteId;

  try {
    const User = (await import("../models/user.js")).default;
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId))
      return res
        .status(403)
        .json({ message: "Not authorized to view staff for this website" });

    const staffMembers = await Staff.find({ website: websiteId }).select(
      "-password"
    );
    const staffValidation = await PlanValidator.validateStaffLimit(websiteId);

    res.json({
      staffMembers,
      planInfo: {
        current: staffValidation.current,
        max: staffValidation.max,
        planName: staffValidation.planName,
        canAddMore: staffValidation.isValid,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const deleteStaff = async (req, res) => {
  const { userId } = req.body;
  const staffId = req.params.staffId;

  try {
    const staff = await Staff.findById(staffId);
    if (!staff)
      return res.status(404).json({ message: "Staff member not found" });

    const websiteIdToDeleteFrom = staff.website.toString();

    const User = (await import("../models/user.js")).default;
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteIdToDeleteFrom))
      return res
        .status(403)
        .json({ message: "Not authorized to delete this staff member" });

    await staff.deleteOne();
    await Website.findByIdAndUpdate(websiteIdToDeleteFrom, {
      $pull: { staffMembers: staffId },
    });

    const staffValidation = await PlanValidator.validateStaffLimit(
      websiteIdToDeleteFrom
    );

    res.json({
      message: "Staff member deleted successfully",
      planInfo: {
        current: staffValidation.current,
        max: staffValidation.max,
        planName: staffValidation.planName,
        canAddMore: staffValidation.isValid,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getPlanInfo = async (req, res) => {
  const { userId } = req.query;
  const websiteId = req.params.websiteId;

  try {
    const User = (await import("../models/user.js")).default;
    const user = await User.findById(userId);
    if (!user || !user.websites.includes(websiteId))
      return res
        .status(403)
        .json({ message: "Not authorized to view plan info for this website" });

    const website = await Website.findById(websiteId).populate("plan");
    if (!website) return res.status(404).json({ message: "Website not found" });

    const staffValidation = await PlanValidator.validateStaffLimit(websiteId);
    const aiValidation = await PlanValidator.validateAIUsage(websiteId);

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
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};
