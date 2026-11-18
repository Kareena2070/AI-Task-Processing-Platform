
require("dotenv").config();

const express = require("express");
const { connectDB } = require("./config/database");
const { connectRedis } = require("./config/redis");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "AI Task Processing Platform API is running",
    });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        await connectDB();
        await connectRedis();

        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error.message);
        process.exit(1);
    }
}

startServer();
