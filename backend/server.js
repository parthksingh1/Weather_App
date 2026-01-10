const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

app.get('/', (req, res) => res.send('Sora Backend Active'));

// Weather API
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon, q, lang } = req.query;
    let url = '';
    const apiLang = lang === 'ja' ? 'ja' : 'en';

    if (q) {
      url = `https://api.openweathermap.org/data/2.5/forecast?q=${q}&appid=${WEATHER_API_KEY}&units=metric&lang=${apiLang}`;
    } else if (lat && lon) {
      url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric&lang=${apiLang}`;
    } else {
      return res.status(400).json({ error: 'Missing location parameters' });
    }

    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Weather Error:', error.message);
    res.status(500).json({ error: 'Weather fetch failed' });
  }
});

// Chat API
app.post('/api/chat', async (req, res) => {
  try {
    const { text, history, weatherPrompt, language } = req.body;
    const langInstruction = language === 'en' ? "Respond in English." : "Respond in Japanese.";

    const systemPrompt = `
      You are 'Sora', a bilingual lifestyle AI assistant.
      User Language: ${language === 'en' ? 'English' : 'Japanese'}.
      ${weatherPrompt || "Weather data unavailable."}
      
      **History:**
      ${history || "No history."}

      Instructions:
      1. ${langInstruction}
      2. **Planning:** Suggest clothing and give a local insight based on location/weather.
      3. **Greeting:** If History exists, DO NOT greet again.
      4. **Length:** Keep responses concise (3-5 sentences).
      5. **Formatting:** Use **bold** for titles.
      6. **Suggestions:** End with 2-3 short suggestions in tildes (~).
    `;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: text }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Gemini Error:', error.message);
    res.status(500).json({ error: 'AI Error' });
  }
});

// Translation API
app.post('/api/translate', async (req, res) => {
  try {
    const { messages, targetLangName } = req.body;
    const prompt = `Translate these messages to ${targetLangName}. Return JSON {id: translatedText}. Input: ${JSON.stringify(messages)}`;
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Translation failed' });
  }
});

// Location Extraction API
app.post('/api/extract-city', async (req, res) => {
  try {
    const { text } = req.body;
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: `Analyze: "${text}". Return ONLY city name (English) or "NONE".` }] }] }
    );
    const result = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    res.json({ city: result === 'NONE' ? null : result?.replace(/['"]/g, '') });
  } catch (error) {
    res.json({ city: null });
  }
});

app.listen(PORT, () => console.log(`Sora Server running on port ${PORT}`));