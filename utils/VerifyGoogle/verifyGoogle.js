const { OAuth2Client } = require("google-auth-library");

const verifyGoogle = async(idToken)=>{
const client =new OAuth2Client();

const ticket = await client.verifyIdToken({
    idToken,
    audience:process.env.CLIENT_ID
})
//payload
const payload = ticket.getPayload()
console.log(payload);
return payload

}
module.exports={
    verifyGoogle
}