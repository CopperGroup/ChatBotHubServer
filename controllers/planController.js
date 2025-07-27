import Plan from "../models/plan.js";
import User from "../models/user.js";

const checkUserOwnership = async (userId, websiteId = null) => {
  if (!userId)
    throw { code: 401, message: "Authentication required: User ID missing." };

  const user = await User.findById(userId);
  if (!user)
    throw { code: 401, message: "Authentication failed: User not found." };

  if (user.websites.length === 0) {
    throw { code: 403, message: "Forbidden: User does not own any websites." };
  }

  if (websiteId && !user.websites.includes(websiteId)) {
    throw {
      code: 403,
      message: "Forbidden: User does not own this specific website.",
    };
  }

  return user;
};

// CREATE
export const createPlan = async (req, res) => {
  const {
    userId,
    name,
    description,
    priceMonthly,
    creditBoostMonthly,
    allowAI,
    maxStaffMembers,
    allowPredefinedResponses,
    websiteId,
  } = req.body;

  try {
    await checkUserOwnership(userId, websiteId);

    const existingPlan = await Plan.findOne({ name });
    if (existingPlan) {
      return res
        .status(400)
        .json({ message: "Plan with this name already exists." });
    }

    const newPlan = new Plan({
      name,
      description,
      priceMonthly,
      creditBoostMonthly,
      allowAI,
      maxStaffMembers,
      allowPredefinedResponses,
    });

    await newPlan.save();
    res.status(201).json(newPlan);
  } catch (err) {
    console.error(err);
    res
      .status(err.code || 500)
      .json({ message: err.message || "Server error during plan creation." });
  }
};

// READ ALL
export const getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find({});
    const filteredPlans = plans.filter((p) => p.name !== "Free");
    res.json(filteredPlans);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

// READ ONE
export const getPlanById = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: "Plan not found." });
    }
    res.json(plan);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

export const getFreePlanId = async (req, res) => {
  try {
    const plan = await Plan.findOne({ name: "Free"});
    if (!plan) {
      return res.status(404).json({ message: "Plan not found." });
    }
    res.json(plan);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};


// UPDATE
export const updatePlan = async (req, res) => {
  const {
    userId,
    name,
    description,
    priceMonthly,
    creditBoostMonthly,
    allowAI,
    maxStaffMembers,
    allowPredefinedResponses,
    websiteId,
  } = req.body;

  try {
    await checkUserOwnership(userId, websiteId);

    const plan = await Plan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: "Plan not found." });
    }

    plan.name = name ?? plan.name;
    plan.description = description ?? plan.description;
    plan.priceMonthly = priceMonthly ?? plan.priceMonthly;
    plan.creditBoostMonthly = creditBoostMonthly ?? plan.creditBoostMonthly;
    plan.allowAI = allowAI ?? plan.allowAI;
    plan.maxStaffMembers = maxStaffMembers ?? plan.maxStaffMembers;
    plan.allowPredefinedResponses =
      allowPredefinedResponses ?? plan.allowPredefinedResponses;

    await plan.save();
    res.json(plan);
  } catch (err) {
    console.error(err);
    res
      .status(err.code || 500)
      .json({ message: err.message || "Server error during plan update." });
  }
};

// DELETE
export const deletePlan = async (req, res) => {
  const { userId, websiteId } = req.body;

  try {
    await checkUserOwnership(userId, websiteId);

    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: "Plan not found." });
    }

    res.json({ message: "Plan deleted successfully." });
  } catch (err) {
    console.error(err);
    res
      .status(err.code || 500)
      .json({ message: err.message || "Server error during plan deletion." });
  }
};
