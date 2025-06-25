// services/email.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST,
    port: process.env.BREVO_SMTP_PORT,
    auth: {
        user: process.env.BREVO_LOGIN,
        pass: process.env.BREVO_SMTP_PASSWORD,
    },
});

export const changePasswordLinkEmail = async (toEmail, resetLink) => {
    try {
        const mailOptions = {
            from:`"CBH" <${process.env.BREVO_SMTP_USER}>`, // Sender address (must be a verified sender in Brevo)
            to: toEmail, // Recipient address
            subject: 'Password Reset Request', // Subject line
            html: `
                <p>You are receiving this because you (or someone else) have requested the reset of the password for your account.</p>
                <p>Please click on the following link, or paste this into your browser to complete the process:</p>
                <p><a href="${resetLink}">${resetLink}</a></p>
                <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
                <br>
                <p>Regards,</p>
                <p>Your Application Team</p>
            `, // HTML body
        };

        await transporter.sendMail(mailOptions);
        console.log(`Password reset email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending password reset email to ${toEmail}:`, error);
        throw new Error('Failed to send password reset email.');
    }
};