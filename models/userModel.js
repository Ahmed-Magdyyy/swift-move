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
    },
    provider:{
    type:String ,
    enum :Object.values(providers),
    default :providers.SYSTEM
    },
    password: {
      type: String,
      required: function(){
      return this.provider == "system" ? true :false
      },
      minlength: [6, "Password must be at least 6 characters"],
    },
    passwordChangedAT: Date,
    passwordResetCode: String,
    passwordResetCodeExpire: Date,
    passwordResetCodeVerified: Boolean,
    role: {
      type: String,
      enum: Object.values(roles),
      default: roles.CUSTOMER,
    },
    enabledControls: { type: [String] ,
     
   },
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
      secure_url:{
        type:String,
        required: function(){
          return this.provider == "system" ? true :false
          },
      },
      public_id:{
        type:String,
        required: function(){
          return this.provider == "system" ? true :false
          },
      }
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
        if (ret.role !== roles.ADMIN) {
          delete ret.enabledControls;
        }
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
// userSchema.virtual('imageUrl').get(function() {
//   if (!this.image) return null;
//   return `${process.env.BASE_URL}/uploads/users/${this.image.public_id}`;

// });

const user = mongoose.model("user", userSchema);
module.exports = user;
