const { MongoClient } = require("mongodb");

let client;
let database;

async function connectDB() {
    if (database) {
        return database;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MONGODB_URI is missing from environment variables");
    }

    try {
        client = new MongoClient(uri);
        await client.connect();

        database = client.db("ai_task_platform");

        await database.command({ ping: 1 });

        console.log("MongoDB connected successfully!");

        return database;
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        throw error;
    }
}

function getDB() {
    if (!database) {
        throw new Error("Database not initialized. Call connectDB first.");
    }
    return database;
}

module.exports = {
    connectDB,
    getDB,
};