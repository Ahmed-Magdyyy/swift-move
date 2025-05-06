const socketConfig = require("./socketConfig");

// Start the socket server on port 3005
const server = socketConfig.initSocketServer();

// Handle unhandled rejections
process.on("unhandledRejection", (err) => {
  console.error(`unhandledRejection Errors: ${err.name} | ${err.message}`);
  server.close(() => {
    console.log("Socket server shutting down...");
    process.exit(1);
  });
});
