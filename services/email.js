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

// Reusable ChatBot Hub Logo (Base64 PNG for better email client compatibility)
// Reusable ChatBot Hub Logo SVG
const chatBotHubLogoSvg = `
<img src="https://chat-bot-hub.vercel.app/assets/logo.png" alt="ChatBot Hub Logo" width="80" height="80" style="display: block;" />

`;

export const changePasswordLinkEmail = async (toEmail, resetLink) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: 'Your ChatBot Hub Password Reset Request',
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #059669, #10B981); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">Reset Your ChatBot Hub Password</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">It looks like you've requested a password reset for your ChatBot Hub account. No worries, we're here to help you get back in!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 32px; line-height: 1.6;">To securely reset your password, please click the button below:</p>
            <a href="${resetLink}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #10B981, #059669); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 18px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2); transition: all 0.3s ease-in-out; transform: translateY(0); /* For hover effect */">
                Reset Password
            </a>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">If the button doesn't work, you can also copy and paste this link into your browser:</p>
            <p style="font-size: 15px; color: #059669; word-break: break-all; margin-top: 8px;"><a href="${resetLink}" style="color: #059669; text-decoration: underline;">${resetLink}</a></p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">If you didn't request this password reset, please ignore this email. Your password will remain unchanged and secure.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Warmly,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Password reset email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending password reset email to ${toEmail}:`, error);
        throw new Error('Failed to send password reset email.');
    }
};

export const subscriptionSuccessEmail = async (toEmail, websiteName, planName, nextBillingDate) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: `Your ChatBot Hub Payment for ${websiteName} Was Successful!`,
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #059669, #10B981); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">Payment Confirmed! 🎉 Your ChatBot Hub is Ready!</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">Great news! Your recent payment for <strong>${websiteName}</strong> has been successfully processed. Thank you for keeping your chatbot running smoothly!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 24px; line-height: 1.6;">You're all set and continue to enjoy the full benefits of your <strong>${planName}</strong> plan.</p>
            <p style="font-size: 18px; color: #475569; margin-bottom: 32px; line-height: 1.6;">Your next billing date is scheduled for <strong>${nextBillingDate}</strong>. We'll make sure to keep you informed!</p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">Need to review your subscription details or explore more features? Simply log in to your ChatBot Hub dashboard.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Best regards,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Subscription success email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending subscription success email to ${toEmail}:`, error);
    }
};

export const subscriptionFailedEmail = async (toEmail, websiteName, websiteId) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: `Uh Oh! Your ChatBot Hub Payment for ${websiteName} Has Failed`,
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #EF4444, #DC2626); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">Oops! We Couldn't Process Your Payment for ${websiteName}</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">We're writing to let you know that your recent subscription payment for <strong>${websiteName}</strong> was unsuccessful.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 24px; line-height: 1.6;">To avoid any interruptions to your ChatBot Hub service, please update your payment information as soon as possible.</p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">You can easily manage your payment details and retry your subscription by logging into your account settings.</p>
            <a href="${process.env.FRONTEND_URL}/websites/${websiteId}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #EF4444, #DC2626); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 18px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2); transition: all 0.3s ease-in-out; transform: translateY(0);">
                Update Payment Info
            </a>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">If you have any questions or need assistance, our support team is always here to help!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Sincerely,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Subscription failed email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending subscription failed email to ${toEmail}:`, error);
    }
};

export const firstSubscriptionEmail = async (toEmail, websiteName, planName, nextBillingDate) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: `Welcome to ChatBot Hub! Your First Subscription for ${websiteName} is Active!`,
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #059669, #10B981); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">A Warm Welcome to ChatBot Hub! 🎉</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">We're absolutely thrilled to welcome you to the ChatBot Hub community! Your very first subscription for <strong>${websiteName}</strong> is now active, and your journey to enhanced customer engagement begins!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 24px; line-height: 1.6;">You are now enjoying all the powerful features of our <strong>${planName}</strong> plan.</p>
            <p style="font-size: 18px; color: #475569; margin-bottom: 32px; line-height: 1.6;">Your next billing date is <strong>${nextBillingDate}</strong>. We're excited to see what you'll create!</p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">Ready to dive in? Click the button below to head to your dashboard, where you can start customizing your chatbot, viewing analytics, and much more!</p>
            <a href="${process.env.FRONTEND_URL}/dashboard" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #10B981, #059669); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 18px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2); transition: all 0.3s ease-in-out; transform: translateY(0);">
                Go to Your Dashboard
            </a>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">Our team is here to support you every step of the way. If you have any questions, don't hesitate to reach out!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Warmly and with excitement,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`First subscription email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending first subscription email to ${toEmail}:`, error);
    }
};

export const tokenPurchaseSuccessEmail = async (toEmail, tokensAdded, websiteName) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: `Awesome! Your Tokens for ${websiteName} Have Been Added!`,
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #059669, #10B981); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">Tokens Boosted! 🚀 Ready for More Conversations!</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">Fantastic! Your recent purchase of <strong>${tokensAdded} AI tokens</strong> for your website <strong>${websiteName}</strong> was a complete success.</p>
            <p style="font-size: 15px; color: #475569; margin-top: 16px;">These AI tokens power your chatbot's ability to understand and respond to users intelligently.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 24px; line-height: 1.6;">Your chatbot is now powered up with more interaction capacity, ready to engage with your visitors and provide instant support.</p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">Keep an eye on your usage in your ChatBot Hub dashboard. If you ever need more tokens, we're here to help you seamlessly scale your operations.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Happy chatting,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Token purchase success email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending token purchase success email to ${toEmail}:`, error);
    }
};

export const billingWarningEmail = async (toEmail, websiteName, websiteId, daysUntilBilling, nextBillingDate) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: `Heads Up! Your ChatBot Hub Subscription for ${websiteName} is Due Soon`,
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #FACC15, #F59E0B); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">Upcoming Payment for ${websiteName}</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">Just a friendly reminder that your subscription payment for <strong>${websiteName}</strong> is coming up soon.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 24px; line-height: 1.6;">Your next payment of is due in <strong>${daysUntilBilling} day${daysUntilBilling !== 1 ? 's' : ''}</strong> on <strong>${nextBillingDate}</strong>.</p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">Please ensure your payment method is up to date to guarantee uninterrupted service for your chatbot. You can review your details anytime in your account settings.</p>
            <a href="${process.env.FRONTEND_URL}/websites/${websiteId}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #FACC15, #F59E0B); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 18px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2); transition: all 0.3s ease-in-out; transform: translateY(0);">
                Manage Billing
            </a>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">We appreciate you being a valued part of the ChatBot Hub community!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Cheers,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Billing warning email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending billing warning email to ${toEmail}:`, error);
    }
};

export const freeTrialEndWarningEmail = async (toEmail, websiteName, websiteId, currentPlanId, daysUntilEnd) => {
    try {
        const mailOptions = {
            from: `"ChatBot Hub" <${process.env.BREVO_SMTP_USER}>`,
            to: toEmail,
            subject: `Action Required: Your Free Trial for ${websiteName} Ends Soon!`,
            html: `
<table style="font-family: 'Inter', Helvetica, Arial, sans-serif; width: 100%; max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05); overflow: hidden;">
    <tr>
        <td style="padding: 40px 32px; text-align: center; background: linear-gradient(135deg, #F0F9FF, #F8FAFC); border-bottom: 1px solid #E2E8F0;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; background: linear-gradient(135deg, #FACC15, #F59E0B); border-radius: 20px; margin-bottom: 24px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);">
                ${chatBotHubLogoSvg}
            </div>
            <h1 style="font-size: 32px; font-weight: bold; color: #0F172A; margin-bottom: 16px; line-height: 1.2;">Your Free Trial for ${websiteName} is Ending!</h1>
            <p style="font-size: 18px; color: #475569; line-height: 1.6;">This is a friendly heads-up that your free trial for <strong>${websiteName}</strong> will end in just <strong>${daysUntilEnd} day${daysUntilEnd !== 1 ? 's' : ''}</strong>!</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 32px; text-align: center;">
            <p style="font-size: 18px; color: #475569; margin-bottom: 24px; line-height: 1.6;">We hope you've loved using ChatBot Hub to boost your website's engagement. To continue enjoying all the premium features and seamless chatbot performance, simply subscribe to a plan before your trial expires.</p>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">Don't let your amazing chatbot go! Choose the perfect plan that fits your needs today:</p>
            <a href="${process.env.FRONTEND_URL}/pricing?websiteId=${websiteId}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #FACC15, #F59E0B); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 18px; box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2); transition: all 0.3s ease-in-out; transform: translateY(0);">
                Choose Your Plan
            </a>
            <p style="font-size: 15px; color: #475569; margin-top: 32px; line-height: 1.6;">If you have any questions or need help selecting a plan, our support team is ready to assist you.</p>
        </td>
    </tr>
    <tr>
        <td style="padding: 24px; text-align: center; border-top: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <p style="font-size: 15px; color: #475569; margin-bottom: 8px;">Warmly,</p>
            <p style="font-size: 16px; font-weight: bold; color: #0F172A;">The ChatBot Hub Team</p>
        </td>
    </tr>
</table>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`Free trial end warning email sent to: ${toEmail}`);
    } catch (error) {
        console.error(`Error sending free trial end warning email to ${toEmail}:`, error);
    }
};