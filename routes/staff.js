import express from "express";
import authMiddleware from "../middleware/auth.js";
import {
  loginStaff,
  createStaff,
  getStaff,
  deleteStaff,
  getPlanInfo,
} from "../controllers/staffController.js";

const router = express.Router();

router.post("/login", loginStaff);
router.post("/:websiteId", authMiddleware, createStaff);
router.get("/:websiteId", authMiddleware, getStaff);
router.delete("/:staffId", authMiddleware, deleteStaff);
router.get("/:websiteId/plan-info", getPlanInfo);

export default router;
