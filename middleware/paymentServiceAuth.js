// middleware/paymentServiceAuth.js
import dotenv from 'dotenv';
dotenv.config();

// This API key must be a strong, randomly generated string.
// Store it securely in your main service's .env file.
const PAYMENT_SERVICE_API_KEY = process.env.PAYMENT_SERVICE_API_KEY;

const paymentServiceAuth = (req, res, next) => {
    const apiKey = req.headers['x-payment-service-api-key'];

    if (!apiKey || apiKey !== PAYMENT_SERVICE_API_KEY) {
        console.warn('Unauthorized attempt to access payment service protected route. Invalid API Key:', apiKey);
        return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
    }
    next();
};

export default paymentServiceAuth;