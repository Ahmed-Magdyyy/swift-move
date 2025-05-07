const fs = require("fs")
const path =require("path")
const deleteFile = (filePath)=>{
 let fullPath = path.resolve(filePath)
 fs.unlinkSync(fullPath)
}
module.exports = {
    deleteFile
  };