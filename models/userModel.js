const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

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
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },
    passwordChangedAT: Date,
    passwordResetCode: String,
    passwordResetCodeExpire: Date,
    passwordResetCodeVerified: Boolean,
    role: {
      type: String,
      enum: ["customr", "driver", "admin", "superAdmin"],
      default: "customr",
    },
    enabledControls: { type: [String] },
    account_status: {
      type: String,
      enum: ["pending", "confirmed"],
      default: "pending",
    },
    active: {
      type: Boolean,
      default: true,
    },
    image: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: {
      timeZone: "UTC",
    },
        toJSON: { virtuals: true,
      transform: (doc, ret)=>{
        delete ret.id;
        delete ret.__v
        return ret
      }
     },
    toObject: { virtuals: true },
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // Password hashing
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Virtual for image URL
userSchema.virtual('imageUrl').get(function() {
  if (!this.image) return null;
  return `${process.env.BASE_URL}/uploads/users/${this.image}`;
});

const user = mongoose.model("user", userSchema);
module.exports = user;
