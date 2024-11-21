const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const sharp = require('sharp');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000; // Default port

/** Middlewares */
app.use(express.json()); // Parse application/json
app.use(express.urlencoded({ extended: true })); // Parse application/x-www-form-urlencoded
app.use(cors()); // Enable CORS

/** MySQL Configuration */
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
};

/** Google API Configuration */
const CREDENTIALS = JSON.parse(fs.readFileSync('crudentials.json', 'utf-8'));
const { client_id, client_secret, redirect_uris } = CREDENTIALS.web;

const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
);

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
});
console.log('Authorize this app by visiting this URL:', authUrl);

/** Multer Configuration for File Uploads */
const storage = multer.memoryStorage(); // Store files in memory
const upload = multer({ storage: storage });

/** Routes */

// Test Route
app.get('/', (req, res) => {
    res.json('Welcome to our server!');
});

/** Google Drive API Routes */
const TOKEN_PATH = 'tokens.json';

app.get('/auth', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Save tokens to a file
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        console.log('Tokens saved to', TOKEN_PATH);

        res.status(200).send('Authentication successful!');
    } catch (error) {
        console.error('Error authenticating:', error);
        res.status(500).send('Failed to authenticate.');
    }
});


// Upload File to Google Drive
app.post('/upload-drive', upload.single('image'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    try {
        const response = await drive.files.create({
            requestBody: {
                name: file.originalname,
                mimeType: file.mimetype,
                parents: ['1XhnZW68-g4hKw-8rg-BrxahbnmZwZYx4'], // Replace with your folder ID
            },
            media: {
                mimeType: file.mimetype,
                body: Buffer.from(file.buffer), // Use the in-memory buffer
            },
        });
        // Set permissions for public access
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });
        const fileUrl = `https://drive.google.com/uc?id=${response.data.id}`;
        res.status(200).json({
            message: 'File uploaded to Google Drive successfully',
            fileId: response.data.id,
            fileUrl,
        });
    } catch (error) {
        console.error('Error uploading to Google Drive:', error);
        res.status(500).json({ message: 'Failed to upload file to Google Drive', error });
    }
});

/** Image Management Routes */

// Upload Image to MySQL Database
app.post('/upload', upload.single('image'), async (req, res) => {
    const file = req.file;
    const { width, height, location } = req.body;

    if (!file || !width || !height || !location) {
        return res.status(400).json({ message: 'Invalid input data' });
    }

    try {
        const buffer = file.buffer;
        const connection = await mysql.createConnection(dbConfig);
        const query = `
            INSERT INTO Images (image_data, image_dateTime, image_width, image_height, image_location)
            VALUES (?, NOW(), ?, ?, ?)
        `;
        const [result] = await connection.execute(query, [buffer, width, height, location]);
        await connection.end();

        res.status(200).json({
            message: 'Image uploaded successfully',
            imageId: result.insertId,
            location,
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ message: 'Error uploading image', error });
    }
});

// Fetch Images with Pagination
app.get('/images', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 12;
    const targetWidth = parseInt(req.query.width) || 300;
    const targetHeight = parseInt(req.query.height) || 300;

    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
        return res.status(400).json({ message: 'Invalid pagination parameters' });
    }

    const offset = (page - 1) * pageSize;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            `SELECT image_id, image_data, image_datetime, image_width, image_height, image_location FROM Images LIMIT ? OFFSET ?`,
            [String(pageSize), String(offset)]
        );
        await connection.end();

        const images = await Promise.all(
            rows.map(async (row) => {
                let resizedImageBuffer;
                try {
                    resizedImageBuffer = await sharp(Buffer.from(row.image_data))
                        .resize(targetWidth, targetHeight, { fit: 'inside' })
                        .toBuffer();
                } catch (error) {
                    resizedImageBuffer = Buffer.from(row.image_data);
                }

                return {
                    id: row.image_id,
                    image: resizedImageBuffer.toString('base64'),
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

// Delete Image by ID
app.delete('/images/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = `DELETE FROM Images WHERE image_id = ?`;
        const [result] = await connection.execute(query, [id]);
        await connection.end();

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Image not found' });
        }

        res.status(200).json({ message: 'Image deleted successfully' });
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).json({ message: 'Error deleting image', error });
    }
});

/** Start Server */
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

module.exports = app;
