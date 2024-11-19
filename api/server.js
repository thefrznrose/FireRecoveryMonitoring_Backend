const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true }));

app.use(cors());

// sample api routes for testing
app.get('/', (req, res) => {
    res.json("welcome to our server")
});

// app.use(
//     cors({
//         Ac: [
//             'http://localhost:3000',
//             'http://localhost:3001', 
//             'https://fire-recovery-monitoring.vercel.app'],
//         methods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
//         allowedHeaders: ['Content-Type', 'Authorization'],
//     })
// );

// MySQL connection details from environment variables
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
};

// app.options('*', (req, res) => {
//     res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
//     res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE');
//     res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//     res.setHeader('Access-Control-Allow-Credentials', 'true');
//     res.sendStatus(204); // No content
// });


// app.use((req, res, next) => {
//     console.log(`Incoming request: ${req.method} ${req.url}`);
//     res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
//     res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE');
//     res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//     next();
//   });
  
// app.use((req, res, next) => {
//     console.log(`Incoming request: ${req.method} ${req.url}`);
//     console.log(`Headers: ${JSON.stringify(req.headers)}`);
//     console.log(`Body: ${JSON.stringify(req.body)}`);
//     next();
// });


// Multer configuration for handling file uploads (image stored in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const port = process.env.PORT || 3000; // Default to 3000 for local testing

app.get('/images/full/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Connect to MySQL
        const connection = await mysql.createConnection(dbConfig);

        // Fetch the full-resolution image by ID
        const [rows] = await connection.execute(
            `
            SELECT image_data, image_width, image_height, image_location
            FROM Images
            WHERE image_id = ?
            `,
            [id]
        );

        await connection.end();

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Image not found' });
        }

        const row = rows[0];
        res.status(200).json({
            image: Buffer.from(row.image_data).toString('base64'), // Convert image data to base64
            width: row.image_width,
            height: row.image_height,
            location: row.image_location,
        });
    } catch (error) {
        console.error('Error fetching full-resolution image:', error);
        res.status(500).json({ message: 'Error fetching image', error });
    }
});


// Route to handle image upload
app.post('/upload', upload.single('image'), async (req, res) => {
    const file = req.file;
    const { width, height, location } = req.body;

    // Validate request
    if (!file) {
        return res.status(400).json({ message: 'No image file uploaded' });
    }

    if (!width || !height) {
        return res.status(400).json({ message: 'Image width and height are required' });
    }

    if (!location) {
        return res.status(400).json({ message: 'Location is required' });
    }

    try {
        // Decode image from file buffer
        const buffer = file.buffer;

        // Connect to MySQL
        const connection = await mysql.createConnection(dbConfig);

        // Insert image into the database
        const query = `
            INSERT INTO Images (image_data, image_datetime, image_width, image_height, image_location) 
            VALUES (?, NOW(), ?, ?, ?)
        `;
        const [result] = await connection.execute(query, [buffer, width, height, location]);

        // Close the connection
        await connection.end();

        // Respond with success
        res.status(200).json({
            message: 'Image uploaded successfully',
            imageId: result.insertId,
            location,
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({
            message: 'Error uploading image',
            error: error.message || error,
        });
    }
});

const sharp = require('sharp');

// Updated route to fetch images with pagination
app.get('/images', async (req, res) => {
    const page = parseInt(req.query.page) || 1; // Default to 1 if not provided
    const pageSize = parseInt(req.query.pageSize) || 12; // Default to 10 if not provided
    const targetWidth = parseInt(req.query.width) || 300; // Target width for resized images (default: 300px)
    const targetHeight = parseInt(req.query.height) || 300; // Target height for resized images (default: 300px)

    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
        return res.status(400).json({ message: 'Invalid pagination parameters' });
    }

    const offset = (page - 1) * pageSize; // Calculate the offset

    try {
        const connection = await mysql.createConnection(dbConfig);

        // Fetch paginated images from the database
        const [rows] = await connection.execute(
            `
            SELECT image_id, image_data, image_datetime, image_width, image_height, image_location
            FROM Images
            LIMIT ? OFFSET ?
            `,
            [String(pageSize), String(offset)]
        );

        await connection.end();

        // Resize and encode images
        const images = await Promise.all(
            rows.map(async (row) => {
                let resizedImageBuffer;
                try {
                    // Resize the image using sharp
                    resizedImageBuffer = await sharp(Buffer.from(row.image_data))
                        .resize(targetWidth, targetHeight, { fit: 'inside' }) // Maintain aspect ratio
                        .toBuffer();
                } catch (error) {
                    console.error(`Error resizing image ID ${row.image_id}:`, error);
                    resizedImageBuffer = Buffer.from(row.image_data); // Fallback to original image
                }

                return {
                    id: row.image_id,
                    image: resizedImageBuffer.toString('base64'), // Convert resized image to base64
                    datetime: row.image_datetime,
                    width: targetWidth,
                    height: targetHeight,
                    location: row.image_location,
                };
            })
        );

        res.status(200).json(images);
    } catch (error) {
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

module.exports = app;