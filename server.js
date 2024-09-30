const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// MySQL connection details from environment variables
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
};

// Enable CORS for all origins (or specify your frontend origin if needed)
app.use(cors({
    origin: 'http://localhost:3000',
}));

// Multer configuration for handling file uploads (image stored in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Route to handle image upload
app.post('/upload', upload.single('image'), async (req, res) => {
    const file = req.file;
    const { width, height } = req.body;  // Image dimensions sent from the frontend

    if (!file) {
        return res.status(400).json({ message: 'No image file uploaded' });
    }

    if (!width || !height) {
        return res.status(400).json({ message: 'Image width and height are required' });
    }

    try {
        // Decode image from file buffer
        const buffer = file.buffer;

        // Connect to MySQL
        const connection = await mysql.createConnection(dbConfig);

        // Insert image into database as a BLOB along with dimensions and current timestamp
        const query = `
            INSERT INTO Images (image_data, image_datetime, image_width, image_height) 
            VALUES (?, NOW(), ?, ?)
        `;
        const [result] = await connection.execute(query, [buffer, width, height]);

        await connection.end();

        // Respond with success
        res.status(200).json({ message: 'Image uploaded successfully', imageId: result.insertId });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ message: 'Error uploading image', error });
    }
});

// Route to fetch all images
app.get('/images', async (req, res) => {
    try {
        // Connect to MySQL
        const connection = await mysql.createConnection(dbConfig);

        // Fetch all image records from the Images table
        const [rows] = await connection.execute(`
            SELECT image_id, image_data, image_datetime, image_width, image_height 
            FROM Images
        `);

        await connection.end();

        // Transform the image data (convert BLOB to base64)
        const images = rows.map((row) => ({
            id: row.image_id, // Ensure the correct ID field is used
            image: Buffer.from(row.image_data).toString('base64'),
            datetime: row.image_datetime,
            width: row.image_width,
            height: row.image_height,
        }));

        // Respond with the image array
        res.status(200).json(images);
    } catch (error) {
        console.error('Error fetching images:', error);
        res.status(500).json({ message: 'Error fetching images', error });
    }
});

app.get('/day',async (req, res) => {
    try{
        //setting the database
        const connection = await mysql.createConnection(dbConfig);

        const query = `
            SELECT image_id, image_data, image_datetime, image_width, image_height
            FROM Images
            WHERE image_dateTime = ?
            ORDER BY image_datetime
        `
        const [rows] = await connection.execute(query, req.params.date)

        await connection.end();


        // Transform the image data (convert BLOB to base64)
        const images = rows.map((row) => ({
            id: row.image_id, // Ensure the correct ID field is used
            image: Buffer.from(row.image_data).toString('base64'),
            datetime: row.image_datetime,
            width: row.image_width,
            height: row.image_height,
        }));


        // const [rows] = await connection.execute(`
        //     SELECT image_id, image_data, image_datetime, image_width, image_height
        //     FROM Images
        //     WHERE image_dateTime =
        //     ORDER BY image_datetime
        // `);

    } catch(error) {
        console.error('Error fetching images:', error);
        res.status(500).json({ message: 'Error fetching images', error });
    }
});

// Route to delete an image by ID
app.delete('/images/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Connect to MySQL
        const connection = await mysql.createConnection(dbConfig);

        // Delete the image from the Images table
        const query = `DELETE FROM Images WHERE image_id = ?`;
        const [result] = await connection.execute(query, [id]);

        await connection.end();

        // Check if the image was successfully deleted
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Image not found' });
        }

        // Respond with success
        res.status(200).json({ message: 'Image deleted successfully' });
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ message: 'Error deleting image', error });
    }


});

// Start the Express server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
