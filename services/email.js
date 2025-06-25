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
            from: `"CBH" <${process.env.BREVO_SMTP_USER}>`, // Sender address (must be a verified sender in Brevo)
            to: toEmail, // Recipient address
            subject: 'Password Reset Request', // Subject line
            html: `
                <table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #F8FAFC; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);">
                    <tr>
                        <td style="padding: 32px 24px; text-align: center;">
                            <!-- App Logo/Icon Section -->
                            <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background-color: #059669; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.06);">
                                <span style="font-size: 32px; color: #ffffff; font-weight: bold;">&#9889;</span> 
                                <!-- Unicode for High Voltage Sign (Zap) -->
                            </div>
                            <h1 style="font-size: 28px; font-weight: bold; color: #0F172A; margin-bottom: 12px;">Reset Your Password</h1>
                            <p style="font-size: 16px; color: #475569; line-height: 1.5;">You are receiving this because you (or someone else) have requested the reset of the password for your account.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 32px 24px; text-align: center;">
                            <p style="font-size: 16px; color: #475569; margin-bottom: 24px; line-height: 1.5;">Please click on the button below to complete the process:</p>
                            
                            <!-- Reset Password Button -->
                            <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #10B981; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.06); transition: background-color 0.2s ease-in-out;">
                                Reset Password
                            </a>

                            <p style="font-size: 14px; color: #475569; margin-top: 24px; line-height: 1.5;">If the button above does not work, you can also copy and paste the following link into your browser:</p>
                            <p style="font-size: 14px; color: #10B981; word-break: break-all;"><a href="${resetLink}" style="color: #10B981; text-decoration: underline;">${resetLink}</a></p>

                            <p style="font-size: 14px; color: #475569; margin-top: 24px; line-height: 1.5;">If you did not request this, please ignore this email and your password will remain unchanged.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0;">
                            <p style="font-size: 14px; color: #475569; margin-bottom: 4px;">Regards,</p>
                            <p style="font-size: 14px; font-weight: bold; color: #0F172A;">CBH Application Team</p>
                        </td>
                    </tr>
                </table>
            `, // HTML body
        };

        await transporter.sendMail(mailOptions);
        console.log(`Password reset email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending password reset email to ${toEmail}:`, error);
        throw new Error('Failed to send password reset email.');
    }
};