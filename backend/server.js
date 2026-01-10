import express from "express"
import axios from "axios"
import dotenv from "dotenv"
import cors from "cors"

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

// health check
app.get("/", (req, res) => {
  res.json({ message: "Weather backend is running" })
})

// weather by city name
app.get("/api/weather", async (req, res) => {
  try {
    const { city } = req.query

    if (!city) {
      return res.status(400).json({ error: "City is required" })
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${process.env.WEATHER_API_KEY}&units=metric`

    const response = await axios.get(url)

    const data = response.data

    res.json({
      city: data.name,
      country: data.sys.country,
      temperature: data.main.temp,
      feels_like: data.main.feels_like,
      humidity: data.main.humidity,
      weather: data.weather[0].main,
      description: data.weather[0].description,
      wind_speed: data.wind.speed,
    })
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ error: "City not found" })
    }

    res.status(500).json({ error: "Failed to fetch weather data" })
  }
})

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
