// C:\Users\Admin\Desktop\ChatBotHub\ChatBotHubServer\controllers\fileController.js

// Only import the Backblaze B2 service functions
import { uploadMedia } from "../services/backblazeB2Service.js"; // Assuming services is parallel to controllers

/**
 * @desc Uploads a single media file to Backblaze B2 and returns its public URL
 * @route POST /api/v1/upload/media
 * @access Protected (only authenticated users can upload)
 */
export const uploadSingleMedia = async (req, res) => {
  // Changed to named export
  try {
    const file = req.file;

    if (!file) {
      throw { code: 400, message: "No media file provided for upload." };
    }

    const chatId = req.body.chatId;

    if (!chatId) {
      throw { code: 401, message: "Authentication required to upload media." };
    }

    const fileExtension = file.originalname.split(".").pop();
    const fileNameInB2 = `uploads/${chatId}/${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}.${fileExtension}`;

    const result = await uploadMedia(file.buffer, fileNameInB2, file.mimetype);

    console.log("result", result);

    if (!result) {
      throw {
        code: 500,
        message: "Failed to get public URL from Backblaze B2 after upload.",
      };
    }

    res.status(201).json({
      status: "success",
      data: {
        url: result.Location,
        fileName: fileNameInB2,
      },
    });
  } catch (err) {
    console.error(err);
    res
      .status(err.code || 500)
      .json({ message: err.message || "Server error during media upload." });
  }
};
