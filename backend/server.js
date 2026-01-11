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

// Extract city from query
app.post('/api/extract-city', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const prompt = `Analyze query: "${query}". Return ONLY city name (English) if mentioned. If "current location" or no location, return "NONE".`;
    const result = await callGeminiAPI(prompt);

    if (result === 'NONE' || !result) {
      return res.json({ city: null });
    }

    const city = result.trim().replace(/['"]/g, '');
    res.json({ city });
  } catch (error) {
    console.error('Extract city error:', error);
    res.json({ city: null });
  }
});

// Chat endpoint
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, weather, history, language } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build weather context
    let weatherPrompt = "Weather data unavailable.";
    if (weather) {
      const forecastStr = weather.forecast?.map((f: DailyForecast) =>
        `${f.date}: ${f.temp}°C (${f.condition})`
      ).join(', ');

      weatherPrompt = `
        Active Location: ${weather.location}.
        Current: ${weather.condition} (${weather.description}), ${weather.temperature}°C.
        Wind: ${weather.windSpeed} km/h, Humidity: ${weather.humidity}%.
        5-Day Forecast: ${forecastStr}.
      `;
    }

    const langInstruction = language === 'en'
      ? "Respond in English."
      : "Respond in Japanese (Nihongo).";

    // Build conversation history
    const historyContext = history?.map((m: Message) =>
      `${m.role === 'user' ? 'User' : 'Aura'}: ${m.text}`
    ).join('\n') || '';

    const systemPrompt = `
      You are 'Sora', a bilingual lifestyle AI assistant with a cute robot personality.
      Theme: Travel & Lifestyle.
      User Language: ${language === 'en' ? 'English' : 'Japanese'}.
      ${weatherPrompt}

      **Conversation History:**
      ${historyContext}

      Instructions:
      1. ${langInstruction}
      2. **Intelligent Planning:**
          - **Clothing Advice:** Suggest what to wear based on the weather (e.g. "Take a coat!").
          - **Local Insight:** Mention one fun fact or famous thing about the location.
      3. **Greetings:**
          - If the Conversation History is empty or very short, introduce yourself briefly ("Hi, I'm Aura!").
          - **CRITICAL:** If the Conversation History shows we are already talking, **DO NOT greet the user again**. Do not say "Hi" or "I am Aura". Just answer the new question directly.
      4. **IMPORTANT:** Do NOT use Markdown headers. Use **bold** for titles.
      5. Be helpful, warm, and concise.
      6. **Suggestions:** At the VERY END, provide 2-3 short, relevant follow-up questions enclosed in tildes (~). Example: ~Check weekend?~ ~Best food?~
    `;

    const aiResponse = await callGeminiAPI(message, systemPrompt);

    if (!aiResponse) {
      return res.status(500).json({ error: 'No response from AI' });
    }

    res.json({ text: aiResponse });
  } catch (error: any) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: error.message || 'Chat processing failed' });
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