import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "";

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

// Weather API Handler
async function fetchWeather(
  query: string | { lat: number; lon: number },
  lang: string = 'en'
): Promise<WeatherData> {
  try {
    let url = '';
    const apiLang = lang === 'ja' ? 'ja' : 'en';

    if (typeof query === 'string') {
      url = `https://api.openweathermap.org/data/2.5/forecast?q=${query}&appid=${WEATHER_API_KEY}&units=metric&lang=${apiLang}`;
    } else {
      url = `https://api.openweathermap.org/data/2.5/forecast?lat=${query.lat}&lon=${query.lon}&appid=${WEATHER_API_KEY}&units=metric&lang=${apiLang}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather API Error");

    const data = await response.json();
    const current = data.list[0];
    const isDay = current.sys.pod === 'd';

    const dailyForecasts: DailyForecast[] = [];
    const seenDates = new Set();

    data.list.forEach((item: any) => {
      const date = new Date(item.dt * 1000).toLocaleDateString(
        lang === 'ja' ? 'ja-JP' : 'en-US',
        { weekday: 'short' }
      );
      if (!seenDates.has(date) && dailyForecasts.length < 5) {
        seenDates.add(date);
        dailyForecasts.push({
          date,
          temp: Math.round(item.main.temp),
          condition: item.weather[0].main
        });
      }
    });

    return {
      temperature: Math.round(current.main.temp),
      condition: current.weather[0].main,
      description: current.weather[0].description,
      humidity: current.main.humidity,
      windSpeed: Math.round(current.wind.speed * 3.6),
      isDay: isDay,
      location: data.city.name,
      forecast: dailyForecasts
    };
  } catch (error) {
    console.error("Weather fetch failed", error);
    throw new Error("Weather unavailable");
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiAPI(prompt: string, systemInstruction?: string, jsonMode: boolean = false, retries: number = 3) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Add exponential backoff delay for retries
      if (attempt > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        await sleep(delayMs);
      }

      const body: any = {
        contents: [{ parts: [{ text: prompt }] }]
      };

      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      if (jsonMode) {
        body.generationConfig = { responseMimeType: "application/json" };
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        // If rate limited (429), retry
        if (response.status === 429 && attempt < retries - 1) {
          console.log(`Rate limited, retrying in ${1000 * Math.pow(2, attempt + 1)}ms...`);
          lastError = new Error(`Gemini API Error: ${response.status}`);
          continue;
        }
        throw new Error(`Gemini API Error: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        console.log(`Gemini API attempt ${attempt + 1} failed, retrying...`);
        continue;
      }
      console.error("Gemini API call failed after all retries", error);
      throw error;
    }
  }

  throw lastError;
}

// Routes

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Weather endpoint
app.post('/api/weather', async (req: Request, res: Response) => {
  try {
    const { query, lang = 'en' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const weatherData = await fetchWeather(query, lang);
    res.json(weatherData);
  } catch (error: any) {
    console.error('Weather API error:', error);
    res.status(500).json({ error: error.message || 'Weather fetch failed' });
  }
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