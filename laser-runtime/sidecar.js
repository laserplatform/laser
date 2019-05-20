const process=require('process');
const send=(text)=>new Promise(resolve=>process.send(text, resolve));
async function main(){
    process.setgid("nogroup");
    process.setuid("nobody");
    const app=require('/task/app');
    if(app.init){
        await app.init();
    }
    process.on("message", async (msg)=>{
        try{
            const ret=await app(JSON.parse(msg));
            await send(JSON.stringify({"result": ret}));
        }catch(err){
            console.log(err);
            if(err.code) await send(JSON.stringify({"code": err.code, "reason": err.reason}));
            else await send(JSON.stringify({"code":-1, "reason": "unknown error."}));
        }
    })
    await send(JSON.stringify({"state": "ok"}));
}

main();