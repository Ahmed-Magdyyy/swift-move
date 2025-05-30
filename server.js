const express = require("express");
const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });
const app = express();
const PORT = process.env.PORT || 3000;
const morgan = require("morgan");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const ApiError = require("./utils/ApiError");
const globalError = require("./middlewares/errorMiddleware");
const dbConnection = require("./config/database");
// const { limiter } = require("./utils/Rate-Limiter/rate-limiter");
const { default: helmet } = require("helmet");

const socketConfig = require("./socketConfig");

//rate limit 
// app.use(limiter)
//helmet
app.use(helmet())
// Routes
const mountRoutes = require("./routes");


// middlewares

// Configure allowed origins
const allowedOrigins = [
  'http://localhost:5173', // Frontend dev's localhost
  'https://swift-move.onrender.com', //Render URL
  'http://localhost:3000' // My local host
];

// Enable CORS with dynamic origin checking
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      const msg = `The CORS policy for this site does not allow access from ${origin}`;
      return callback(new Error(msg), false);
    }
  },
  credentials: true, // Enable if using cookies/authentication
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors()); 

app.use(express.urlencoded({ extended: false }));

app.use(express.json());
app.use(express.static(path.join(__dirname, "uploads")));
app.use(cookieParser());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
  console.log(`mode: ${process.env.NODE_ENV}`);
}

// DB connecetion
dbConnection();

// Mount Routes
mountRoutes(app)

app.get('/', (req, res) => {
  res.send('ٍSwift move API is running.');
});

app.all("*", (req, res, next) => {
  next(new ApiError(`can't find this route: ${req.originalUrl}`, 400));
});

// Global error handling middleware
app.use(globalError);

const server = app.listen(process.env.PORT, () =>
  console.log(`Example app listening on port ${PORT}!`)
);

// Initialize Socket.IO
socketConfig.initSocketServer(server);

// UnhandledRejections event handler (rejection outside express)
process.on("unhandledRejection", (err) => {
  console.error(
    `unhandledRejection Errors: ${err.name} | ${err.message} | ${err.stack}`
  );
  server.close(() => {
    console.log("server shutting down...");
    process.exit(1);
  });
});

