import express from "express";
import { uploadSingleMedia } from "../controllers/fileController.js"; // <--- ADDED .js HERE
import upload from "../services/multer.js";

const router = express.Router();

// Route for single media file upload
router.post(
  "/", // Only approved users can upload
  upload.single("media"), // Multer middleware to handle the 'media' field from formData
  uploadSingleMedia
);

export const fileRoutes = router;
