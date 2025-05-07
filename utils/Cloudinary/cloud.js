const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({path:path.resolve("./.env")})
console.log(`${process.env.MONGO_URI}`);

//cloudinary 
cloudinary.config({
    cloud_name:process.env.CLOUD_NAME,
    api_key:process.env.API_KEY,
    api_secret:process.env.API_SECRET
} 
)

//delete image
 const deleteImageCloud = (public_id)=>{
    return cloudinary.uploader.destroy(public_id)
}
module.exports = {
    cloudinary,
    deleteImageCloud,
  };