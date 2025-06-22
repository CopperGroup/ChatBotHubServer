// services/plan-validator.js
import Website from "../models/website.js";
import Staff from "../models/staff.js";
import Plan from "../models/plan.js";

/**
 * PlanValidator class to encapsulate logic for validating plan limits.
 */
export class PlanValidator {
  /**
   * Validates the staff member limit for a given website based on its plan.
   * @param {string} websiteId - The ID of the website.
   * @returns {Promise<{isValid: boolean, current: number, max: number, planName: string}>}
   */
  static async validateStaffLimit(websiteId) {
    try {
      const website = await Website.findById(websiteId).populate("plan");

      if (!website) {
        throw new Error("Website not found.");
      }
      if (!website.plan) {
        throw new Error("Website plan not found. Ensure plans are assigned.");
      }

      const currentStaffCount = await Staff.countDocuments({ website: websiteId });
      const maxStaffMembersAllowed = website.plan.maxStaffMembers;
      const planName = website.plan.name;

      const isValid = currentStaffCount < maxStaffMembersAllowed;

      return {
        isValid: isValid,
        current: currentStaffCount,
        max: maxStaffMembersAllowed,
        planName: planName,
      };
    } catch (error) {
      console.error("Error validating staff limit:", error.message);
      // Return a state that indicates an error or a restrictive default
      return {
        isValid: false,
        current: -1, // Indicates error
        max: 0,
        planName: "Unknown",
        error: error.message,
      };
    }
  }

  /**
   * Validates AI usage for a given website based on its plan and available credits.
   * @param {string} websiteId - The ID of the website.
   * @returns {Promise<{isValid: boolean, planAllowsAI: boolean, creditCount: number, planName: string}>}
   */
  static async validateAIUsage(websiteId) {
    try {
      const website = await Website.findById(websiteId).populate("plan");

      if (!website) {
        throw new Error("Website not found.");
      }
      if (!website.plan) {
        throw new Error("Website plan not found. Ensure plans are assigned.");
      }

      const planAllowsAI = website.plan.allowAI;
      const creditCount = website.creditCount;
      const planName = website.plan.name;

      // AI usage is valid if the plan allows AI and there are credits remaining
      const isValid = planAllowsAI && creditCount > 0;

      return {
        isValid: isValid,
        planAllowsAI: planAllowsAI,
        creditCount: creditCount,
        planName: planName,
      };
    } catch (error) {
      console.error("Error validating AI usage:", error.message);
      // Return a state that indicates an error or a restrictive default
      return {
        isValid: false,
        planAllowsAI: false,
        creditCount: 0,
        planName: "Unknown",
        error: error.message,
      };
    }
  }
}
