// routes/user.js
import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/user.js'; // Updated User model
import Website from '../models/website.js'; // Assuming Website model is correctly imported
import Plan from '../models/plan.js';     // Assuming Plan model is correctly imported
import authMiddleware from '../middleware/auth.js'; // Import the authentication middleware
import { changePasswordLinkEmail } from '../services/email.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here'; // Use a strong key from .env

// @route   POST /api/users/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Basic validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Check if user already exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        // Create new user (password hashing handled by pre-save hook in model)
        user = new User({ email, password });
        await user.save();

        // Generate JWT
        const payload = {
            user: {
                id: user.id,
                email: user.email,
            },
        };

        jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' }, (err, token) => {
            if (err) throw err;
            // Return token and basic user info (id, email)
            res.status(201).json({ 
                message: 'User registered successfully',
                token, 
                user: { id: user.id, email: user.email } // Only send id and email
            });
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/users/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Basic validation
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // Compare password (using method from user model)
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // Generate JWT
        const payload = {
            user: {
                id: user.id,
                email: user.email,
            },
        };

        jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' }, (err, token) => {
            if (err) throw err;
            // Return token and basic user info (id, email)
            res.json({ 
                message: 'Logged in successfully',
                token, 
                user: { id: user.id, email: user.email } // Only send id and email
            });
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/users/:userId
// @desc    Get user profile by ID
// @access  Private (requires authMiddleware)
router.get('/:userId', authMiddleware, async (req, res) => {
    try {
        // Ensure the authenticated user (from token) matches the requested userId in params
        if (req.user.id !== req.params.userId) {
            return res.status(403).json({ message: 'Unauthorized: Access denied' });
        }

        // Find user by ID and populate websites, plans, and preferences, but exclude password
        // This is where the full, fresh user data is retrieved.
        const user = await User.findById(req.params.userId)
            .select('-password') // Exclude password from the response
            .populate({
                path: 'websites',
                model: Website,
                populate: { path: 'plan', model: Plan }
            })
            .populate({ // Populate transactions as well if needed in frontend
                path: 'transactions',
                model: 'Transaction', // Assuming your Transaction model is named 'Transaction'
            });


        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});


// @route   PUT /api/users/:userId/preferences
// @desc    Update user preferences
// @access  Private
router.put('/:userId/preferences', authMiddleware, async (req, res) => {
    const { preferences } = req.body;

    try {
        // Ensure the authenticated user matches the requested userId
        if (req.user.id !== req.params.userId) {
            return res.status(403).json({ message: 'Unauthorized: Access denied' });
        }

        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Merge new preferences with existing ones
        user.preferences = { ...user.preferences, ...preferences };
        await user.save();

        res.json({ message: 'Preferences updated successfully', preferences: user.preferences });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// @route   POST /api/users/forgot-password
// @desc    Request a password reset link (send email)
// @access  Public
const RESET_PASSWORD_SECRET = process.env.RESET_PASSWORD_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        // Find the user by email
        const user = await User.findOne({ email });

        // If user not found, still return success to prevent email enumeration
        if (!user) {
            return res.status(200).json({ message: 'If a user with that email exists, a password reset link has been sent.' });
        }

        // Generate a unique token for password reset
        const resetToken = jwt.sign({ id: user._id.toString() }, RESET_PASSWORD_SECRET, { expiresIn: '1h' }); // Token valid for 1 hour

        // Store the token and its expiration in the user document
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour from now (in milliseconds)
        await user.save();

        // Construct the reset link for the frontend
        const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

        // Send the email with the reset link
        await changePasswordLinkEmail(user.email, resetLink);

        res.status(200).json({ message: 'If a user with that email exists, a password reset link has been sent.' });

    } catch (err) {
        console.error('Error in forgot-password:', err.message);
        res.status(500).json({ message: 'Server Error. Could not send password reset email.' });
    }
});

// @route   POST /api/users/reset-password
// @desc    Reset user's password using the token
// @access  Public
router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        // Basic validation for new password
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, RESET_PASSWORD_SECRET);
        } catch (err) {
            return res.status(400).json({ message: 'Invalid or expired password reset token.' });
        }

        // Find the user by the ID from the token and check the token's validity in the database
        const user = await User.findOne({
            _id: decoded.id,
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() } // Token has not expired
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or expired password reset token.' });
        }

        // Update the user's password (pre-save hook will hash it)
        user.password = newPassword;
        user.resetPasswordToken = undefined; // Clear the token
        user.resetPasswordExpires = undefined; // Clear the expiration
        await user.save();

        res.status(200).json({ message: 'Your password has been successfully reset.' });

    } catch (err) {
        console.error('Error in reset-password:', err.message);
        res.status(500).json({ message: 'Server Error. Could not reset password.' });
    }
});

export const userRoutes = router;