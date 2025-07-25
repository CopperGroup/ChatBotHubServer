import express from "express";
import authMiddleware from "../middleware/auth.js";
import {
  getTransactions,
  createTransaction,
} from "../controllers/transactionController.js";

const router = express.Router();

router.get("/:userId", authMiddleware, getTransactions);
router.post("/:userId", authMiddleware, createTransaction);

export const transactionRoutes = router;
