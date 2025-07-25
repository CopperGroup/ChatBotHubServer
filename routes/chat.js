// routes/chat.js
import express from "express";
import authMiddleware from "../middleware/auth.js";
import {
  getChatsByEmail,
  getChatById,
  getChatsByOwner,
  createChat,
  updateChat,
  toggleAIResponses,
  assignStaff,
  unassignStaff,
  getChatsByStaff,
  getChatsByIds,
} from "../controllers/chatController.js";

const router = express.Router();

router.get("/:chatbotCode/:email", getChatsByEmail);
router.get("/:chatId", getChatById);
router.get("/owner/:userId/:websiteId", authMiddleware, getChatsByOwner);
router.post("/", createChat);
router.put("/:chatId", updateChat);
router.put("/:chatId/toggle-ai-responses", authMiddleware, toggleAIResponses);
router.put("/:chatId/assign-staff", authMiddleware, assignStaff);
router.put("/:chatId/unassign-staff", authMiddleware, unassignStaff);
router.get("/staff/:staffId/:websiteId", authMiddleware, getChatsByStaff);
router.post("/get-by-ids", authMiddleware, getChatsByIds);

export const chatRoutes = router;
