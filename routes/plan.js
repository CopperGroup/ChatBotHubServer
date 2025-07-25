import express from "express";
import {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  deletePlan,
} from "../controllers/planController.js";

const router = express.Router();

// @route   POST /api/plans
router.post("/", createPlan);

// @route   GET /api/plans
router.get("/", getAllPlans);

// @route   GET /api/plans/:id
router.get("/:id", getPlanById);

// @route   PUT /api/plans/:id
router.put("/:id", updatePlan);

// @route   DELETE /api/plans/:id
router.delete("/:id", deletePlan);

export const planRoutes = router;
