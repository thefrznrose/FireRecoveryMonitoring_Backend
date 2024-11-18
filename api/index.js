const server = require('./server'); // Import your Express app
const { createServer } = require('@vercel/node'); // Required for serverless

module.exports = createServer(server);
