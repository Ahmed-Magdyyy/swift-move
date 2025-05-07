const { diskStorage } = require("multer");
const { fileValidation } = require("./fileValidation");
const multer = require("multer");


const cloudUpload = ({allowType=fileValidation.image}={})=>{
    //disk storage
const storage = diskStorage({})
    //file filter
    const fileFilter = (req,file,cb)=>{
console.log(file);
if(allowType.includes(file.mimetype)){
return cb(null , true)
}
cb("Invalid File Format",400)
    }
    return multer({
        storage,
        fileFilter
    })
}
module.exports = {
    cloudUpload
  };