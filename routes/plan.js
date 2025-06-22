// routes/plan.js
import express from 'express';
import Plan from '../models/plan.js';
import User from '../models/user.js'; // Needed to check user ownership of websites
import Website from '../models/website.js'; // Needed to find website by ID if needed

const router = express.Router();

// NEW Authorization Middleware: Only a user who owns a website can manage plans.
// This middleware expects `userId` and `websiteId` (optional, for specific website actions)
// in the request body.
const authenticateUserOwner = async (req, res, next) => {
    const { userId, websiteId } = req.body; // Assuming userId and optional websiteId are in the body

    if (!userId) {
        return res.status(401).json({ message: 'Authentication required: User ID missing.' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({ message: 'Authentication failed: User not found.' });
        }

        // For plan management, we only need to check if the user owns *any* website.
        // If websiteId is provided, we can perform a more specific check,
        // but for plan routes, just owning *any* website is sufficient for this logic.
        if (user.websites.length === 0) {
            return res.status(403).json({ message: 'Forbidden: User does not own any websites.' });
        }

        // If a specific websiteId is provided, check if the user owns that specific website
        if (websiteId && !user.websites.includes(websiteId)) {
             return res.status(403).json({ message: 'Forbidden: User does not own this specific website.' });
        }

        req.user = user; // Attach the user object to the request for later use
        next();
    } catch (err) {
        console.error('Authorization error in plan routes:', err);
        res.status(500).json({ message: 'Server error during authorization.' });
    }
};


// @route   POST /api/plans
// @desc    Create a new plan (Only by a user who owns at least one website)
// @access  Private (Website Owner)
router.post('/', authenticateUserOwner, async (req, res) => {
    const { name, description, priceMonthly, creditBoostMonthly, allowAI, maxStaffMembers, allowPredefinedResponses } = req.body;
    try {
        const existingPlan = await Plan.findOne({ name });
        if (existingPlan) {
            return res.status(400).json({ message: 'Plan with this name already exists.' });
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
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/plans
// @desc    Get all plans
// @access  Public
router.get('/', async (req, res) => {
    try {
        const plans = await Plan.find({});
        let filteredPlans = plans.filter(p => p.name !== "Free")
        res.json(filteredPlans);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/plans/:id
// @desc    Get a single plan by ID
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found.' });
        }
        res.json(plan);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT /api/plans/:id
// @desc    Update a plan (Only by a user who owns at least one website)
// @access  Private (Website Owner)
router.put('/:id', authenticateUserOwner, async (req, res) => {
    const { name, description, priceMonthly, creditBoostMonthly, allowAI, maxStaffMembers, allowPredefinedResponses } = req.body;
    try {
        const plan = await Plan.findById(req.params.id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found.' });
        }

        plan.name = name || plan.name;
        plan.description = description || plan.description;
        plan.priceMonthly = priceMonthly !== undefined ? priceMonthly : plan.priceMonthly;
        plan.creditBoostMonthly = creditBoostMonthly !== undefined ? creditBoostMonthly : plan.creditBoostMonthly;
        plan.allowAI = allowAI !== undefined ? allowAI : plan.allowAI;
        plan.maxStaffMembers = maxStaffMembers !== undefined ? maxStaffMembers : plan.maxStaffMembers;
        plan.allowPredefinedResponses = allowPredefinedResponses !== undefined ? allowPredefinedResponses : plan.allowPredefinedResponses;

        await plan.save();
        res.json(plan);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE /api/plans/:id
// @desc    Delete a plan (Only by a user who owns at least one website)
// @access  Private (Website Owner)
router.delete('/:id', authenticateUserOwner, async (req, res) => {
    try {
        const plan = await Plan.findByIdAndDelete(req.params.id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found.' });
        }
        // TODO: Handle websites currently assigned to this plan (e.g., reassign to a default plan or prevent deletion)
        res.json({ message: 'Plan deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

export const planRoutes = router; // Changed from export default router;