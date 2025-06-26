// middleware/auth.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Ensure you set a strong, secret key in your .env file
const JWT_SECRET = process.env.JWT_SECRET

const authMiddleware = (req, res, next) => {
    // Get token from header (commonly 'x-auth-token' or 'Authorization: Bearer <token>')
    const token = req.header('x-auth-token') || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

    // Check if not token
    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Attach user payload from token to the request object
        req.user = decoded.user;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
        console.log("Decoding error", err.message)
    }
};

export default authMiddleware;