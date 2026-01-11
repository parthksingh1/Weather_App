import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "ea896f5d1889d8566698c36adc91613b";

interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  isDay: boolean;
  location: string;
  description: string;
  forecast?: DailyForecast[];
  isDefault?: boolean;
}

interface DailyForecast {
  date: string;
  temp: number;
  condition: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

// Routes

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware
app.use(cors());
app.use(express.json());

app.listen(PORT, () => {
  console.log(`🚀 Sora backend server running on port ${PORT}`);
  console.log(`📍 API endpoints available at http://localhost:${PORT}/api`);
  console.log(`🔑 Gemini API Key configured: ${GEMINI_API_KEY ? 'Yes' : 'No'}`);
  console.log(`🌤️  Weather API Key configured: ${WEATHER_API_KEY ? 'Yes' : 'No'}`);
});

export default app;