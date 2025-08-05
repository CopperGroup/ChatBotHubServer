// routes/widgetRoutes.js

import express from 'express';
import { getChatbotWidget, validateOrigin } from '../controllers/widgetController.js';

const router = express.Router();

router.get("/chatbot-widget.js", getChatbotWidget);
router.post("/validate", validateOrigin);

export const widjetRoutes = router;