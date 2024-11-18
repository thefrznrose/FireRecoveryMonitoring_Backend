const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

const cors = require('cors');
// app.use(cors({
//     origin: ['http://localhost:3001', 'http://localhost:3001', 'https://fire-recovery-monitoring-backend.vercel.app'], // Replace with your allowed origins
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Add methods you use
//     allowedHeaders: ['Content-Type', 'Authorization'], // Add headers you expect
//     credentials: true, // If you need to send cookies or authorization headers
// }));



// MySQL connection details from environment variables
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
};



// Multer configuration for handling file uploads (image stored in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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



// // Route to fetch all images
// app.get('/images', async (req, res) => {
//     try {
//         // Connect to MySQL
//         const connection = await mysql.createConnection(dbConfig);

//         // Fetch all image records from the Images table
//         const [rows] = await connection.execute(`
//             SELECT image_id, image_data, image_datetime, image_width, image_height, image_location
//             FROM Images
//         `);


//         await connection.end();

//         // Transform the image data (convert BLOB to base64)
//         const images = rows.map((row) => ({
//             id: row.image_id,
//             image: Buffer.from(row.image_data).toString('base64'),
//             datetime: row.image_datetime,
//             width: row.image_width,
//             height: row.image_height,
//             location: row.image_location, // Include location in the response
//         }));
        
//         // Respond with the image array
//         res.status(200).json(images);
//     } catch (error) {
//         console.error('Error fetching images:', error);
//         res.status(500).json({ message: 'Error fetching images', error });
//     }
// });


const sharp = require('sharp');

app.get('/images', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(`
            SELECT image_id, image_data, image_datetime, image_width, image_height, image_location 
            FROM Images
        `);

        await connection.end();

        // Transform image data (resize/compress)
        const images = await Promise.all(
            rows.map(async (row) => {
                const resizedImageBuffer = await sharp(row.image_data)
                    // .resize({ width: 300 }) // Resize to a smaller width
                    .jpeg({ quality: 40 }) // Compress to 60% quality
                    .toBuffer();

                return {
                    id: row.image_id,
                    image: resizedImageBuffer.toString('base64'),
                    datetime: row.image_datetime,
                    width: row.image_width,
                    height: row.image_height,
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
