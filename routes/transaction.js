// routes/transactions.js
import express from 'express';
import Transaction from '../models/transaction.js';
import User from '../models/user.js'; // To update user's transactions array
import authMiddleware from '../middleware/auth.js'; // Import authentication middleware

const router = express.Router();

// @route   GET /api/transactions/:userId
// @desc    Get all transactions for a specific user
// @access  Private (requires authMiddleware)
router.get('/:userId', authMiddleware, async (req, res) => {
    try {
        // Ensure the authenticated user matches the requested userId
        if (req.user.id !== req.params.userId) {
            return res.status(403).json({ message: 'Unauthorized: Access denied' });
        }

        const transactions = await Transaction.find({ user: req.params.userId }).sort({ date: -1 }); // Sort by most recent
        res.status(200).json(transactions);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/transactions/:userId
// @desc    Create a new transaction for a specific user
// @access  Private (requires authMiddleware)
router.post('/:userId', authMiddleware, async (req, res) => {
    const { amount, name, status } = req.body; // 'date' will default, 'status' can be overridden

    try {
        // Ensure the authenticated user matches the requested userId
        if (req.user.id !== req.params.userId) {
            return res.status(403).json({ message: 'Unauthorized: Access denied' });
        }

        // Basic validation
        if (amount === undefined || !name) {
            return res.status(400).json({ message: 'Amount and name are required for a transaction' });
        }

        const newTransaction = new Transaction({
            user: req.params.userId,
            amount,
            name,
            status, // Will use default if not provided
        });

        await newTransaction.save();

        // Optionally, link the transaction ID to the user's transactions array
        await User.findByIdAndUpdate(req.params.userId, { $push: { transactions: newTransaction._id } });

        res.status(201).json({ message: 'Transaction created successfully', transaction: newTransaction });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

export const transactionRoutes = router; // Export router for use in server.js