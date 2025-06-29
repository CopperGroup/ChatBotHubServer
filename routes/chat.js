import express from 'express';
import Chat from '../models/chat.js';
import Website from '../models/website.js';
import User from '../models/user.js';
import Staff from '../models/staff.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Get chats for a website and email (used by the widget)
router.get('/:chatbotCode/:email', async (req, res) => {
    try {
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
        // Populate leadingStaff AND website when fetching a single chat for detailed view
        const chat = await Chat.findById(req.params.chatId)
                                .populate({ path: 'leadingStaff', select: "-password"})
                                .populate('website'); // ADDED: populate website here
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

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.websites.includes(websiteId)) {
            return res.status(403).json({ message: 'Access denied: Website does not belong to this user.' });
        }

        const website = await Website.findById(websiteId).populate({
            path: 'chats',
            populate: [ // Use an array for multiple populates on a sub-path
                { path: 'leadingStaff', model: 'Staff', select: "-password" },
                { path: 'website', model: 'Website', select: 'chatbotCode name' } // Populate website info for each chat if needed
            ],
            options: { sort: { 'createdAt': -1 } }
        });

        if (!website) {
            return res.status(404).json({ message: 'Website not found' });
        }

        res.status(200).json(website.chats);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create a new chat
router.post('/', async (req, res) => {
    const { chatbotCode, email } = req.body;
    try {
        const website = await Website.findOne({ chatbotCode });
        if (!website) {
            return res.status(404).json({ message: 'Website not found' });
        }

        const newChat = new Chat({
            name: 'New Conversation', // Changed from 'New Chat' to match workflow default
            email,
            messages: JSON.stringify([]),
            aiResponsesEnabled: true,
            website: website._id // ADDED: Save the website ID here
        });
        await newChat.save();

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
    const { staffId } = req.body;

    try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found.' });
        }

        const staffMember = await Staff.findById(staffId);
        if (!staffMember) {
            return res.status(404).json({ message: 'Staff member not found.' });
        }

        // Fetch website of the chat
        const chatWebsite = await Website.findById(chat.website); // Now chat.website exists!
        if (!chatWebsite || staffMember.website.toString() !== chatWebsite._id.toString()) {
            return res.status(403).json({ message: 'Staff member is not associated with this website.' });
        }

        chat.leadingStaff = staffId;
        await chat.save();

        res.status(200).json({
            message: `Staff member ${staffMember.name} assigned to chat ${chatId}.`,
            leadingStaff: staffMember
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

        chat.leadingStaff = null;
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

        const staff = await Staff.findById(staffId)
        if (!staff) {
            return res.status(404).json({ message: "Staff member not found" })
        }

        if (staff.website.toString() !== websiteId) {
            return res.status(403).json({ message: "Access denied: Staff member not assigned to this website." })
        }

        const website = await Website.findById(websiteId).populate({
            path: "chats",
            populate: [
                { path: 'leadingStaff', model: 'Staff', select: "-password" },
                { path: 'website', model: 'Website', select: 'chatbotCode name' } // Populate website info for each chat if needed
            ],
            options: { sort: { createdAt: -1 } },
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
        const { chatIds } = req.body;

        if (!Array.isArray(chatIds) || chatIds.length === 0) {
            return res.status(400).json({ message: 'Invalid input: chatIds must be a non-empty array.' });
        }

        const chats = await Chat.find({ _id: { $in: chatIds } })
                                .select("_id messages status")
                                .populate('website'); // ADDED: Populate website when fetching by IDs too

        res.status(200).json(chats);
    } catch (err) {
        console.error('Error fetching chats by IDs:', err);
        res.status(500).json({ message: err.message });
    }
});


export const chatRoutes = router;