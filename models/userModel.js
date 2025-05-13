const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { roles, accountStatus, providers } = require("../utils/Constant/enum");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: [true, "Name is required"],
      lowercase: true,
    },
    email: {
      type: String,
      unique: [true, "Email must be unique"],
      required: [true, "Email is required"],
      lowercase: true,
    },
    phone: {
      type: String,
      unique: [true, "Phone must be unique"],
      required: true
    },
    provider: {
      type: String,
      enum: Object.values(providers),
      default: providers.SYSTEM,
    },
    password: {
      type: String,
      required: function () {
        return this.provider == "system" ? true : false;
      },
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    passwordChangedAT: Date,
    passwordResetCode: String,
    passwordResetCodeExpire: Date,
    passwordResetCodeVerified: Boolean,
    role: {
      type: String,
      required: true,
      enum: Object.values(roles),
      default: roles.CUSTOMER,
    },
    enabledControls: { type: [String] },
    account_status: {
      type: String,
      enum: Object.values(accountStatus),
      default: accountStatus.PENDING,
    },
    active: {
      type: Boolean,
      default: true,
    },
    image: {
      secure_url: {
        type: String,
        // required: function () {
        //   return this.provider == "system" ? true : false;
        // },
      },
      public_id: {
        type: String,
        // required: function () {
        //   return this.provider == "system" ? true : false;
        // },
      },
    },
    refreshTokens: [
      {
        _id: false,
        token: { type: String },
        expiresAt: { type: Date, index: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: {
      timeZone: "UTC",
    },
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        delete ret.__v;
        // ret.refreshTokens = ret.refreshTokens.map(token => ({
        //   expiresAt: token.expiresAt,
        //   createdAt: token.createdAt
        // }));

        if (ret.role !== roles.ADMIN) {
          delete ret.enabledControls;
        }
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ "refreshTokens.expiresAt": 1 });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // Password hashing
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Add expiration cleanup middleware
userSchema.post('find', function(docs) {
  docs.forEach(doc => {
    doc.refreshTokens = doc.refreshTokens.filter(
      token => token.expiresAt > new Date()
    );
  });
});

const user = mongoose.model("user", userSchema);
module.exports = user;
