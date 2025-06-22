import express from 'express';
import Chat from '../models/chat.js';
import Website from '../models/website.js';
import User from '../models/user.js'; // Assuming this import path
import Staff from '../models/staff.js'; // Import Staff model for validation
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Get chats for a website and email (used by the widget)
router.get('/:chatbotCode/:email', async (req, res) => {
    try {
        // Populating leadingStaff here for the widget might not be necessary, adjust if needed
        const website = await Website.findOne({ chatbotCode: req.params.chatbotCode }).populate('chats');

        if (!website) {
            return res.status(404).json({ message: 'Website not found' });
        }
        const userChats = website.chats.filter(chat => chat.email === req.params.email);
        res.status(200).json(userChats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get a single chat by ID
router.get('/:chatId', async (req, res) => {
    try {
        // Populate leadingStaff when fetching a single chat for detailed view
        const chat = await Chat.findById(req.params.chatId).populate({ path: 'leadingStaff', select: "-password"});
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        res.status(200).json(chat);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get all chats for a specific website owned by a user
router.get('/owner/:userId/:websiteId', authMiddleware, async (req, res) => {
    try {
        const { userId, websiteId } = req.params;

        // Verify if the user exists and owns this website
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Ensure the website belongs to this user
        if (!user.websites.includes(websiteId)) {
            return res.status(403).json({ message: 'Access denied: Website does not belong to this user.' });
        }

        const website = await Website.findById(websiteId).populate({
            path: 'chats',
            // Populate leadingStaff within the chats array for the owner dashboard
            populate: {
                path: 'leadingStaff',
                model: 'Staff',
                select: "-password"
            },
            options: { sort: { 'createdAt': -1 } } // Sort chats by creation date (newest first)
        });

        if (!website) {
            return res.status(404).json({ message: 'Website not found' });
        }

        res.status(200).json(website.chats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create a new chat (adjusted to also include aiResponsesEnabled in default)
router.post('/', async (req, res) => {
    const { chatbotCode, email } = req.body;
    try {
        const newChat = new Chat({
            name: 'New Chat',
            email,
            messages: JSON.stringify([]), // Ensure messages are an empty array string
            aiResponsesEnabled: true // Default to true for new chats
        });
        await newChat.save();

        const website = await Website.findOne({ chatbotCode });
        if (!website) {
            // If website not found, delete the newly created chat to prevent orphans
            await Chat.findByIdAndDelete(newChat._id);
            return res.status(404).json({ message: 'Website not found' });
        }
        website.chats.push(newChat._id);
        await website.save();

        res.status(201).json(newChat);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Update chat (e.g., add messages, update name, status)
router.put('/:chatId', async (req, res) => {
    const { messages, name, status } = req.body;
    try {
        const chat = await Chat.findById(req.params.chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }
        if (messages) {
            chat.messages = messages;
        }
        if (name) {
            chat.name = name;
        }
        if (status) {
            chat.status = status;
        }
        await chat.save();
        res.status(200).json({ message: 'Chat updated successfully' });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Toggle AI Responses for a specific chat
router.put('/:chatId/toggle-ai-responses', authMiddleware, async (req, res) => {
    const { chatId } = req.params;
    const { enable } = req.body;

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found.' });
        }

        if (typeof enable !== 'boolean') {
            return res.status(400).json({ message: 'Invalid value for "enable". Must be true or false.' });
        }

        chat.aiResponsesEnabled = enable;
        await chat.save();

        res.status(200).json({
            message: `AI responses for chat ${chatId} set to ${enable}`,
            aiResponsesEnabled: chat.aiResponsesEnabled
        });

    } catch (err) {
        console.error(`Error toggling AI responses for chat ${chatId}:`, err);
        res.status(500).json({ message: err.message });
    }
});

// NEW ROUTE: Assign a staff member to a chat
router.put('/:chatId/assign-staff', authMiddleware, async (req, res) => {
    const { chatId } = req.params;
    const { staffId } = req.body; // Expect the ID of the staff member to assign

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found.' });
        }

        const staffMember = await Staff.findById(staffId);
        if (!staffMember) {
            return res.status(404).json({ message: 'Staff member not found.' });
        }

        // Optional: Validate that the staff member belongs to the same website as the chat
        // Fetch website of the chat
        const chatWebsite = await Website.findById(chat.website);
        if (!chatWebsite || staffMember.website.toString() !== chatWebsite._id.toString()) {
            return res.status(403).json({ message: 'Staff member is not associated with this website.' });
        }

        chat.leadingStaff = staffId;
        await chat.save();

        res.status(200).json({
            message: `Staff member ${staffMember.name} assigned to chat ${chatId}.`,
            leadingStaff: staffMember // Return the assigned staff member details if needed by client
        });

    } catch (err) {
        console.error(`Error assigning staff to chat ${chatId}:`, err);
        res.status(500).json({ message: err.message });
    }
});

// NEW ROUTE: Unassign a staff member from a chat
router.put('/:chatId/unassign-staff', authMiddleware, async (req, res) => {
    const { chatId } = req.params;

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found.' });
        }

        // Optional: Authorization check to ensure only assigned staff or owner can unassign
        // if (chat.leadingStaff && chat.leadingStaff.toString() !== req.user.id && chatWebsite.owner.toString() !== req.user.id) {
        //      return res.status(403).json({ message: 'Not authorized to unassign staff from this chat.' });
        // }

        chat.leadingStaff = null; // Set to null to unassign
        await chat.save();

        res.status(200).json({
            message: `Staff member unassigned from chat ${chatId}.`,
            leadingStaff: null
        });

    } catch (err) {
        console.error(`Error unassigning staff from chat ${chatId}:`, err);
        res.status(500).json({ message: err.message });
    }
});


router.get("/staff/:staffId/:websiteId", authMiddleware, async (req, res) => {
    try {
        const { staffId, websiteId } = req.params

        // Verify if the staff member exists and is assigned to this website
        const staff = await Staff.findById(staffId)
        if (!staff) {
            return res.status(404).json({ message: "Staff member not found" })
        }

        // Ensure the staff member is assigned to this website
        if (staff.website.toString() !== websiteId) {
            return res.status(403).json({ message: "Access denied: Staff member not assigned to this website." })
        }

        const website = await Website.findById(websiteId).populate({
            path: "chats",
            // Populate leadingStaff within the chats array for the staff dashboard
            populate: {
                path: 'leadingStaff',
                model: 'Staff',
                select: "-password"
            },
            options: { sort: { createdAt: -1 } }, // Sort chats by creation date (newest first)
        })

        if (!website) {
            return res.status(404).json({ message: "Website not found" })
        }

        res.status(200).json(website.chats)
    } catch (err) {
        res.status(500).json({ message: err.message })
    }
})

// NEW ROUTE: Get a list of chats from an array of chat IDs
router.post('/get-by-ids', authMiddleware, async (req, res) => {
    try {
        const { chatIds } = req.body; // Expect an array of chat IDs in the request body

        // Validate that chatIds is an array and not empty
        if (!Array.isArray(chatIds) || chatIds.length === 0) {
            return res.status(400).json({ message: 'Invalid input: chatIds must be a non-empty array.' });
        }

        // Use $in operator to find all chats whose _id is in the provided chatIds array
        // Populate leadingStaff for these chats
        const chats = await Chat.find({ _id: { $in: chatIds } }).select("_id messages status")

        res.status(200).json(chats);
    } catch (err) {
        console.error('Error fetching chats by IDs:', err);
        res.status(500).json({ message: err.message });
    }
});


export const chatRoutes = router;