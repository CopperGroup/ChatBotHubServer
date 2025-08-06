import express from "express";
import { uploadSingleMedia, uploadSingleMediaPublic } from "../controllers/fileController.js"; // <--- ADDED .js HERE
import upload from "../services/multer.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// Route for single media file upload
router.post(
  "/", // Only approved users can upload
  upload.single("media"), // Multer middleware to handle the 'media' field from formData
  uploadSingleMedia
);

router.post(
  "/public", // Only approved users can upload
  authMiddleware,
  upload.single("media"), // Multer middleware to handle the 'media' field from formData
  uploadSingleMediaPublic
);

export const fileRoutes = router;
