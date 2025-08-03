// src/services/backblazeB2Service.js

// Import your custom Backblaze B2 client module
// Make sure the path is correct based on where your createBackblazeB2 function is located.
// If createBackblazeB2 is in 'src/index.js' and this service is in 'src/services/',
// then the path should be '../index'.
import createBackblazeB2 from "fast-back-blaze"; // Adjust this path if your module is located elsewhere
import dotenv from "dotenv"; // Utility to get environment variables
dotenv.config();

// Retrieve Backblaze B2 credentials from environment variables using your config utility
const BACKBLAZE_B2_ACCESS_KEY_ID = process.env.BACKBLAZE_B2_ACCESS_KEY_ID;
const BACKBLAZE_B2_SECRET_ACCESS_KEY =
  process.env.BACKBLAZE_B2_SECRET_ACCESS_KEY;

const BACKBLAZE_B2_BUCKET_NAME = process.env.BACKBLAZE_B2_BUCKET_NAME;
const BACKBLAZE_B2_ENDPOINT = process.env.BACKBLAZE_B2_ENDPOINT; // from d for S3Client
const BACKBLAZE_B2_REGION = process.env.BACKBLAZE_B2_REGION; // Optional, but good to have for region-specific endpoints

// Initialize Backblaze B2 client
// It's crucial that either BACKBLAZE_B2_ENDPOINT or BACKBLAZE_B2_REGION is provided in your .env
const b2Client = createBackblazeB2({
  accessKeyId: BACKBLAZE_B2_ACCESS_KEY_ID,
  secretAccessKey: BACKBLAZE_B2_SECRET_ACCESS_KEY,
  bucketName: BACKBLAZE_B2_BUCKET_NAME,
  endpoint: BACKBLAZE_B2_ENDPOINT,
  region: BACKBLAZE_B2_REGION, // Pass region if it's set, otherwise createBackblazeB2 will use a default
});

/**
 * Uploads media (image/video) to Backblaze B2.
 * @param {Buffer} fileBuffer - The buffer of the file to upload.
 * @param {string} fileName - The desired key/path for the file in B2 (e.g., 'stories/user-id/image.jpg').
 * @param {string} contentType - The MIME type of the file (e.g., 'image/jpeg').
 * @returns {Promise<object>} A promise that resolves to the upload information including the S3-compatible URL.
 * @throws {Error} If the upload fails.
 */
export const uploadMedia = async (fileBuffer, fileName, contentType) => {
  try {
    const uploadResult = await b2Client.uploadFile(
      fileBuffer,
      fileName,
      contentType
    );
    console.log(
      `Media uploaded to Backblaze B2 (S3 Endpoint): ${uploadResult.Location}`
    );
    return uploadResult;
  } catch (error) {
    console.error("Error uploading media to Backblaze B2:", error);
    throw new Error(`Failed to upload media to Backblaze B2: ${error.message}`);
  }
};

/**
 * Deletes media from Backblaze B2.
 * @param {string} fileName - The key/path of the file to delete from B2.
 * @returns {Promise<void>} A promise that resolves when the file is deleted.
 * @throws {Error} If the deletion fails.
 */
export const deleteMedia = async (fileName) => {
  try {
    await b2Client.deleteFile(fileName);
    console.log(`Media deleted from Backblaze B2: ${fileName}`);
  } catch (error) {
    console.error("Error deleting media from Backblaze B2:", error);
    throw new Error(
      `Failed to delete media from Backblaze B2: ${error.message}`
    );
  }
};
